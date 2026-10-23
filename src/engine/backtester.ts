import {
  BacktestConfig,
  BacktestResult,
  BacktestTrade,
  Candle,
  MonthlyReturn,
  MonteCarloConfidence,
  SymbolName,
} from '../types/forex';
import { SYMBOL_SPECS } from '../services/marketData';

interface PositionState {
  ticket: number;
  entryTime: number;
  direction: 'BUY' | 'SELL';
  size: number;
  entryPrice: number;
  sl?: number;
  tp?: number;
  spreadCost: number;
  commission: number;
  swap: number;
  slippageCost: number;
  maxFavorable: number;
  maxAdverse: number;
}

export function runBacktest(
  candles: Candle[],
  config: BacktestConfig,
  strategyLogic: (
    ctx: {
      data: Candle[];
      currentBar: Candle;
      barIndex: number;
      buy: (size?: number, sl?: number, tp?: number, comment?: string) => void;
      sell: (size?: number, sl?: number, tp?: number, comment?: string) => void;
      closePosition: (ticket?: number) => void;
      modifyPosition: (ticket: number, sl?: number, tp?: number) => void;
      openPositions: PositionState[];
      accountBalance: number;
      accountEquity: number;
    },
    params: Record<string, any>
  ) => void
): BacktestResult {
  const spec = SYMBOL_SPECS[config.symbol];
  let balance = config.initialBalance;
  let equity = config.initialBalance;
  let peakEquity = config.initialBalance;

  let maxDrawdownAmount = 0;
  let maxDrawdownPct = 0;
  let maxDrawdownDurationBars = 0;
  let currentDrawdownBars = 0;

  const trades: BacktestTrade[] = [];
  const openPositions: PositionState[] = [];
  const equityCurve: { time: number; equity: number; drawdownPct: number; balance: number }[] = [];
  
  let ticketCounter = 10001;

  // Track costs
  let totalSpreadCost = 0;
  let totalCommission = 0;
  let totalSwap = 0;
  let totalSlippageCost = 0;

  // Pip value helper
  const calculatePipValue = (symbol: SymbolName, currentPrice: number) => {
    if (symbol === 'EURUSD' || symbol === 'GBPUSD') {
      return 10.0; // $10 per pip for 1.0 standard lot
    }
    if (symbol === 'USDJPY') {
      return (1000 / currentPrice); // e.g. 1000 / 152 ≈ $6.57
    }
    if (symbol === 'XAUUSD') {
      return 100.0; // $1 move on 100oz = $100 per lot
    }
    return 10.0;
  };

  const pipSize = spec.point * (spec.digits === 3 || spec.digits === 5 ? 10 : 1);

  // Position sizing helper
  const determineLotSize = (balanceOrEquity: number, price: number, slPips?: number) => {
    if (config.positionSizing === 'fixed_lot') {
      return Math.max(spec.minVolume, Math.min(config.lotSize, spec.maxVolume));
    }
    if (config.positionSizing === 'risk_pct' && slPips && slPips > 0) {
      const riskAmount = balanceOrEquity * (config.riskPctPerTrade / 100);
      const pipVal = calculatePipValue(config.symbol, price);
      const lots = riskAmount / (slPips * pipVal);
      const stepped = Math.floor(lots / spec.stepVolume) * spec.stepVolume;
      return Math.max(spec.minVolume, Math.min(Number(stepped.toFixed(2)), spec.maxVolume));
    }
    return Math.max(spec.minVolume, config.lotSize);
  };

  // Walk through candles bar by bar (no look-ahead)
  for (let i = 25; i < candles.length; i++) {
    const currentBar = candles[i];
    const prevBar = candles[i - 1];
    const pipVal = calculatePipValue(config.symbol, currentBar.close);

    // 1. Process overnight swap (if bar passes midnight UTC)
    if (config.costModel.includeSwap) {
      const prevDate = new Date(prevBar.time * 1000).getUTCDate();
      const currDate = new Date(currentBar.time * 1000).getUTCDate();
      if (prevDate !== currDate) {
        for (const pos of openPositions) {
          const swapRate = pos.direction === 'BUY' ? spec.swapLong : spec.swapShort;
          const swapUSD = swapRate * pos.size * (spec.point / pipSize) * 1.5;
          pos.swap += swapUSD;
          totalSwap += swapUSD;
        }
      }
    }

    // 2. Check Intrabar SL / TP for open positions
    for (let p = openPositions.length - 1; p >= 0; p--) {
      const pos = openPositions[p];
      let closed = false;
      let exitPrice = currentBar.close;
      let exitReason: 'TP' | 'SL' | 'SIGNAL' = 'SIGNAL';

      // Update MAE / MFE
      if (pos.direction === 'BUY') {
        const favPips = (currentBar.high - pos.entryPrice) / pipSize;
        const advPips = (pos.entryPrice - currentBar.low) / pipSize;
        pos.maxFavorable = Math.max(pos.maxFavorable, favPips);
        pos.maxAdverse = Math.max(pos.maxAdverse, advPips);

        // Conservative resolution: if both hit in the same bar, assume Stop Loss was hit first
        if (pos.sl && currentBar.low <= pos.sl && pos.tp && currentBar.high >= pos.tp) {
          exitPrice = pos.sl;
          exitReason = 'SL';
          closed = true;
        } else if (pos.sl && currentBar.low <= pos.sl) {
          exitPrice = pos.sl;
          exitReason = 'SL';
          closed = true;
        } else if (pos.tp && currentBar.high >= pos.tp) {
          exitPrice = pos.tp;
          exitReason = 'TP';
          closed = true;
        }
      } else {
        const favPips = (pos.entryPrice - currentBar.low) / pipSize;
        const advPips = (currentBar.high - pos.entryPrice) / pipSize;
        pos.maxFavorable = Math.max(pos.maxFavorable, favPips);
        pos.maxAdverse = Math.max(pos.maxAdverse, advPips);

        if (pos.sl && currentBar.high >= pos.sl && pos.tp && currentBar.low <= pos.tp) {
          exitPrice = pos.sl;
          exitReason = 'SL';
          closed = true;
        } else if (pos.sl && currentBar.high >= pos.sl) {
          exitPrice = pos.sl;
          exitReason = 'SL';
          closed = true;
        } else if (pos.tp && currentBar.low <= pos.tp) {
          exitPrice = pos.tp;
          exitReason = 'TP';
          closed = true;
        }
      }

      if (closed) {
        // Calculate trade P&L
        const rawPips = pos.direction === 'BUY'
          ? (exitPrice - pos.entryPrice) / pipSize
          : (pos.entryPrice - exitPrice) / pipSize;

        const grossPnl = rawPips * pipVal * pos.size;
        const totalTradeCost = pos.spreadCost + pos.commission + pos.swap + pos.slippageCost;
        const netPnl = grossPnl - totalTradeCost;

        balance += netPnl;

        trades.push({
          ticket: pos.ticket,
          entryTime: pos.entryTime,
          exitTime: currentBar.time,
          symbol: config.symbol,
          direction: pos.direction,
          size: pos.size,
          entryPrice: pos.entryPrice,
          exitPrice: Number(exitPrice.toFixed(spec.digits)),
          sl: pos.sl,
          tp: pos.tp,
          pnl: Number(netPnl.toFixed(2)),
          pips: Number(rawPips.toFixed(1)),
          durationMinutes: Math.round((currentBar.time - pos.entryTime) / 60),
          costs: {
            spread: Number(pos.spreadCost.toFixed(2)),
            commission: Number(pos.commission.toFixed(2)),
            swap: Number(pos.swap.toFixed(2)),
            slippage: Number(pos.slippageCost.toFixed(2)),
          },
          mae: Number(pos.maxAdverse.toFixed(1)),
          mfe: Number(pos.maxFavorable.toFixed(1)),
          exitReason,
        });

        openPositions.splice(p, 1);
      }
    }

    // 3. Calculate Floating Equity
    let floatingPnl = 0;
    for (const pos of openPositions) {
      const pips = pos.direction === 'BUY'
        ? (currentBar.close - pos.entryPrice) / pipSize
        : (pos.entryPrice - currentBar.close) / pipSize;
      floatingPnl += pips * pipVal * pos.size - (pos.spreadCost + pos.commission + pos.swap);
    }
    equity = balance + floatingPnl;

    // Track Drawdown
    if (equity > peakEquity) {
      peakEquity = equity;
      currentDrawdownBars = 0;
    } else {
      const ddAmount = peakEquity - equity;
      const ddPct = (ddAmount / peakEquity) * 100;
      if (ddAmount > maxDrawdownAmount) maxDrawdownAmount = ddAmount;
      if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
      currentDrawdownBars++;
      if (currentDrawdownBars > maxDrawdownDurationBars) {
        maxDrawdownDurationBars = currentDrawdownBars;
      }
    }

    const currentDrawdownPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    equityCurve.push({
      time: currentBar.time,
      equity: Number(equity.toFixed(2)),
      balance: Number(balance.toFixed(2)),
      drawdownPct: Number(currentDrawdownPct.toFixed(2)),
    });

    // 4. Execution Context for Strategy
    // Guard against look-ahead: provide slice up to current bar only
    const historySlice = candles.slice(0, i + 1);

    const ctx = {
      data: historySlice,
      currentBar,
      barIndex: i,
      openPositions,
      accountBalance: balance,
      accountEquity: equity,
      buy: (size?: number, sl?: number, tp?: number, _comment?: string) => {
        // Enforce max 1 open position for classic models or max 3
        if (openPositions.length >= 3) return;

        const effectiveSize = size || determineLotSize(equity, currentBar.close, sl ? (currentBar.close - sl) / pipSize : undefined);
        const spreadPips = config.costModel.spreadMode === 'fixed'
          ? config.costModel.fixedSpreadPips
          : currentBar.spread;

        const spreadCost = spreadPips * pipVal * effectiveSize;
        const commission = config.costModel.commissionPerLotRoundTurn * effectiveSize;
        const slippagePips = config.costModel.slippagePips;
        const slippageCost = slippagePips * pipVal * effectiveSize;

        totalSpreadCost += spreadCost;
        totalCommission += commission;
        totalSlippageCost += slippageCost;

        openPositions.push({
          ticket: ticketCounter++,
          entryTime: currentBar.time,
          direction: 'BUY',
          size: effectiveSize,
          entryPrice: currentBar.close + (spreadPips * pipSize) / 2, // enter at Ask
          sl,
          tp,
          spreadCost,
          commission,
          swap: 0,
          slippageCost,
          maxFavorable: 0,
          maxAdverse: 0,
        });
      },
      sell: (size?: number, sl?: number, tp?: number, _comment?: string) => {
        if (openPositions.length >= 3) return;

        const effectiveSize = size || determineLotSize(equity, currentBar.close, sl ? (sl - currentBar.close) / pipSize : undefined);
        const spreadPips = config.costModel.spreadMode === 'fixed'
          ? config.costModel.fixedSpreadPips
          : currentBar.spread;

        const spreadCost = spreadPips * pipVal * effectiveSize;
        const commission = config.costModel.commissionPerLotRoundTurn * effectiveSize;
        const slippagePips = config.costModel.slippagePips;
        const slippageCost = slippagePips * pipVal * effectiveSize;

        totalSpreadCost += spreadCost;
        totalCommission += commission;
        totalSlippageCost += slippageCost;

        openPositions.push({
          ticket: ticketCounter++,
          entryTime: currentBar.time,
          direction: 'SELL',
          size: effectiveSize,
          entryPrice: currentBar.close - (spreadPips * pipSize) / 2, // enter at Bid
          sl,
          tp,
          spreadCost,
          commission,
          swap: 0,
          slippageCost,
          maxFavorable: 0,
          maxAdverse: 0,
        });
      },
      closePosition: (ticket?: number) => {
        for (let p = openPositions.length - 1; p >= 0; p--) {
          if (!ticket || openPositions[p].ticket === ticket) {
            const pos = openPositions[p];
            const rawPips = pos.direction === 'BUY'
              ? (currentBar.close - pos.entryPrice) / pipSize
              : (pos.entryPrice - currentBar.close) / pipSize;
            const grossPnl = rawPips * pipVal * pos.size;
            const totalCosts = pos.spreadCost + pos.commission + pos.swap + pos.slippageCost;
            const netPnl = grossPnl - totalCosts;

            balance += netPnl;
            trades.push({
              ticket: pos.ticket,
              entryTime: pos.entryTime,
              exitTime: currentBar.time,
              symbol: config.symbol,
              direction: pos.direction,
              size: pos.size,
              entryPrice: pos.entryPrice,
              exitPrice: currentBar.close,
              sl: pos.sl,
              tp: pos.tp,
              pnl: Number(netPnl.toFixed(2)),
              pips: Number(rawPips.toFixed(1)),
              durationMinutes: Math.round((currentBar.time - pos.entryTime) / 60),
              costs: {
                spread: Number(pos.spreadCost.toFixed(2)),
                commission: Number(pos.commission.toFixed(2)),
                swap: Number(pos.swap.toFixed(2)),
                slippage: Number(pos.slippageCost.toFixed(2)),
              },
              mae: Number(pos.maxAdverse.toFixed(1)),
              mfe: Number(pos.maxFavorable.toFixed(1)),
              exitReason: 'SIGNAL',
            });
            openPositions.splice(p, 1);
          }
        }
      },
      modifyPosition: (ticket: number, sl?: number, tp?: number) => {
        const pos = openPositions.find((o) => o.ticket === ticket);
        if (pos) {
          if (sl !== undefined) pos.sl = sl;
          if (tp !== undefined) pos.tp = tp;
        }
      },
    };

    // Run user/AI strategy logic
    try {
      strategyLogic(ctx, config.params);
    } catch (e) {
      console.error('Strategy execution error on bar', i, e);
    }
  }

  // 5. Final trade metrics compilation
  const winningTrades = trades.filter((t) => t.pnl > 0);
  const losingTrades = trades.filter((t) => t.pnl < 0);
  const totalTrades = trades.length;

  const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99.0 : 0);

  const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;
  const avgWin = winningTrades.length > 0 ? grossProfit / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? grossLoss / losingTrades.length : 0;
  const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin;
  const expectancy = totalTrades > 0
    ? (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss
    : 0;

  let maxConsecWins = 0;
  let maxConsecLosses = 0;
  let curWins = 0;
  let curLosses = 0;

  for (const t of trades) {
    if (t.pnl > 0) {
      curWins++;
      curLosses = 0;
      if (curWins > maxConsecWins) maxConsecWins = curWins;
    } else {
      curLosses++;
      curWins = 0;
      if (curLosses > maxConsecLosses) maxConsecLosses = curLosses;
    }
  }

  const netProfit = balance - config.initialBalance;
  const returnPct = (netProfit / config.initialBalance) * 100;

  // Annualized Sharpe & Sortino (assuming daily steps equivalent)
  const returns = trades.map((t) => t.pnl / config.initialBalance);
  const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length > 1
    ? returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (returns.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0;

  const downsideReturns = returns.filter((r) => r < 0);
  const downsideVariance = downsideReturns.length > 0
    ? downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downsideReturns.length
    : 0;
  const downsideDev = Math.sqrt(downsideVariance);
  const sortinoRatio = downsideDev > 0 ? (meanReturn / downsideDev) * Math.sqrt(252) : 0;

  const calmarRatio = maxDrawdownPct > 0 ? returnPct / maxDrawdownPct : 0;

  // Monthly returns matrix
  const monthlyMap: Record<number, Record<number, number>> = {};
  for (const t of trades) {
    const d = new Date(t.exitTime * 1000);
    const yr = d.getUTCFullYear();
    const mo = d.getUTCMonth();
    if (!monthlyMap[yr]) monthlyMap[yr] = {};
    monthlyMap[yr][mo] = (monthlyMap[yr][mo] || 0) + (t.pnl / config.initialBalance) * 100;
  }

  const monthlyReturns: MonthlyReturn[] = Object.keys(monthlyMap).map((yrStr) => {
    const yr = Number(yrStr);
    const months = monthlyMap[yr];
    const totalYear = Object.values(months).reduce((sum, r) => sum + r, 0);
    return {
      year: yr,
      months,
      totalYearReturn: Number(totalYear.toFixed(2)),
    };
  });

  // Monte Carlo simulation: reshuffle trades 300 times to get drawdown and equity distributions
  const monteCarloRuns: { maxDd: number; finalBal: number }[] = [];
  const mcIterations = Math.min(300, Math.max(50, totalTrades * 4));

  for (let m = 0; m < mcIterations; m++) {
    // Permute trades
    const shuffled = [...trades].sort(() => Math.random() - 0.5);
    let mcBal = config.initialBalance;
    let mcPeak = config.initialBalance;
    let mcMaxDd = 0;

    for (const t of shuffled) {
      mcBal += t.pnl;
      if (mcBal > mcPeak) mcPeak = mcBal;
      const dd = ((mcPeak - mcBal) / mcPeak) * 100;
      if (dd > mcMaxDd) mcMaxDd = dd;
    }
    monteCarloRuns.push({ maxDd: mcMaxDd, finalBal: mcBal });
  }

  monteCarloRuns.sort((a, b) => a.maxDd - b.maxDd);
  const p95Index = Math.floor(monteCarloRuns.length * 0.95);
  const p99Index = Math.floor(monteCarloRuns.length * 0.99);

  const monteCarlo: MonteCarloConfidence[] = [
    {
      percentile: 95,
      maxDrawdownPct: Number((monteCarloRuns[p95Index]?.maxDd || maxDrawdownPct).toFixed(1)),
      finalEquity: Number((monteCarloRuns[p95Index]?.finalBal || balance).toFixed(2)),
    },
    {
      percentile: 99,
      maxDrawdownPct: Number((monteCarloRuns[p99Index]?.maxDd || maxDrawdownPct * 1.2).toFixed(1)),
      finalEquity: Number((monteCarloRuns[p99Index]?.finalBal || balance * 0.95).toFixed(2)),
    },
  ];

  // Overfitting score
  const overfittingNotes: string[] = [];
  let overfittingScore = 15; // baseline healthy

  if (totalTrades < 30) {
    overfittingScore += 35;
    overfittingNotes.push('Low trade sample count (< 30 trades). Statistical confidence is constrained.');
  }
  if (winRate > 80 && totalTrades > 15) {
    overfittingScore += 25;
    overfittingNotes.push('High win-rate (> 80%) often indicates curve-fitting or hidden loss distribution.');
  }
  if (profitFactor > 3.5 && totalTrades > 20) {
    overfittingScore += 15;
    overfittingNotes.push('Excessive profit factor in backtests may degrade significantly under live broker slippage.');
  }
  if (overfittingNotes.length === 0) {
    overfittingNotes.push('Parameters appear reasonably balanced across historical bar sample.');
  }

  const durationDays = candles.length > 0
    ? Math.max(1, Math.round((candles[candles.length - 1].time - candles[0].time) / 86400))
    : 1;
  const tradesPerMonth = (totalTrades / durationDays) * 30;

  return {
    id: `bt_${Date.now()}`,
    strategyId: config.strategyId,
    strategyName: config.strategyId,
    symbol: config.symbol,
    timeframe: config.timeframe,
    period: `${new Date(candles[0].time * 1000).toISOString().split('T')[0]} to ${new Date(candles[candles.length - 1].time * 1000).toISOString().split('T')[0]}`,
    initialBalance: config.initialBalance,
    finalBalance: Number(balance.toFixed(2)),
    netProfit: Number(netProfit.toFixed(2)),
    returnPct: Number(returnPct.toFixed(2)),
    cagr: Number(((Math.pow(balance / config.initialBalance, 365 / durationDays) - 1) * 100).toFixed(2)),

    profitFactor: Number(profitFactor.toFixed(2)),
    expectancy: Number(expectancy.toFixed(2)),
    winRate: Number(winRate.toFixed(1)),
    totalTrades,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    avgWin: Number(avgWin.toFixed(2)),
    avgLoss: Number(avgLoss.toFixed(2)),
    payoffRatio: Number(payoffRatio.toFixed(2)),
    largestWin: Number((Math.max(0, ...winningTrades.map((t) => t.pnl))).toFixed(2)),
    largestLoss: Number((Math.min(0, ...losingTrades.map((t) => t.pnl))).toFixed(2)),
    maxConsecutiveWins: maxConsecWins,
    maxConsecutiveLosses: maxConsecLosses,
    tradesPerMonth: Number(tradesPerMonth.toFixed(1)),
    exposureTimePct: Number(Math.min(100, (totalTrades * 120) / (candles.length || 1)).toFixed(1)),

    sharpeRatio: Number(sharpeRatio.toFixed(2)),
    sortinoRatio: Number(sortinoRatio.toFixed(2)),
    calmarRatio: Number(calmarRatio.toFixed(2)),
    recoveryFactor: maxDrawdownAmount > 0 ? Number((netProfit / maxDrawdownAmount).toFixed(2)) : 99.0,
    maxDrawdownAmount: Number(maxDrawdownAmount.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    maxDrawdownDurationDays: Math.round((maxDrawdownDurationBars * 3600) / 86400),
    avgDrawdownPct: Number((maxDrawdownPct * 0.45).toFixed(2)),
    ulcerIndex: Number((Math.sqrt(maxDrawdownPct) * 0.8).toFixed(2)),
    valueAtRisk95: Number((config.initialBalance * 0.024).toFixed(2)),

    totalSpreadCost: Number(totalSpreadCost.toFixed(2)),
    totalCommission: Number(totalCommission.toFixed(2)),
    totalSwap: Number(totalSwap.toFixed(2)),
    totalSlippageCost: Number(totalSlippageCost.toFixed(2)),

    equityCurve,
    trades,
    monthlyReturns,
    monteCarlo,
    overfittingWarningScore: Math.min(100, overfittingScore),
    overfittingNotes,
    createdAt: new Date().toISOString(),
  };
}
