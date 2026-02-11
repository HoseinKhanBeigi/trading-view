"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useMarketStore } from "@/store";
import { runQuantAnalysis, type QuantState, type CompositeScore, type QuantSignal, type StrategyWeight } from "@/lib/quant-strategy";
import { runBacktest, type BacktestResult } from "@/lib/backtest";
import { type IndicatorSnapshot } from "@/lib/indicators";

// ─── Helper: tiny gauge bar ─────────────────────────────────────────────────

function Gauge({ value, min = -100, max = 100, colorPositive = "emerald", colorNegative = "rose" }: {
  value: number; min?: number; max?: number; colorPositive?: string; colorNegative?: string;
}) {
  const range = max - min;
  const pct = range > 0 ? ((value - min) / range) * 100 : 50;
  const isPositive = value >= 0;
  return (
    <div className="relative h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
      {isPositive ? (
        <div
          className={`absolute top-0 left-1/2 h-full rounded-r-full bg-${colorPositive}-500`}
          style={{ width: `${Math.min(50, (value / max) * 50)}%` }}
        />
      ) : (
        <div
          className={`absolute top-0 h-full rounded-l-full bg-${colorNegative}-500`}
          style={{ width: `${Math.min(50, (Math.abs(value) / Math.abs(min)) * 50)}%`, right: '50%' }}
        />
      )}
      <div className="absolute top-0 left-1/2 w-px h-full bg-zinc-400 dark:bg-zinc-500" />
    </div>
  );
}

