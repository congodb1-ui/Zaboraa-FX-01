import React, { useState } from 'react';
import { JournalEntry, SymbolName } from '../types/forex';
import { BookOpen, Tag, Plus, Star, Calendar, Clock, BarChart2 } from 'lucide-react';

interface JournalViewProps {
  entries: JournalEntry[];
  onAddEntry: (entry: JournalEntry) => void;
}

export const JournalView: React.FC<JournalViewProps> = ({ entries, onAddEntry }) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [ticket, setTicket] = useState(10482);
  const [symbol, setSymbol] = useState<SymbolName>('EURUSD');
  const [pnl, setPnl] = useState(145.2);
  const [tags, setTags] = useState('Trend Follow, Asian Session, London Break');
  const [notes, setNotes] = useState('Clean breakout of Asian range after London open. Followed strict 1.5% risk rule.');
  const [rating, setRating] = useState(5);

  const handleAdd = () => {
    const newEntry: JournalEntry = {
      id: `j_${Date.now()}`,
      tradeTicket: ticket,
      symbol,
      pnl,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      notes,
      rating,
      createdAt: new Date().toISOString(),
    };
    onAddEntry(newEntry);
    setShowAddModal(false);
  };

  // Performance breakdown by weekday
  const weekdayStats = [
    { day: 'Mon', pnl: 420.5, winRate: 62 },
    { day: 'Tue', pnl: 890.0, winRate: 71 },
    { day: 'Wed', pnl: -140.2, winRate: 48 },
    { day: 'Thu', pnl: 1120.4, winRate: 75 },
    { day: 'Fri', pnl: 310.0, winRate: 58 },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#0D1322] border border-slate-800 rounded-xl p-5 shadow-sm">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-blue-400" />
            Quantitative Trading Journal & Behavioral Analytics
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Log trade context, emotional discipline, and session performance breakdowns
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-lg flex items-center gap-1.5 transition-all shadow-md shadow-blue-900/30"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Journal Entry</span>
        </button>
      </div>

      {/* Weekday Performance Breakdown */}
      <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-5 shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
          <BarChart2 className="w-3.5 h-3.5 text-emerald-400" />
          Execution Breakdown by Day of Week
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono text-xs">
          {weekdayStats.map((stat) => (
            <div key={stat.day} className="bg-slate-900/80 p-3 rounded-lg border border-slate-800">
              <div className="flex justify-between items-center text-slate-400 mb-1">
                <span className="font-bold text-white">{stat.day}</span>
                <span className="text-[10px] text-slate-500">{stat.winRate}% Win</span>
              </div>
              <div className={`text-sm font-bold ${stat.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {stat.pnl >= 0 ? `+$${stat.pnl.toFixed(1)}` : `-$${Math.abs(stat.pnl).toFixed(1)}`}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Journal Entries List */}
      <div className="space-y-3">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="bg-[#0D1322] border border-slate-800 hover:border-slate-700 rounded-xl p-4 transition-all shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2 mb-2">
              <div className="flex items-center gap-3">
                <span className="font-mono text-slate-400 text-xs font-bold">Trade #{entry.tradeTicket}</span>
                <span className="font-mono text-white text-xs font-bold">{entry.symbol}</span>
                <span className={`font-mono text-xs font-bold ${entry.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {entry.pnl >= 0 ? `+$${entry.pnl.toFixed(2)}` : `-$${Math.abs(entry.pnl).toFixed(2)}`}
                </span>
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
                <span>{entry.createdAt.slice(0, 10)}</span>
                <div className="flex items-center text-amber-400">
                  {Array.from({ length: entry.rating }).map((_, i) => (
                    <Star key={i} className="w-3 h-3 fill-amber-400" />
                  ))}
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-3">
              {entry.notes}
            </p>

            <div className="flex flex-wrap gap-1.5">
              {entry.tags.map((tag, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono text-blue-400"
                >
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* New Journal Entry Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-sm font-bold text-white">Log Trading Journal Record</h3>
              <button onClick={() => setShowAddModal(false)} className="text-xs text-slate-400 hover:text-white">
                Cancel
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Ticket Number</label>
                  <input
                    type="number"
                    value={ticket}
                    onChange={(e) => setTicket(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Symbol</label>
                  <select
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value as SymbolName)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                  >
                    <option value="EURUSD">EURUSD</option>
                    <option value="GBPUSD">GBPUSD</option>
                    <option value="USDJPY">USDJPY</option>
                    <option value="XAUUSD">XAUUSD</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Realized Net P&L ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={pnl}
                  onChange={(e) => setPnl(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Tags (Comma-separated)</label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Trade Notes & Execution Rationale</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white h-20 text-xs resize-none"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-lg transition-colors"
              >
                Save Entry
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
