import { BacktestTrade, TradingViewComparisonReport, TradingViewTradeRecord } from '../types/forex';

/**
 * Parses a raw TradingView "List of Trades" CSV export string
 */
export function parseTradingViewTradesCsv(csvContent: string): TradingViewTradeRecord[] {
  const lines = csvContent.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/["']/g, ''));
  const tradeNumIdx = headers.findIndex(h => h.includes('trade') || h.includes('#'));
  const typeIdx = headers.findIndex(h => h.includes('type'));
  const signalIdx = headers.findIndex(h => h.includes('signal'));
  const dateIdx = headers.findIndex(h => h.includes('date') || h.includes('time'));
  const priceIdx = headers.findIndex(h => h.includes('price'));
  const contractsIdx = headers.findIndex(h => h.includes('contract') || h.includes('size') || h.includes('qty'));
  const profitIdx = headers.findIndex(h => h.includes('profit') && !h.includes('cum'));

  const parsedTrades: TradingViewTradeRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    // Regex to split on comma outside quotes
    const cols = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.trim().replace(/^["']|["']$/g, ''));
    if (cols.length < 3) continue;

    const rawType = (cols[typeIdx >= 0 ? typeIdx : 1] || '').trim();
    let type: 'Entry Long' | 'Exit Long' | 'Entry Short' | 'Exit Short' = 'Entry Long';
    if (rawType.toLowerCase().includes('exit') && rawType.toLowerCase().includes('long')) type = 'Exit Long';
    else if (rawType.toLowerCase().includes('entry') && rawType.toLowerCase().includes('short')) type = 'Entry Short';
    else if (rawType.toLowerCase().includes('exit') && rawType.toLowerCase().includes('short')) type = 'Exit Short';

    const tradeRecord: TradingViewTradeRecord = {
      tradeNumber: parseInt(cols[tradeNumIdx >= 0 ? tradeNumIdx : 0], 10) || i,
      type,
      signal: cols[signalIdx >= 0 ? signalIdx : 2] || 'Signal',
      date: cols[dateIdx >= 0 ? dateIdx : 3] || '',
      price: parseFloat(cols[priceIdx >= 0 ? priceIdx : 4]) || 0,
      contracts: parseFloat(cols[contractsIdx >= 0 ? contractsIdx : 5]) || 0.1,
      profitUSD: profitIdx >= 0 ? parseFloat(cols[profitIdx]) || undefined : undefined,
    };
    parsedTrades.push(tradeRecord);
  }

  return parsedTrades;
}

/**
 * Compares portal backtest trades against parsed TradingView trade records
 */
export function compareWithTradingViewTrades(
  portalTrades: BacktestTrade[],
  tvTrades: TradingViewTradeRecord[]
): TradingViewComparisonReport {
  // Filter for exits to compare realized round-trip P&L
  const tvExits = tvTrades.filter(t => t.type.startsWith('Exit'));
  const tvTradeCount = tvExits.length > 0 ? tvExits.length : Math.floor(tvTrades.length / 2);
  const portalTradeCount = portalTrades.length;

  const tvNetProfit = tvExits.reduce((acc, t) => acc + (t.profitUSD || 0), 0);
  const portalNetProfit = portalTrades.reduce((acc, t) => acc + t.pnl, 0);

  const tradeCountMatch = Math.abs(tvTradeCount - portalTradeCount) <= 1;
  const pnlDifferenceUSD = Math.abs(portalNetProfit - tvNetProfit);
  const pnlBase = Math.max(1, Math.abs(tvNetProfit));
  const pnlDifferencePct = (pnlDifferenceUSD / pnlBase) * 100;

  const notes: string[] = [];

  if (tradeCountMatch) {
    notes.push(`Trade count is synchronized: TradingView recorded ${tvTradeCount} trades, portal recorded ${portalTradeCount} trades.`);
  } else {
    notes.push(`Trade count divergence: TradingView recorded ${tvTradeCount} trades, portal recorded ${portalTradeCount} trades.`);
  }

  if (pnlDifferencePct < 10) {
    notes.push(`P&L divergence is minimal (${pnlDifferencePct.toFixed(1)}%). Differences are attributable to spread and slippage cost modeling.`);
  } else {
    notes.push(`P&L divergence is ${pnlDifferencePct.toFixed(1)}% ($${pnlDifferenceUSD.toFixed(2)} delta). Check TradingView commission and tick-spread settings.`);
  }

  // Calculate overall alignment score (0 - 100)
  const countPenalty = Math.min(50, Math.abs(tvTradeCount - portalTradeCount) * 10);
  const pnlPenalty = Math.min(50, pnlDifferencePct * 0.5);
  const alignmentScore = Math.max(0, Math.min(100, Math.round(100 - (countPenalty + pnlPenalty))));

  return {
    tvTradeCount,
    portalTradeCount,
    tradeCountMatch,
    tvNetProfit: Number(tvNetProfit.toFixed(2)),
    portalNetProfit: Number(portalNetProfit.toFixed(2)),
    pnlDifferenceUSD: Number(pnlDifferenceUSD.toFixed(2)),
    pnlDifferencePct: Number(pnlDifferencePct.toFixed(1)),
    timingDivergenceMinutes: 0,
    alignmentScore,
    notes,
  };
}
