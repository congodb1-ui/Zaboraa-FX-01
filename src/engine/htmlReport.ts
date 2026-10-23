import { BacktestResult } from '../types/forex';

/**
 * Generates a self-contained, beautifully formatted standalone HTML report for a backtest run
 */
export function generateStandaloneBacktestHtmlReport(result: BacktestResult): string {
  const tradesRows = result.trades
    .slice(0, 100)
    .map(
      (t) => `
    <tr>
      <td style="padding: 6px 10px; border-bottom: 1px solid #1e293b; font-family: monospace;">#${t.ticket}</td>
      <td style="padding: 6px 10px; border-bottom: 1px solid #1e293b;">${new Date(t.entryTime * 1000).toISOString().replace('T', ' ').slice(0, 16)}</td>
      <td style="padding: 6px 10px; border-bottom: 1px solid #1e293b; font-weight: 600; color: ${t.direction === 'BUY' ? '#16a34a' : '#dc2626'};">${t.direction}</td>
      <td style="padding: 6px 10px; border-bottom: 1px solid #1e293b; font-family: monospace; text-align: right;">${t.size.toFixed(2)}</td>
      <td style="padding: 6px 10px; border-bottom: 1px solid #1e293b; font-family: monospace; text-align: right;">${t.entryPrice.toFixed(5)}</td>
      <td style="padding: 6px 10px; border-bottom: 1px solid #1e293b; font-family: monospace; text-align: right;">${t.exitPrice.toFixed(5)}</td>
      <td style="padding: 6px 10px; border-bottom: 1px solid #1e293b; font-family: monospace; text-align: right; color: ${t.pnl >= 0 ? '#16a34a' : '#dc2626'}; font-weight: 600;">$${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}</td>
      <td style="padding: 6px 10px; border-bottom: 1px solid #1e293b; font-family: monospace; text-align: right;">${t.mae.toFixed(1)}</td>
      <td style="padding: 6px 10px; border-bottom: 1px solid #1e293b; font-family: monospace; text-align: right;">${t.mfe.toFixed(1)}</td>
      <td style="padding: 6px 10px; border-bottom: 1px solid #1e293b; font-family: monospace;">${t.exitReason}</td>
    </tr>
  `
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Zaboraa FX - Backtest Report: ${result.strategyName} (${result.symbol})</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #090d16; color: #f1f5f9; margin: 0; padding: 24px; }
    .container { max-width: 1100px; margin: 0 auto; background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 24px; }
    h1, h2, h3 { margin-top: 0; color: #ffffff; }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .kpi-card { background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 12px; }
    .kpi-title { font-size: 11px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.05em; }
    .kpi-val { font-size: 20px; font-weight: 700; margin-top: 4px; font-family: monospace; }
    .profit { color: #16a34a; }
    .loss { color: #dc2626; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 8px 10px; background: #1e293b; color: #cbd5e1; font-weight: 600; border-bottom: 1px solid #475569; }
    .provenance-tag { font-size: 12px; color: #38bdf8; padding: 2px 8px; border: 1px solid #0284c7; border-radius: 4px; }
    .footer { margin-top: 32px; font-size: 11px; color: #64748b; border-top: 1px solid #334155; padding-top: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #334155; padding-bottom: 16px; margin-bottom: 20px;">
      <div>
        <h1>Zaboraa FX Quantitative Backtest Report</h1>
        <div style="color: #94a3b8; font-size: 13px;">Strategy: <strong style="color: #ffffff;">${result.strategyName}</strong> | Symbol: <strong>${result.symbol}</strong> (${result.timeframe}) | Period: ${result.period}</div>
      </div>
      <div>
        <span class="provenance-tag">Data Source: ${result.provenance.label}</span>
      </div>
    </div>

    <!-- Executive Metrics Grid -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-title">Net Profit</div>
        <div class="kpi-val ${result.netProfit >= 0 ? 'profit' : 'loss'}">$${result.netProfit >= 0 ? '+' : ''}${result.netProfit.toFixed(2)} (${result.returnPct.toFixed(2)}%)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Profit Factor</div>
        <div class="kpi-val">${result.profitFactor.toFixed(2)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Win Rate</div>
        <div class="kpi-val">${result.winRate.toFixed(1)}% (${result.winningTrades}/${result.totalTrades})</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Max Drawdown</div>
        <div class="kpi-val loss">${result.maxDrawdownPct.toFixed(2)}% ($${result.maxDrawdownAmount.toFixed(2)})</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Sharpe Ratio</div>
        <div class="kpi-val">${result.sharpeRatio.toFixed(2)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Overfitting Score</div>
        <div class="kpi-val" style="color: ${result.overfittingWarningScore < 25 ? '#16a34a' : result.overfittingWarningScore <= 50 ? '#d97706' : '#dc2626'};">${result.overfittingWarningScore}/100</div>
      </div>
    </div>

    <!-- Cost Attribution Breakdown -->
    <div style="background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 16px; margin-bottom: 24px;">
      <h3 style="margin-bottom: 8px;">Institutional Cost Attribution Breakdown</h3>
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; font-family: monospace;">
        <div>Spread Cost: <strong>$${result.totalSpreadCost.toFixed(2)}</strong></div>
        <div>Commissions: <strong>$${result.totalCommission.toFixed(2)}</strong></div>
        <div>Overnight Swap: <strong>$${result.totalSwap.toFixed(2)}</strong></div>
        <div>Slippage Cost: <strong>$${result.totalSlippageCost.toFixed(2)}</strong></div>
      </div>
    </div>

    <!-- Trade List Table -->
    <h3>Closed Trade History (First 100 Trades)</h3>
    <div style="overflow-x: auto;">
      <table>
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Entry Date (UTC)</th>
            <th>Type</th>
            <th style="text-align: right;">Size</th>
            <th style="text-align: right;">Entry Price</th>
            <th style="text-align: right;">Exit Price</th>
            <th style="text-align: right;">Net P&L</th>
            <th style="text-align: right;">MAE (pips)</th>
            <th style="text-align: right;">MFE (pips)</th>
            <th>Exit Reason</th>
          </tr>
        </thead>
        <tbody>
          ${tradesRows}
        </tbody>
      </table>
    </div>

    <div class="footer">
      Risk Disclosure: Hypothetical or simulated performance results have certain inherent limitations. Past performance is no guarantee of future returns. Generated by Zaboraa FX on ${new Date().toISOString()}.
    </div>
  </div>
</body>
</html>`;
}
