import React, { useState } from 'react';
import { Candle, SymbolName, Timeframe, BrokerAccount } from '../types/forex';
import { CandlestickChart } from './CandlestickChart';
import { SYMBOL_SPECS } from '../services/marketData';
import { ArrowUpRight, ArrowDownRight, Info, ShieldCheck } from 'lucide-react';

interface MarketsViewProps {
  account: BrokerAccount;
  currentSymbol: SymbolName;
  currentTimeframe: Timeframe;
  candles: Candle[];
  onSelectSymbol: (symbol: SymbolName) => void;
  onSelectTimeframe: (tf: Timeframe) => void;
  onPlaceOrder: (order: {
    symbol: SymbolName;
    side: 'BUY' | 'SELL';
    volume: number;
    sl?: number;
    tp?: number;
  }) => void;
}

export const MarketsView: React.FC<MarketsViewProps> = ({
  account,
  currentSymbol,
  currentTimeframe,
  candles,
  onSelectSymbol,
  onSelectTimeframe,
  onPlaceOrder,
}) => {
  const [orderSide, setOrderSide] = useState<'BUY' | 'SELL'>('BUY');
  const [lotSize, setLotSize] = useState<number>(0.1);
  const [slPips, setSlPips] = useState<number>(30);
  const [tpPips, setTpPips] = useState<number>(60);
  const [orderSubmittedMessage, setOrderSubmittedMessage] = useState<string | null>(null);

  const symbols: SymbolName[] = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'];
  const spec = SYMBOL_SPECS[currentSymbol];
  const pipMultiplier = currentSymbol === 'XAUUSD' ? 1.0 : (currentSymbol === 'USDJPY' ? 0.01 : 0.0001);

  const currentPrice = orderSide === 'BUY' ? spec.ask : spec.bid;
  const calculatedSL = orderSide === 'BUY'
    ? Number((currentPrice - slPips * pipMultiplier).toFixed(spec.digits))
    : Number((currentPrice + slPips * pipMultiplier).toFixed(spec.digits));

  const calculatedTP = orderSide === 'BUY'
    ? Number((currentPrice + tpPips * pipMultiplier).toFixed(spec.digits))
    : Number((currentPrice - tpPips * pipMultiplier).toFixed(spec.digits));

  const estRiskUSD = slPips * spec.pipValuePerLotUSD * lotSize;
  const estRewardUSD = tpPips * spec.pipValuePerLotUSD * lotSize;
  const marginRequiredUSD = (lotSize * spec.contractSize * (currentSymbol === 'XAUUSD' ? currentPrice : 1)) / account.leverage;

  const handleSubmitOrder = () => {
    onPlaceOrder({
      symbol: currentSymbol,
      side: orderSide,
      volume: lotSize,
      sl: calculatedSL,
      tp: calculatedTP,
    });

    setOrderSubmittedMessage(`Order executed: ${orderSide} ${lotSize} lots ${currentSymbol} at ${currentPrice.toFixed(spec.digits)}`);
    setTimeout(() => setOrderSubmittedMessage(null), 4000);
  };

  return (
    <div className="space-y-4">
      {/* Simulation Notice Banner */}
      {(!account.isConnected || account.isSimulated) && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-2.5 px-3.5 flex items-center justify-between text-xs text-amber-300">
          <div className="flex items-center gap-2 font-mono">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">
              SIMULATED
            </span>
            <span>SIMULATION: no broker connected. Order ticket executes locally in simulated mode.</span>
          </div>
        </div>
      )}

      {/* Symbol Tabs */}
      <div className="flex items-center justify-between bg-[#0B101D] border border-slate-800 p-1.5 rounded-xl">
        <div className="flex items-center gap-1">
          {symbols.map((sym) => {
            const isSelected = currentSymbol === sym;
            const s = SYMBOL_SPECS[sym];
            return (
              <button
                key={sym}
                onClick={() => onSelectSymbol(sym)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono transition-all ${
                  isSelected
                    ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-900/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                }`}
              >
                <span>{sym}</span>
                <span className={`text-[10px] ${isSelected ? 'text-blue-200' : 'text-slate-500'}`}>
                  {s.spreadPips}p
                </span>
              </button>
            );
          })}
        </div>

        <div className="text-xs text-slate-400 font-mono hidden sm:flex items-center gap-3 pr-2">
          <span>Broker: <strong className="text-white">Exness ({account.mode})</strong></span>
          <span>Suffix: <strong className="text-white">{account.symbolSuffix || 'none'}</strong></span>
        </div>
      </div>

      {orderSubmittedMessage && (
        <div className="p-3 bg-emerald-950/60 border border-emerald-500/50 rounded-xl text-xs text-emerald-300 font-mono flex items-center justify-between animate-fadeIn">
          <span>{orderSubmittedMessage}</span>
          <span className="text-[10px] text-emerald-400">Filled instantly</span>
        </div>
      )}

      {/* Main Grid: Candlestick Chart (70%) + Order Ticket (30%) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3">
          <CandlestickChart
            symbol={currentSymbol}
            timeframe={currentTimeframe}
            candles={candles}
            onSelectTimeframe={onSelectTimeframe}
            height={520}
          />
        </div>

        {/* Live Order Ticket */}
        <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-lg">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Market Order Ticket</h3>
              <span className="text-[11px] font-mono text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                {currentSymbol}{account.symbolSuffix}
              </span>
            </div>

            {/* Buy / Sell Selector */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setOrderSide('BUY')}
                className={`p-3 rounded-lg border flex flex-col items-center justify-center transition-all ${
                  orderSide === 'BUY'
                    ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-900/40'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1 text-xs font-bold uppercase">
                  <ArrowUpRight className="w-3.5 h-3.5" /> BUY
                </div>
                <div className="text-sm font-mono font-bold mt-1 tabular-nums">
                  {spec.ask.toFixed(spec.digits)}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setOrderSide('SELL')}
                className={`p-3 rounded-lg border flex flex-col items-center justify-center transition-all ${
                  orderSide === 'SELL'
                    ? 'bg-rose-600 border-rose-500 text-white shadow-lg shadow-rose-900/40'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1 text-xs font-bold uppercase">
                  <ArrowDownRight className="w-3.5 h-3.5" /> SELL
                </div>
                <div className="text-sm font-mono font-bold mt-1 tabular-nums">
                  {spec.bid.toFixed(spec.digits)}
                </div>
              </button>
            </div>

            {/* Lot Size */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Volume (Lots)</span>
                <span className="font-mono text-slate-500 text-[11px]">Step: {spec.stepVolume}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setLotSize((v) => Math.max(spec.minVolume, Number((v - 0.05).toFixed(2))))}
                  className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-slate-300 text-xs font-mono font-bold"
                >
                  -0.05
                </button>
                <input
                  type="number"
                  step={spec.stepVolume}
                  min={spec.minVolume}
                  max={spec.maxVolume}
                  value={lotSize}
                  onChange={(e) => setLotSize(Math.max(spec.minVolume, Number(parseFloat(e.target.value) || spec.minVolume)))}
                  className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-1.5 text-center font-mono text-white text-sm focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setLotSize((v) => Math.min(spec.maxVolume, Number((v + 0.05).toFixed(2))))}
                  className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-slate-300 text-xs font-mono font-bold"
                >
                  +0.05
                </button>
              </div>
            </div>

            {/* Stop Loss & Take Profit */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <label className="text-slate-400 flex items-center justify-between text-[11px]">
                  <span>Stop Loss (Pips)</span>
                  <span className="text-rose-400 font-mono">-${estRiskUSD.toFixed(1)}</span>
                </label>
                <input
                  type="number"
                  min="5"
                  max="500"
                  value={slPips}
                  onChange={(e) => setSlPips(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 font-mono text-white text-xs focus:outline-none focus:border-rose-500"
                />
                <div className="text-[10px] text-slate-500 font-mono">Price: {calculatedSL}</div>
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 flex items-center justify-between text-[11px]">
                  <span>Take Profit (Pips)</span>
                  <span className="text-emerald-400 font-mono">+${estRewardUSD.toFixed(1)}</span>
                </label>
                <input
                  type="number"
                  min="5"
                  max="1000"
                  value={tpPips}
                  onChange={(e) => setTpPips(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 font-mono text-white text-xs focus:outline-none focus:border-emerald-500"
                />
                <div className="text-[10px] text-slate-500 font-mono">Price: {calculatedTP}</div>
              </div>
            </div>

            {/* Margin Requirement Summary */}
            <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 text-xs font-mono space-y-1 text-slate-400">
              <div className="flex items-center justify-between">
                <span>Margin Needed:</span>
                <span className="text-slate-200">${marginRequiredUSD.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Spread Cost:</span>
                <span className="text-slate-200">${(spec.spreadPips * spec.pipValuePerLotUSD * lotSize).toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>R:R Ratio:</span>
                <span className="text-blue-400 font-bold">1:{(tpPips / (slPips || 1)).toFixed(1)}</span>
              </div>
            </div>
          </div>

          <div className="pt-4 space-y-2">
            <button
              type="button"
              onClick={handleSubmitOrder}
              className={`w-full py-2.5 rounded-lg text-white font-bold text-xs uppercase tracking-wider transition-all shadow-lg ${
                orderSide === 'BUY'
                  ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-950/50'
                  : 'bg-rose-600 hover:bg-rose-500 shadow-rose-950/50'
              }`}
            >
              Execute {orderSide} {lotSize} Lot
            </button>
            <div className="flex items-center justify-center gap-1 text-[10px] text-slate-500 text-center">
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              <span>Broker-side SL & TP guaranteed attached</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
