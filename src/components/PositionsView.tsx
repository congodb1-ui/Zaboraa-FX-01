import React, { useState } from 'react';
import { Position, PendingOrder, SymbolName } from '../types/forex';
import { Layers, XCircle, Edit3, ShieldAlert, Clock, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface PositionsViewProps {
  positions: Position[];
  pendingOrders: PendingOrder[];
  isBrokerConnected?: boolean;
  onClosePosition: (ticket: number) => void;
  onModifyPosition: (ticket: number, sl?: number, tp?: number) => void;
  onCancelPendingOrder: (ticket: number) => void;
}

export const PositionsView: React.FC<PositionsViewProps> = ({
  positions,
  pendingOrders,
  isBrokerConnected = false,
  onClosePosition,
  onModifyPosition,
  onCancelPendingOrder,
}) => {
  const [activeTab, setActiveTab] = useState<'POSITIONS' | 'PENDING'>('POSITIONS');
  const [modifyTarget, setModifyTarget] = useState<Position | null>(null);
  const [editSl, setEditSl] = useState<string>('');
  const [editTp, setEditTp] = useState<string>('');

  const handleOpenModify = (pos: Position) => {
    setModifyTarget(pos);
    setEditSl(pos.sl ? String(pos.sl) : '');
    setEditTp(pos.tp ? String(pos.tp) : '');
  };

  const handleSaveModify = () => {
    if (!modifyTarget) return;
    const sl = editSl ? parseFloat(editSl) : undefined;
    const tp = editTp ? parseFloat(editTp) : undefined;
    onModifyPosition(modifyTarget.ticket, sl, tp);
    setModifyTarget(null);
  };

  const totalFloatingPnl = positions.reduce((sum, p) => sum + p.pnl, 0);

  return (
    <div className="space-y-6">
      {/* Simulation Notice Banner */}
      {!isBrokerConnected && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 px-4 flex items-center justify-between text-xs text-amber-300">
          <div className="flex items-center gap-2 font-mono">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">
              SIMULATED
            </span>
            <span>SIMULATION: no broker connected. Orders and positions run in simulated paper mode.</span>
          </div>
        </div>
      )}

      {/* Header Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#0D1322] border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white tracking-tight">Active Market Exposure</h2>
              {!isBrokerConnected && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400 font-mono border border-amber-500/30">
                  SIMULATED
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400 font-mono mt-0.5">
              Floating P&L:{' '}
              <strong className={`tabular-nums ${totalFloatingPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {totalFloatingPnl >= 0 ? `+$${totalFloatingPnl.toFixed(2)}` : `-$${Math.abs(totalFloatingPnl).toFixed(2)}`}
              </strong>
            </div>
          </div>
        </div>

        {/* Tab switch */}
        <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs font-mono">
          <button
            onClick={() => setActiveTab('POSITIONS')}
            className={`px-3 py-1.5 rounded-md font-bold transition-colors ${
              activeTab === 'POSITIONS' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Open Positions ({positions.length})
          </button>
          <button
            onClick={() => setActiveTab('PENDING')}
            className={`px-3 py-1.5 rounded-md font-bold transition-colors ${
              activeTab === 'PENDING' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Pending Orders ({pendingOrders.length})
          </button>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-5 shadow-sm">
        {activeTab === 'POSITIONS' ? (
          positions.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs">
              No active market positions open.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-mono text-[11px]">
                    <th className="py-2.5 px-3">Ticket</th>
                    <th className="py-2.5 px-3">Symbol</th>
                    <th className="py-2.5 px-3">Side</th>
                    <th className="py-2.5 px-3">Volume</th>
                    <th className="py-2.5 px-3">Open Price</th>
                    <th className="py-2.5 px-3">Current Price</th>
                    <th className="py-2.5 px-3">Stop Loss</th>
                    <th className="py-2.5 px-3">Take Profit</th>
                    <th className="py-2.5 px-3 text-right">Pips</th>
                    <th className="py-2.5 px-3 text-right">Floating P&L</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {positions.map((pos) => {
                    const isProfit = pos.pnl >= 0;
                    return (
                      <tr key={pos.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-2.5 px-3 text-slate-400">#{pos.ticket}</td>
                        <td className="py-2.5 px-3 font-bold text-white flex items-center gap-1.5">
                          <span>{pos.symbol}</span>
                          {(!isBrokerConnected || pos.comment?.includes('SIM') || pos.comment?.includes('simulated')) && (
                            <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                              SIMULATED
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            pos.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                          }`}>
                            {pos.side}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">{pos.volume} lots</td>
                        <td className="py-2.5 px-3 text-slate-300">{pos.openPrice}</td>
                        <td className="py-2.5 px-3 text-slate-300">{pos.currentPrice}</td>
                        <td className="py-2.5 px-3 text-slate-400">{pos.sl || 'None'}</td>
                        <td className="py-2.5 px-3 text-slate-400">{pos.tp || 'None'}</td>
                        <td className={`py-2.5 px-3 text-right font-semibold ${pos.pips >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {pos.pips >= 0 ? `+${pos.pips}` : pos.pips}
                        </td>
                        <td className={`py-2.5 px-3 text-right font-bold tabular-nums ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isProfit ? `+$${pos.pnl.toFixed(2)}` : `-$${Math.abs(pos.pnl).toFixed(2)}`}
                        </td>
                        <td className="py-2.5 px-3 text-right space-x-1.5">
                          <button
                            onClick={() => handleOpenModify(pos)}
                            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[10px] font-sans transition-colors"
                          >
                            Modify
                          </button>
                          <button
                            onClick={() => onClosePosition(pos.ticket)}
                            className="px-2 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 rounded text-[10px] font-sans font-semibold transition-colors"
                          >
                            Close
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : pendingOrders.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-xs">
            No active pending orders.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                  <th className="py-2 px-3">Ticket</th>
                  <th className="py-2 px-3">Symbol</th>
                  <th className="py-2 px-3">Order Type</th>
                  <th className="py-2 px-3">Volume</th>
                  <th className="py-2 px-3">Target Price</th>
                  <th className="py-2 px-3">SL</th>
                  <th className="py-2 px-3">TP</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {pendingOrders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-slate-800/30">
                    <td className="py-2 px-3 text-slate-400">#{ord.ticket}</td>
                    <td className="py-2 px-3 font-bold text-white">{ord.symbol}</td>
                    <td className="py-2 px-3 text-blue-400">{ord.type}</td>
                    <td className="py-2 px-3 text-slate-300">{ord.volume}</td>
                    <td className="py-2 px-3 text-slate-300">{ord.price}</td>
                    <td className="py-2 px-3 text-slate-400">{ord.sl || '-'}</td>
                    <td className="py-2 px-3 text-slate-400">{ord.tp || '-'}</td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => onCancelPendingOrder(ord.ticket)}
                        className="px-2 py-1 bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 rounded text-[10px]"
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modify SL/TP Dialog */}
      {modifyTarget && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-5 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-sm font-bold text-white">
                Modify Position #{modifyTarget.ticket}
              </h3>
              <button onClick={() => setModifyTarget(null)} className="text-xs text-slate-400 hover:text-white">
                Cancel
              </button>
            </div>

            <div className="text-xs font-mono space-y-1 text-slate-400">
              <div>Symbol: <span className="text-white font-bold">{modifyTarget.symbol}</span></div>
              <div>Side: <span className={modifyTarget.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}>{modifyTarget.side}</span></div>
              <div>Open Price: <span className="text-white">{modifyTarget.openPrice}</span></div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Stop Loss Price</label>
                <input
                  type="number"
                  step="0.0001"
                  value={editSl}
                  onChange={(e) => setEditSl(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                  placeholder="Leave blank for none"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Take Profit Price</label>
                <input
                  type="number"
                  step="0.0001"
                  value={editTp}
                  onChange={(e) => setEditTp(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                  placeholder="Leave blank for none"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setModifyTarget(null)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
              >
                Close
              </button>
              <button
                onClick={handleSaveModify}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-lg transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
