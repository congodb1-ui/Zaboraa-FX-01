import React, { useState, useMemo, useRef } from 'react';
import { Candle, SymbolName, Timeframe } from '../types/forex';
import { calculateSMA, calculateEMA, calculateBollingerBands, SYMBOL_SPECS } from '../services/marketData';
import { ZoomIn, ZoomOut, RotateCcw, Eye, EyeOff } from 'lucide-react';

interface CandlestickChartProps {
  symbol: SymbolName;
  timeframe: Timeframe;
  candles: Candle[];
  onSelectTimeframe: (tf: Timeframe) => void;
  height?: number;
  tradeMarkers?: { time: number; price: number; direction: 'BUY' | 'SELL'; pnl?: number }[];
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  symbol,
  timeframe,
  candles,
  onSelectTimeframe,
  height = 460,
  tradeMarkers = [],
}) => {
  const [visibleCount, setVisibleCount] = useState(70);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showSMA, setShowSMA] = useState(true);
  const [showEMA, setShowEMA] = useState(true);
  const [showBB, setShowBB] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  const timeframes: Timeframe[] = ['M1', 'M5', 'M15', 'H1', 'H4', 'D1'];
  const spec = SYMBOL_SPECS[symbol];

  // Slice visible candles
  const visibleCandles = useMemo(() => {
    if (candles.length <= visibleCount) return candles;
    return candles.slice(candles.length - visibleCount);
  }, [candles, visibleCount]);

  // Indicator series
  const allCloses = useMemo(() => candles.map((c) => c.close), [candles]);
  const sma20 = useMemo(() => calculateSMA(allCloses, 20), [allCloses]);
  const ema50 = useMemo(() => calculateEMA(allCloses, 50), [allCloses]);
  const bb = useMemo(() => calculateBollingerBands(allCloses, 20, 2), [allCloses]);

  // Align indicator values with visible candles
  const offset = candles.length - visibleCandles.length;
  const visibleSma20 = useMemo(() => sma20.slice(offset), [sma20, offset]);
  const visibleEma50 = useMemo(() => ema50.slice(offset), [ema50, offset]);
  const visibleBbUpper = useMemo(() => bb.upper.slice(offset), [bb, offset]);
  const visibleBbLower = useMemo(() => bb.lower.slice(offset), [bb, offset]);

  // Calculate scales
  const { minPrice, maxPrice, maxVolume } = useMemo(() => {
    if (visibleCandles.length === 0) return { minPrice: 1, maxPrice: 1.1, maxVolume: 1000 };
    let min = Infinity;
    let max = -Infinity;
    let maxVol = 0;

    for (const c of visibleCandles) {
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
      if (c.tickVolume > maxVol) maxVol = c.tickVolume;
    }

    const pad = (max - min) * 0.08 || 0.001;
    return { minPrice: min - pad, maxPrice: max + pad, maxVolume: maxVol };
  }, [visibleCandles]);

  const chartWidth = 900;
  const chartHeight = height - 80;
  const priceRange = maxPrice - minPrice || 0.0001;

  const getY = (price: number) => {
    return chartHeight - ((price - minPrice) / priceRange) * chartHeight;
  };

  const candleSpacing = chartWidth / (visibleCandles.length || 1);
  const candleBodyWidth = Math.max(2, Math.min(10, candleSpacing * 0.7));

  const hoveredCandle = hoverIndex !== null && visibleCandles[hoverIndex] ? visibleCandles[hoverIndex] : visibleCandles[visibleCandles.length - 1];

  return (
    <div className="bg-[#0D1322] border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-lg select-none">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-base font-bold text-white font-mono">{symbol}</span>
            <span className="text-xs text-slate-500 font-mono">({symbol}m)</span>
          </div>

          <div className="h-4 w-px bg-slate-800" />

          {/* Timeframe Selector */}
          <div className="flex items-center gap-1 bg-slate-900/90 p-0.5 rounded-lg border border-slate-800">
            {timeframes.map((tf) => (
              <button
                key={tf}
                onClick={() => onSelectTimeframe(tf)}
                className={`px-2 py-0.5 text-xs font-mono font-medium rounded transition-colors ${
                  timeframe === tf
                    ? 'bg-blue-600 text-white font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-slate-800" />

          {/* Indicator toggles */}
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setShowSMA(!showSMA)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded border transition-colors ${
                showSMA ? 'border-amber-500/40 bg-amber-500/10 text-amber-400' : 'border-slate-800 text-slate-500'
              }`}
            >
              <span>SMA 20</span>
            </button>
            <button
              onClick={() => setShowEMA(!showEMA)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded border transition-colors ${
                showEMA ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400' : 'border-slate-800 text-slate-500'
              }`}
            >
              <span>EMA 50</span>
            </button>
            <button
              onClick={() => setShowBB(!showBB)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded border transition-colors ${
                showBB ? 'border-blue-500/40 bg-blue-500/10 text-blue-400' : 'border-slate-800 text-slate-500'
              }`}
            >
              <span>BB 20</span>
            </button>
          </div>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1 text-slate-400">
          <button
            onClick={() => setVisibleCount((v) => Math.min(180, v + 20))}
            className="p-1.5 hover:bg-slate-800 rounded text-slate-300 hover:text-white"
            title="Zoom Out (Show More)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setVisibleCount((v) => Math.max(30, v - 20))}
            className="p-1.5 hover:bg-slate-800 rounded text-slate-300 hover:text-white"
            title="Zoom In (Show Less)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setVisibleCount(70)}
            className="p-1.5 hover:bg-slate-800 rounded text-slate-300 hover:text-white"
            title="Reset View"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Hover OHLC Telemetry */}
      {hoveredCandle && (
        <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-slate-400 bg-slate-900/60 px-3 py-1.5 rounded-lg border border-slate-800/80">
          <div>Time: <span className="text-slate-200">{new Date(hoveredCandle.time * 1000).toUTCString().slice(17, 25)} UTC</span></div>
          <div>O: <span className="text-slate-200">{hoveredCandle.open.toFixed(spec.digits)}</span></div>
          <div>H: <span className="text-slate-200">{hoveredCandle.high.toFixed(spec.digits)}</span></div>
          <div>L: <span className="text-slate-200">{hoveredCandle.low.toFixed(spec.digits)}</span></div>
          <div>C: <span className={hoveredCandle.close >= hoveredCandle.open ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>{hoveredCandle.close.toFixed(spec.digits)}</span></div>
          <div>Spread: <span className="text-amber-400">{hoveredCandle.spread} pips</span></div>
          <div>Vol: <span className="text-slate-300">{hoveredCandle.tickVolume}</span></div>
        </div>
      )}

      {/* Candlestick SVG Container */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden cursor-crosshair"
        style={{ height: chartHeight + 40 }}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight + 40}`}
          className="w-full h-full"
          preserveAspectRatio="none"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = ((e.clientX - rect.left) / rect.width) * chartWidth;
            const idx = Math.floor(relX / candleSpacing);
            if (idx >= 0 && idx < visibleCandles.length) {
              setHoverIndex(idx);
            }
          }}
        >
          <defs>
            <pattern id="grid" width="60" height="40" patternUnits="userSpaceOnUse">
              <path d="M 60 0 L 0 0 0 60" fill="none" stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1" />
            </pattern>
          </defs>

          {/* Background Grid */}
          <rect width={chartWidth} height={chartHeight} fill="url(#grid)" />

          {/* Horizontal Price Grid Lines */}
          {[0.2, 0.4, 0.6, 0.8].map((ratio, idx) => {
            const y = chartHeight * ratio;
            const price = maxPrice - ratio * priceRange;
            return (
              <g key={idx}>
                <line x1="0" y1={y} x2={chartWidth} y2={y} stroke="rgba(255, 255, 255, 0.06)" strokeDasharray="3 3" />
                <text x={chartWidth - 5} y={y - 4} textAnchor="end" fill="#64748b" fontSize="10" fontFamily="JetBrains Mono">
                  {price.toFixed(spec.digits)}
                </text>
              </g>
            );
          })}

          {/* Volume bars at bottom */}
          {visibleCandles.map((c, i) => {
            const x = i * candleSpacing + candleSpacing / 2;
            const volHeight = (c.tickVolume / (maxVolume || 1)) * 30;
            const isGreen = c.close >= c.open;
            return (
              <rect
                key={`vol_${i}`}
                x={x - candleBodyWidth / 2}
                y={chartHeight - volHeight}
                width={candleBodyWidth}
                height={volHeight}
                fill={isGreen ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'}
              />
            );
          })}

          {/* Bollinger Bands */}
          {showBB && (
            <>
              <polyline
                fill="none"
                stroke="#3b82f6"
                strokeWidth="1.2"
                strokeDasharray="2 2"
                points={visibleCandles
                  .map((_, i) => {
                    const val = visibleBbUpper[i];
                    if (!val) return null;
                    return `${i * candleSpacing + candleSpacing / 2},${getY(val)}`;
                  })
                  .filter(Boolean)
                  .join(' ')}
              />
              <polyline
                fill="none"
                stroke="#3b82f6"
                strokeWidth="1.2"
                strokeDasharray="2 2"
                points={visibleCandles
                  .map((_, i) => {
                    const val = visibleBbLower[i];
                    if (!val) return null;
                    return `${i * candleSpacing + candleSpacing / 2},${getY(val)}`;
                  })
                  .filter(Boolean)
                  .join(' ')}
              />
            </>
          )}

          {/* SMA 20 Overlay */}
          {showSMA && (
            <polyline
              fill="none"
              stroke="#f59e0b"
              strokeWidth="1.6"
              points={visibleCandles
                .map((_, i) => {
                  const val = visibleSma20[i];
                  if (!val) return null;
                  return `${i * candleSpacing + candleSpacing / 2},${getY(val)}`;
                })
                .filter(Boolean)
                .join(' ')}
            />
          )}

          {/* EMA 50 Overlay */}
          {showEMA && (
            <polyline
              fill="none"
              stroke="#06b6d4"
              strokeWidth="1.6"
              points={visibleCandles
                .map((_, i) => {
                  const val = visibleEma50[i];
                  if (!val) return null;
                  return `${i * candleSpacing + candleSpacing / 2},${getY(val)}`;
                })
                .filter(Boolean)
                .join(' ')}
            />
          )}

          {/* Candlesticks */}
          {visibleCandles.map((c, i) => {
            const x = i * candleSpacing + candleSpacing / 2;
            const yHigh = getY(c.high);
            const yLow = getY(c.low);
            const yOpen = getY(c.open);
            const yClose = getY(c.close);

            const isBullish = c.close >= c.open;
            const candleColor = isBullish ? '#10b981' : '#ef4444';
            const bodyTop = Math.min(yOpen, yClose);
            const bodyHeight = Math.max(1.5, Math.abs(yClose - yOpen));

            return (
              <g key={`candle_${i}`}>
                {/* High-Low Wick */}
                <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={candleColor} strokeWidth="1.2" />
                {/* Candle Body */}
                <rect
                  x={x - candleBodyWidth / 2}
                  y={bodyTop}
                  width={candleBodyWidth}
                  height={bodyHeight}
                  fill={candleColor}
                  rx="0.5"
                />
              </g>
            );
          })}

          {/* Trade Markers */}
          {tradeMarkers.map((marker, idx) => {
            const candleIdx = visibleCandles.findIndex((c) => Math.abs(c.time - marker.time) < 1800);
            if (candleIdx === -1) return null;

            const x = candleIdx * candleSpacing + candleSpacing / 2;
            const y = getY(marker.price);
            const isBuy = marker.direction === 'BUY';

            return (
              <g key={`marker_${idx}`}>
                <polygon
                  points={
                    isBuy
                      ? `${x},${y + 12} ${x - 5},${y + 20} ${x + 5},${y + 20}`
                      : `${x},${y - 12} ${x - 5},${y - 20} ${x + 5},${y - 20}`
                  }
                  fill={isBuy ? '#10b981' : '#ef4444'}
                  stroke="#ffffff"
                  strokeWidth="0.8"
                />
              </g>
            );
          })}

          {/* Crosshair on hover */}
          {hoverIndex !== null && hoverIndex < visibleCandles.length && (
            <g>
              <line
                x1={hoverIndex * candleSpacing + candleSpacing / 2}
                y1="0"
                x2={hoverIndex * candleSpacing + candleSpacing / 2}
                y2={chartHeight}
                stroke="#94a3b8"
                strokeDasharray="2 2"
                strokeWidth="0.8"
              />
              <line
                x1="0"
                y1={getY(visibleCandles[hoverIndex].close)}
                x2={chartWidth}
                y2={getY(visibleCandles[hoverIndex].close)}
                stroke="#94a3b8"
                strokeDasharray="2 2"
                strokeWidth="0.8"
              />
            </g>
          )}
        </svg>
      </div>
    </div>
  );
};