function ScoreBar({ value, label }: { value: number; label: string }) {
  const color = value > 20 ? 'text-emerald-600 dark:text-emerald-400'
    : value < -20 ? 'text-rose-600 dark:text-rose-400'
    : 'text-zinc-500 dark:text-zinc-400';
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 w-20 shrink-0">{label}</span>
      <div className="flex-1">
        <Gauge value={value} />
      </div>
      <span className={`text-[10px] font-mono font-bold w-10 text-right ${color}`}>
        {value > 0 ? '+' : ''}{value.toFixed(0)}
      </span>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/60 p-2 text-center">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{label}</div>
      <div className={`font-mono font-black text-sm tabular-nums ${color ?? 'dark-mode-text'}`}>{value}</div>
      {sub && <div className="text-[9px] text-zinc-400 dark:text-zinc-500">{sub}</div>}
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

export default function QuantPanel() {
  const candles = useMarketStore((s) => s.candles);
  const strategyWeights = useMarketStore((s) => s.strategyWeights);
  const toggleStrategy = useMarketStore((s) => s.toggleStrategy);
  const setQuantState = useMarketStore((s) => s.setQuantState);
  const setBacktestResult = useMarketStore((s) => s.setBacktestResult);
  const backtestResult = useMarketStore((s) => s.backtestResult);

  const [quantData, setQuantData] = useState<QuantState | null>(null);
  const [isBacktesting, setIsBacktesting] = useState(false);
  const [tab, setTab] = useState<'signals' | 'indicators' | 'backtest' | 'strategies'>('signals');
  const lastUpdateRef = useRef(0);

  // ── Run quant analysis when candles update ──
  useEffect(() => {
    if (candles.length < 50) return;
    const now = Date.now();
    if (now - lastUpdateRef.current < 2000) return; // Throttle to 2s
    lastUpdateRef.current = now;

    const result = runQuantAnalysis(candles, strategyWeights);
    setQuantData(result);
    setQuantState(result);
  }, [candles, strategyWeights, setQuantState]);

  // ── Run backtest ──
  const handleBacktest = useCallback(() => {
    if (candles.length < 100) return;
    setIsBacktesting(true);
    // Use setTimeout to not block the UI
    setTimeout(() => {
      const result = runBacktest(candles, {
        initialCapital: 10000,
        positionSizePct: 2,
        signalThreshold: 25,
        strategyWeights,
      });
      setBacktestResult(result);
      setIsBacktesting(false);
    }, 50);
  }, [candles, strategyWeights, setBacktestResult]);

  const composite = quantData?.composite;
  const indicators = quantData?.indicators;
  const signals = quantData?.signals ?? [];

  if (!quantData || !composite) {
    return (
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <span className="font-black text-sm tracking-wide uppercase text-indigo-700 dark:text-indigo-300">⚡ Quant Engine</span>
        </div>
        <div className="p-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
          {candles.length < 50
            ? `Waiting for data… (${candles.length}/50 candles)`
            : 'Analyzing…'}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-sm overflow-hidden">
      {/* ══ Header ══ */}
      <div className="px-3 sm:px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-gradient-to-r from-indigo-50 via-white to-violet-50 dark:from-indigo-950/30 dark:via-zinc-900 dark:to-violet-950/30">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-black text-sm tracking-wide uppercase text-indigo-700 dark:text-indigo-300">⚡ Quant Engine</span>

          {/* Direction badge */}
          <span className={`px-2.5 py-1 rounded-full font-bold text-[11px] uppercase tracking-wider ${
            composite.direction === 'LONG'
              ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30'
              : composite.direction === 'SHORT'
              ? 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/30'
              : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
          }`}>
            {composite.direction === 'LONG' ? '🟢' : composite.direction === 'SHORT' ? '🔴' : '⚪'} {composite.direction}
          </span>

          {/* Composite score */}
          <span className={`px-2 py-0.5 rounded font-mono font-bold text-xs ${
            composite.score > 30 ? 'text-emerald-600 dark:text-emerald-400'
            : composite.score < -30 ? 'text-rose-600 dark:text-rose-400'
            : 'text-zinc-500 dark:text-zinc-400'
          }`}>
            Score: {composite.score > 0 ? '+' : ''}{composite.score.toFixed(0)}
          </span>

          {/* Confidence */}
          <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
            composite.confidence >= 60 ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
            : composite.confidence >= 35 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
            : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'
          }`}>
            {composite.confidence.toFixed(0)}% conf
          </span>

          {/* Volatility regime */}
          <span className={`text-[10px] px-2 py-0.5 rounded ${
            composite.riskMetrics.volatilityRegime === 'low' ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400'
            : composite.riskMetrics.volatilityRegime === 'normal' ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
            : composite.riskMetrics.volatilityRegime === 'high' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
            : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
          }`}>
            Vol: {composite.riskMetrics.volatilityRegime}
          </span>
        </div>
      </div>

      {/* ══ Tab Navigation ══ */}
      <div className="flex border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30">
        {(['signals', 'indicators', 'strategies', 'backtest'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
              tab === t
                ? 'text-indigo-700 dark:text-indigo-300 border-b-2 border-indigo-500 bg-white dark:bg-zinc-950'
                : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'
            }`}
          >
            {t === 'signals' ? '📡 Signals' : t === 'indicators' ? '📊 Indicators' : t === 'strategies' ? '🎯 Strategies' : '📈 Backtest'}
          </button>
        ))}
      </div>

      {/* ══ Tab Content ══ */}
      <div className="max-h-[500px] overflow-y-auto">
        {tab === 'signals' && <SignalsTab composite={composite} signals={signals} />}
        {tab === 'indicators' && indicators && <IndicatorsTab indicators={indicators} />}
        {tab === 'strategies' && (
          <StrategiesTab
            weights={strategyWeights}
            toggleStrategy={toggleStrategy}
            composite={composite}
          />
        )}
        {tab === 'backtest' && (
          <BacktestTab
            result={backtestResult}
            isRunning={isBacktesting}
            onRun={handleBacktest}
            candleCount={candles.length}
          />
        )}
      </div>

      {/* ══ Risk Metrics Footer ══ */}
      <div className="px-3 sm:px-4 py-2 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20 flex flex-wrap items-center gap-3 text-[10px] text-zinc-500 dark:text-zinc-400">
        <span>
          Kelly: <strong className="dark-mode-text">{(composite.riskMetrics.kellyFraction * 100).toFixed(1)}%</strong>
        </span>
        <span>
          Size: <strong className="dark-mode-text">{composite.riskMetrics.positionSizePct.toFixed(1)}%</strong>
        </span>
        <span>
          Max Loss: <strong className="text-rose-500">{composite.riskMetrics.maxLoss.toFixed(2)}%</strong>
        </span>
        <span className="ml-auto text-zinc-400 dark:text-zinc-600">
          Updated {new Date(quantData.lastUpdate).toLocaleTimeString()}
        </span>
      </div>
    </section>
  );
}

