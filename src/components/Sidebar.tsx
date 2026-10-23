import React from 'react';
import {
  LayoutDashboard,
  TrendingUp,
  Database,
  Code2,
  Sparkles,
  FlaskConical,
  Bot,
  Layers,
  BookOpen,
  Sliders,
  Cpu,
} from 'lucide-react';

export type ActiveTab =
  | 'dashboard'
  | 'markets'
  | 'data'
  | 'strategies'
  | 'pine'
  | 'backtest'
  | 'optimizations'
  | 'bots'
  | 'positions'
  | 'journal'
  | 'settings';

interface SidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  openPositionsCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  openPositionsCount,
}) => {
  const navItems: { id: ActiveTab; label: string; icon: React.FC<{ className?: string }>; badge?: number }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'markets', label: 'Live Markets', icon: TrendingUp },
    { id: 'data', label: 'Data Catalog', icon: Database },
    { id: 'strategies', label: 'Strategy Studio', icon: Code2 },
    { id: 'pine', label: 'Pine Script AI', icon: Sparkles },
    { id: 'backtest', label: 'Backtesting Lab', icon: FlaskConical },
    { id: 'optimizations', label: 'Optimization Suite', icon: Cpu },
    { id: 'bots', label: 'Automated Bots', icon: Bot },
    { id: 'positions', label: 'Positions & Orders', icon: Layers, badge: openPositionsCount },
    { id: 'journal', label: 'Trade Journal', icon: BookOpen },
    { id: 'settings', label: 'Settings & Bridge', icon: Sliders },
  ];

  return (
    <aside className="w-56 shrink-0 bg-[#0B101D] border-r border-slate-800/80 flex flex-col justify-between py-3 select-none">
      <div className="space-y-1 px-2">
        <div className="px-3 py-1.5 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
          Portal Workspaces
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all group ${
                isActive
                  ? 'bg-blue-600/15 text-blue-400 font-semibold shadow-inner'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Icon
                  className={`w-4 h-4 transition-colors ${
                    isActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'
                  }`}
                />
                <span className="whitespace-nowrap">{item.label}</span>
              </div>
              {item.badge !== undefined && item.badge > 0 && (
                <span className="px-1.5 py-0.2 text-[10px] font-mono font-bold bg-blue-500/20 text-blue-400 rounded">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer Info */}
      <div className="px-3 pt-3 border-t border-slate-800/60 text-[11px] text-slate-500 space-y-1 font-mono">
        <div className="flex items-center justify-between">
          <span>Engine Mode:</span>
          <span className="text-slate-300 font-medium">Exness v5.4</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Timezone:</span>
          <span className="text-slate-400">UTC+0</span>
        </div>
      </div>
    </aside>
  );
};