// ─── Signals Tab ─────────────────────────────────────────────────────────────

function SignalsTab({ composite, signals }: { composite: CompositeScore; signals: QuantSignal[] }) {
  return (
    <div className="p-3 space-y-3">
      {/* Breakdown gauges */}
      <div className="space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-1">Score Breakdown</div>
        <ScoreBar label="Indicators" value={composite.breakdown.indicators} />
        <ScoreBar label="Price Action" value={composite.breakdown.priceAction} />
        <ScoreBar label="Momentum" value={composite.breakdown.momentum} />
        <ScoreBar label="Volatility" value={composite.breakdown.volatility} />
        <ScoreBar label="Trend" value={composite.breakdown.trend} />
      </div>

      {/* Active signals */}
      {signals.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Strategy Signals</div>
          {signals.map((sig, idx) => (
            <div
              key={idx}
              className={`rounded-lg p-2 text-xs ${
                sig.direction === 'LONG'
                  ? 'bg-emerald-50 dark:bg-emerald-950/20 ring-1 ring-emerald-200 dark:ring-emerald-800/40'
                  : 'bg-rose-50 dark:bg-rose-950/20 ring-1 ring-rose-200 dark:ring-rose-800/40'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`font-bold ${sig.direction === 'LONG' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {sig.direction === 'LONG' ? '🟢' : '🔴'} {sig.direction}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-[10px] font-semibold">
                  {sig.strategy}
                </span>
                <span className="text-[10px] text-zinc-400 ml-auto">{sig.strength}% str</span>
              </div>
              <div className="flex gap-3 text-[10px] font-mono">
                <span>Entry: <strong className="dark-mode-text">{sig.entry.toFixed(2)}</strong></span>
                <span>SL: <strong className="text-rose-500">{sig.stopLoss.toFixed(2)}</strong></span>
                <span>TP: <strong className="text-emerald-500">{sig.takeProfit.toFixed(2)}</strong></span>
                <span>R:R <strong className="dark-mode-text">{sig.riskReward.toFixed(1)}</strong></span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {sig.reasons.map((r, i) => (
                  <span key={i} className="px-1 py-0.5 rounded text-[8px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                    {r}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-4 text-xs text-zinc-400 dark:text-zinc-500">
          No active signals — market is neutral
        </div>
      )}
    </div>
  );
}

// ─── Indicators Tab ──────────────────────────────────────────────────────────

function IndicatorsTab({ indicators }: { indicators: IndicatorSnapshot }) {
  const rsiColor = indicators.rsi > 70 ? 'text-rose-500' : indicators.rsi < 30 ? 'text-emerald-500' : 'dark-mode-text';
  const stochColor = indicators.stochRSI.k > 80 ? 'text-rose-500' : indicators.stochRSI.k < 20 ? 'text-emerald-500' : 'dark-mode-text';

  return (
    <div className="p-3 space-y-3">
      {/* Oscillators */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">Oscillators</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <StatCard label="RSI (14)" value={indicators.rsi.toFixed(1)} color={rsiColor}
            sub={indicators.rsi > 70 ? 'Overbought' : indicators.rsi < 30 ? 'Oversold' : 'Neutral'} />
          <StatCard label="StochRSI %K" value={indicators.stochRSI.k.toFixed(1)} color={stochColor}
            sub={`%D: ${indicators.stochRSI.d.toFixed(1)}`} />
          <StatCard label="CCI (20)" value={indicators.cci.toFixed(0)}
            color={indicators.cci > 100 ? 'text-rose-500' : indicators.cci < -100 ? 'text-emerald-500' : 'dark-mode-text'} />
          <StatCard label="ROC (10)" value={`${indicators.roc > 0 ? '+' : ''}${indicators.roc.toFixed(2)}%`}
            color={indicators.roc > 0 ? 'text-emerald-500' : 'text-rose-500'} />
          <StatCard label="MACD" value={indicators.macd.value.toFixed(4)}
            sub={`Hist: ${indicators.macd.histogram > 0 ? '+' : ''}${indicators.macd.histogram.toFixed(4)}`}
            color={indicators.macd.histogram > 0 ? 'text-emerald-500' : 'text-rose-500'} />
          <StatCard label="ADX (14)" value={isNaN(indicators.adx.value) ? '—' : indicators.adx.value.toFixed(1)}
            sub={!isNaN(indicators.adx.plusDI) ? `+DI: ${indicators.adx.plusDI.toFixed(0)} / -DI: ${indicators.adx.minusDI.toFixed(0)}` : undefined}
            color={!isNaN(indicators.adx.value) && indicators.adx.value > 25 ? 'text-amber-500' : 'dark-mode-text'} />
        </div>
      </div>

      {/* Moving Averages */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">Moving Averages</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCard label="EMA 9" value={indicators.ema9.toFixed(2)} />
          <StatCard label="EMA 21" value={indicators.ema21.toFixed(2)} />
          <StatCard label="EMA 50" value={indicators.ema50.toFixed(2)} />
          <StatCard label="EMA 200" value={indicators.ema200.toFixed(2)} />
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[10px]">
          <span className="text-zinc-400 dark:text-zinc-500">EMA Stack:</span>
          {indicators.ema9 > indicators.ema21 && indicators.ema21 > indicators.ema50 ? (
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓ Bullish aligned</span>
          ) : indicators.ema9 < indicators.ema21 && indicators.ema21 < indicators.ema50 ? (
            <span className="text-rose-600 dark:text-rose-400 font-semibold">✗ Bearish aligned</span>
          ) : (
            <span className="text-amber-600 dark:text-amber-400 font-semibold">~ Mixed</span>
          )}
        </div>
      </div>

      {/* Volatility & Volume */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">Volatility &amp; Volume</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <StatCard label="ATR (14)" value={indicators.atr.toFixed(2)} sub={`${indicators.atrPct.toFixed(2)}% of price`} />
          <StatCard label="BB Width" value={`${indicators.bollingerBands.bandwidth.toFixed(2)}%`}
            sub={indicators.bollingerBands.bandwidth < 2 ? '🔥 Squeeze' : 'Normal'}
            color={indicators.bollingerBands.bandwidth < 2 ? 'text-amber-500' : 'dark-mode-text'} />
          <StatCard label="BB %B" value={indicators.bollingerBands.percentB.toFixed(2)}
            sub={indicators.bollingerBands.percentB > 1 ? 'Above upper' : indicators.bollingerBands.percentB < 0 ? 'Below lower' : 'In range'}
            color={indicators.bollingerBands.percentB > 0.8 ? 'text-rose-500' : indicators.bollingerBands.percentB < 0.2 ? 'text-emerald-500' : 'dark-mode-text'} />
          <StatCard label="VWAP" value={indicators.vwap.toFixed(2)}
            sub={`${indicators.priceVsVwap > 0 ? '+' : ''}${indicators.priceVsVwap.toFixed(2)}% from price`}
            color={indicators.priceVsVwap > 0 ? 'text-emerald-500' : 'text-rose-500'} />
          <StatCard label="OBV Trend" value={indicators.obvTrend.toUpperCase()}
            color={indicators.obvTrend === 'rising' ? 'text-emerald-500' : indicators.obvTrend === 'falling' ? 'text-rose-500' : 'dark-mode-text'} />
        </div>
      </div>

      {/* Bollinger Band values */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">Bollinger Bands (20, 2)</div>
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="Upper" value={indicators.bollingerBands.upper.toFixed(2)} color="text-rose-400" />
          <StatCard label="Middle" value={indicators.bollingerBands.middle.toFixed(2)} />
          <StatCard label="Lower" value={indicators.bollingerBands.lower.toFixed(2)} color="text-emerald-400" />
        </div>
      </div>
    </div>
  );
}

// ─── Strategies Tab ──────────────────────────────────────────────────────────

function StrategiesTab({
  weights,
  toggleStrategy,
  composite,
}: {
  weights: StrategyWeight[];
  toggleStrategy: (id: string) => void;
  composite: CompositeScore;
}) {
  const signalMap = new Map(composite.signals.map(s => [s.strategy, s]));

  return (
    <div className="p-3 space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-1">
        Strategy Allocation &amp; Signals
      </div>
      {weights.map((w) => {
        const sig = signalMap.get(w.id);
        return (
          <div
            key={w.id}
            className={`rounded-lg p-2.5 transition-colors ${
              w.enabled
                ? 'bg-zinc-50 dark:bg-zinc-800/50 ring-1 ring-zinc-200 dark:ring-zinc-700'
                : 'bg-zinc-100/50 dark:bg-zinc-900/30 opacity-50'
            }`}
          >
            <div className="flex items-center gap-2">
              {/* Toggle */}
              <button
                onClick={() => toggleStrategy(w.id)}
                className={`w-8 h-5 rounded-full transition-colors relative shrink-0 ${
                  w.enabled ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-600'
                }`}
                aria-label={`Toggle ${w.name}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  w.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
                }`} />
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold dark-mode-text">{w.name}</span>
                  <span className="text-[10px] text-zinc-400">{(w.weight * 100).toFixed(0)}% weight</span>
                </div>
              </div>

              {/* Signal indicator */}
              {sig ? (
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  sig.direction === 'LONG'
                    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                    : 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'
                }`}>
                  {sig.direction} {sig.strength}%
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-400">
                  No signal
                </span>
              )}
            </div>

            {/* Signal reasons */}
            {sig && w.enabled && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {sig.reasons.slice(0, 3).map((r, i) => (
                  <span key={i} className="px-1 py-0.5 rounded text-[8px] bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400">
                    {r}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Backtest Tab ────────────────────────────────────────────────────────────

function BacktestTab({
  result,
  isRunning,
  onRun,
  candleCount,
}: {
  result: BacktestResult | null;
  isRunning: boolean;
  onRun: () => void;
  candleCount: number;
}) {
  return (
    <div className="p-3 space-y-3">
      {/* Run button */}
      <div className="flex items-center gap-2">
        <button
          onClick={onRun}
          disabled={isRunning || candleCount < 100}
          className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition-colors ${
            isRunning
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-400 cursor-wait'
              : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm'
          }`}
        >
          {isRunning ? '⏳ Running…' : '▶ Run Backtest'}
        </button>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
          {candleCount} candles available
        </span>
      </div>

      {result && (
        <>
          {/* Summary stats */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">Performance Summary</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatCard label="Total P&L" value={`${result.summary.totalPnlPct > 0 ? '+' : ''}${result.summary.totalPnlPct.toFixed(2)}%`}
                color={result.summary.totalPnlPct > 0 ? 'text-emerald-500' : 'text-rose-500'} />
              <StatCard label="Win Rate" value={`${result.summary.winRate.toFixed(1)}%`}
                sub={`${result.summary.winningTrades}W / ${result.summary.losingTrades}L`}
                color={result.summary.winRate > 50 ? 'text-emerald-500' : 'text-rose-500'} />
              <StatCard label="Profit Factor" value={result.summary.profitFactor === Infinity ? '∞' : result.summary.profitFactor.toFixed(2)}
                color={result.summary.profitFactor > 1 ? 'text-emerald-500' : 'text-rose-500'} />
              <StatCard label="Sharpe Ratio" value={result.summary.sharpeRatio.toFixed(2)}
                color={result.summary.sharpeRatio > 1 ? 'text-emerald-500' : result.summary.sharpeRatio > 0 ? 'text-amber-500' : 'text-rose-500'} />
            </div>
          </div>

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">Risk Metrics</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatCard label="Max Drawdown" value={`${result.summary.maxDrawdownPct.toFixed(2)}%`}
                color="text-rose-500" />
              <StatCard label="Sortino" value={result.summary.sortinoRatio.toFixed(2)} />
              <StatCard label="Avg R:R" value={result.summary.avgRR.toFixed(2)} />
              <StatCard label="Expectancy" value={`${result.summary.expectancy > 0 ? '+' : ''}${result.summary.expectancy.toFixed(2)}%`}
                color={result.summary.expectancy > 0 ? 'text-emerald-500' : 'text-rose-500'} />
            </div>
          </div>

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">Trade Stats</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatCard label="Total Trades" value={String(result.summary.totalTrades)} />
              <StatCard label="Avg Win" value={`+${result.summary.avgWin.toFixed(2)}%`} color="text-emerald-500" />
              <StatCard label="Avg Loss" value={`-${result.summary.avgLoss.toFixed(2)}%`} color="text-rose-500" />
              <StatCard label="Avg Holding" value={`${result.summary.avgHoldingBars.toFixed(0)} bars`} />
              <StatCard label="Best Trade" value={`+${result.summary.bestTrade.toFixed(2)}%`} color="text-emerald-500" />
              <StatCard label="Worst Trade" value={`${result.summary.worstTrade.toFixed(2)}%`} color="text-rose-500" />
              <StatCard label="Max Consec W" value={String(result.summary.maxConsecutiveWins)} color="text-emerald-500" />
              <StatCard label="Max Consec L" value={String(result.summary.maxConsecutiveLosses)} color="text-rose-500" />
            </div>
          </div>

          {/* Equity curve (text-based mini chart) */}
          {result.equityCurve.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">Equity Curve</div>
              <EquityCurveChart data={result.equityCurve} />
            </div>
          )}

          {/* Recent trades */}
          {result.trades.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">
                Recent Trades ({result.trades.length} total)
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {result.trades.slice(-10).reverse().map((t) => (
                  <div
                    key={t.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-[10px] ${
                      t.result === 'win'
                        ? 'bg-emerald-50 dark:bg-emerald-950/20'
                        : 'bg-rose-50 dark:bg-rose-950/20'
                    }`}
                  >
                    <span className={`font-bold ${t.direction === 'LONG' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {t.direction}
                    </span>
                    <span className="font-mono dark-mode-text">{t.entry.toFixed(2)}</span>
                    <span className="text-zinc-400">→</span>
                    <span className="font-mono dark-mode-text">{t.exit.toFixed(2)}</span>
                    <span className={`ml-auto font-mono font-bold ${t.pnlPct > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {t.pnlPct > 0 ? '+' : ''}{t.pnlPct.toFixed(2)}%
                    </span>
                    <span className="text-zinc-400">{t.holdingBars}b</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Simple ASCII-like Equity Curve using div bars ───────────────────────────

function EquityCurveChart({ data }: { data: { bar: number; equity: number; drawdown: number }[] }) {
  // Downsample to ~60 data points for display
  const step = Math.max(1, Math.floor(data.length / 60));
  const sampled = data.filter((_, i) => i % step === 0);
  const minEq = Math.min(...sampled.map(d => d.equity));
  const maxEq = Math.max(...sampled.map(d => d.equity));
  const range = maxEq - minEq || 1;
  const height = 60; // px

  return (
    <div className="relative rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2 overflow-hidden">
      <div className="flex items-end gap-px" style={{ height }}>
        {sampled.map((d, i) => {
          const h = ((d.equity - minEq) / range) * height;
          const isProfit = d.equity >= sampled[0].equity;
          return (
            <div
              key={i}
              className={`flex-1 min-w-[2px] rounded-t-sm ${isProfit ? 'bg-emerald-400 dark:bg-emerald-500' : 'bg-rose-400 dark:bg-rose-500'}`}
              style={{ height: Math.max(1, h) }}
              title={`$${d.equity.toFixed(0)} | DD: ${d.drawdown.toFixed(1)}%`}
            />
          );
        })}
      </div>
      <div className="flex justify-between mt-1 text-[8px] text-zinc-400 dark:text-zinc-500">
        <span>${minEq.toFixed(0)}</span>
        <span>${maxEq.toFixed(0)}</span>
      </div>
    </div>
  );
}

