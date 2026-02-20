"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useMarketStore } from "@/store";
import {
  runAdvancedStrategy,
  analyzeRisk,
  type AdvancedStrategyResult,
  type AdvancedConfig,
  type TradeRecord,
  type ChecklistItem,
  type SignalHistoryEntry,
  type PendingSetup,
  type UnifiedSignal,
  type PropFirmId,
  type ChallengePhase,
  type PropComplianceRule,
  type PropCompliance,
  DEFAULT_ADVANCED_CONFIG,
  PROP_FIRM_PRESETS,
  getPropPreset,
} from "@/lib/advanced-strategy";
import type { ShadowPattern, ShadowClusterZone, StopHuntEvent, ShadowAnalysisResult } from "@/lib/shadow-analysis";
import type { AMDAnalysisResult, AMDPhase, AMDEntrySignal, FourHourRoadmap, ManipulationEvent } from "@/lib/amd-strategy";
import type { FractalAnalysisResult, FractalPoint, FractalLevel, FractalBreakout, AlligatorState, FractalDimension } from "@/lib/fractal-analysis";
import type { FloorCeilingAnalysis, FloorCeilingLevel, TimeframeFloorCeiling, ConfluentLevel, HTFCandleMap, BreakPrediction, BreakPredictionSummary, LevelSignal, LevelSignalSummary } from "@/lib/floor-ceiling";
import { fetchKlines, type BinanceInterval } from "@/lib/binance";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatPrice(price: number): string {
  if (price >= 10000) return price.toFixed(1);
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

function formatUSD(amount: number): string {
  return `$${Math.abs(amount).toFixed(2)}`;
}

function gradeColor(grade: string): string {
  switch (grade) {
    case 'A+': return 'text-emerald-400 bg-emerald-900/40 ring-1 ring-emerald-500/30';
    case 'A': return 'text-emerald-300 bg-emerald-900/30 ring-1 ring-emerald-600/20';
    case 'B': return 'text-amber-300 bg-amber-900/30 ring-1 ring-amber-600/20';
    case 'C': return 'text-zinc-400 bg-zinc-800/40 ring-1 ring-zinc-600/20';
    case 'NO-TRADE': return 'text-rose-400 bg-rose-900/30 ring-1 ring-rose-600/20';
    default: return 'text-zinc-400 bg-zinc-800/40';
  }
}

function ScoreBar({ value, label, color }: { value: number; label: string; color?: string }) {
  const normalized = Math.max(-100, Math.min(100, value));
  const isPositive = normalized >= 0;
  const absVal = Math.abs(normalized);
  const barColor = color ?? (isPositive ? 'bg-emerald-500' : 'bg-rose-500');
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] w-16 text-right text-zinc-400 dark:text-zinc-500 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-zinc-800/40 rounded-full overflow-hidden relative">
        <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-600/50" />
        {isPositive ? (
          <div className={`absolute inset-y-0 left-1/2 ${barColor} rounded-r-full transition-all`} style={{ width: `${absVal / 2}%` }} />
        ) : (
          <div className={`absolute inset-y-0 right-1/2 ${barColor} rounded-l-full transition-all`} style={{ width: `${absVal / 2}%` }} />
        )}
      </div>
      <span className={`text-[9px] w-8 font-mono font-bold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
        {normalized > 0 ? '+' : ''}{normalized.toFixed(0)}
      </span>
    </div>
  );
}

function MiniGauge({ value, max = 100, label, danger = false }: { value: number; max?: number; label: string; danger?: boolean }) {
  const pct = Math.min(100, (value / max) * 100);
  const barColor = danger
    ? pct > 70 ? 'bg-rose-500' : pct > 40 ? 'bg-amber-500' : 'bg-emerald-500'
    : pct > 70 ? 'bg-emerald-500' : pct > 40 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div>
      <div className="flex justify-between mb-0.5">
        <span className="text-[8px] text-zinc-500 uppercase tracking-wide">{label}</span>
        <span className="text-[9px] font-mono font-bold dark-mode-text">{value.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-zinc-800/40 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  return (
    <div className={`flex items-center gap-1.5 py-0.5 ${item.passed ? 'opacity-100' : 'opacity-50'}`}>
      <span className="text-[10px]">{item.passed ? '✅' : '❌'}</span>
      <span className="text-[9px] dark-mode-text flex-1">{item.label}</span>
      <span className="text-[8px] text-zinc-500">{item.detail}</span>
    <div className="flex gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={`w-1 h-1 rounded-full ${i < item.weight ? 'bg-violet-400' : 'bg-zinc-700'}`} />
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function ScalpDashboard() {
  const candles = useMarketStore((s) => s.candles);
  const symbol = useMarketStore((s) => s.symbol);
  const interval = useMarketStore((s) => s.interval);
  const trades = useMarketStore((s) => s.trades);
  const depth = useMarketStore((s) => s.depth);

  const [config, setConfig] = useState<AdvancedConfig>(DEFAULT_ADVANCED_CONFIG);
  const [result, setResult] = useState<AdvancedStrategyResult | null>(null);
  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([]);
  const [signalHistory, setSignalHistory] = useState<SignalHistoryEntry[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [activeTab, setActiveTab] = useState<'signal' | 'flow' | 'liquidity' | 'structure' | 'risk' | 'shadows' | 'amd' | 'fractals' | 'levels' | 'prop'>('signal');
  const lastUpdateRef = useRef(0);
  const lastSignalDirRef = useRef<string>('WAIT');

  // ── Level signal alert tracking ──
  const [levelAlerts, setLevelAlerts] = useState<LevelSignal[]>([]);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const lastLevelSignalRef = useRef<string>(''); // last signal id to prevent duplicates
  const levelAlertAudioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize beep sound (Web Audio)
  const playAlertBeep = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      // Two-tone beep: high then higher
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch { /* Audio not available */ }
  }, []);

  // ── HTF (Higher Timeframe) candle data for floor/ceiling analysis ──
  const [htfCandles, setHtfCandles] = useState<HTFCandleMap>({});
  const htfFetchRef = useRef<string>(''); // tracks symbol to avoid duplicate fetches
  const htfTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch 30m, 1h, 4h candles from Binance when symbol changes or every 60s
  useEffect(() => {
    if (!symbol) return;

    const HTF_INTERVALS: BinanceInterval[] = ['30m', '1h', '4h'];

    async function fetchHTFCandles() {
      try {
        const results: HTFCandleMap = {};
        const fetches = HTF_INTERVALS.map(async (tf) => {
          const data = await fetchKlines(symbol, tf, 300);
          // Convert to CandlestickData shape
          results[tf] = data.map(k => ({
            time: k.time as any,
            open: k.open,
            high: k.high,
            low: k.low,
            close: k.close,
          }));
        });
        await Promise.all(fetches);
        setHtfCandles(results);
        htfFetchRef.current = symbol;
      } catch (err) {
        console.error('Failed to fetch HTF candles:', err);
      }
    }

    // Fetch immediately on symbol change
    if (htfFetchRef.current !== symbol) {
      fetchHTFCandles();
    }

    // Refresh every 60 seconds
    htfTimerRef.current = setInterval(fetchHTFCandles, 60_000);
    return () => {
      if (htfTimerRef.current) clearInterval(htfTimerRef.current);
    };
  }, [symbol]);

  // Build a minimal OrderBook from depth data
  const orderBook = useMemo(() => {
    if (!depth || !depth.bids || !depth.asks) return null;
    return {
      lastUpdateId: depth.lastUpdateId ?? 0,
      bids: depth.bids.map(([p, s]: [string, string]) => ({ price: parseFloat(p), size: parseFloat(s) })).filter((l: { price: number; size: number }) => l.size > 0).sort((a: { price: number }, b: { price: number }) => b.price - a.price),
      asks: depth.asks.map(([p, s]: [string, string]) => ({ price: parseFloat(p), size: parseFloat(s) })).filter((l: { price: number; size: number }) => l.size > 0).sort((a: { price: number }, b: { price: number }) => a.price - b.price),
    };
  }, [depth]);

  // Run strategy when candles update
  useEffect(() => {
    if (candles.length < 50) return;
    const now = Date.now();
    const throttleMs = interval === '1m' ? 2000 : 3500;
    if (now - lastUpdateRef.current < throttleMs) return;
    lastUpdateRef.current = now;

    const strategyResult = runAdvancedStrategy(
      candles, trades, orderBook, tradeHistory, config, symbol, interval, htfCandles
    );
    if (strategyResult) {
      setResult(strategyResult);

      // Track signal history — log when direction changes
      const newDir = strategyResult.masterDirection;
      if (newDir !== 'WAIT' && newDir !== lastSignalDirRef.current) {
        const entry: SignalHistoryEntry = {
          timestamp: Date.now(),
          direction: newDir,
          grade: strategyResult.masterGrade,
          price: candles[candles.length - 1].close,
          entry: strategyResult.execution.entry,
          stopLoss: strategyResult.execution.stopLoss,
          tp1: strategyResult.execution.takeProfit1,
          confluenceScore: strategyResult.execution.confluenceScore,
          expired: false,
          reason: strategyResult.execution.reasons.join(', ') || strategyResult.unifiedSignal.summary,
        };
        setSignalHistory(prev => [entry, ...prev].slice(0, 20)); // keep last 20
      }
      // Mark old signals as expired if direction changed
      if (newDir !== lastSignalDirRef.current && lastSignalDirRef.current !== 'WAIT') {
        setSignalHistory(prev => prev.map((s, i) => i > 0 ? { ...s, expired: true } : s));
      }
      lastSignalDirRef.current = newDir;

      // ── Track level entry signals (floor/ceiling alerts) ──
      const ls = strategyResult.floorCeiling.levelSignals;
      if (ls.bestSignal && ls.bestSignal.id !== lastLevelSignalRef.current && alertsEnabled) {
        const newSig = ls.bestSignal;
        lastLevelSignalRef.current = newSig.id;
        // Only alert for grade B+ and above
        if (newSig.grade !== 'C') {
          setLevelAlerts(prev => [newSig, ...prev].slice(0, 30)); // keep last 30
          playAlertBeep();
        }
      }
    }
  }, [candles, trades, orderBook, tradeHistory, config, symbol, interval, htfCandles, alertsEnabled, playAlertBeep]);

  // Log a trade
  const logTrade = useCallback((res: 'win' | 'loss' | 'breakeven') => {
    if (!result) return;
    const { execution, risk } = result;
    const pnl = res === 'win'
      ? risk.rewardAmount
      : res === 'loss'
      ? -risk.riskAmount
      : 0;
    const pnlPct = config.capital > 0 ? (pnl / config.capital) * 100 : 0;
    setTradeHistory(prev => [...prev, { result: res, pnl, pnlPct, time: Date.now() }]);
  }, [result, config]);

  const resetDay = useCallback(() => setTradeHistory([]), []);

  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;
  const r = result;

  // Recalculate risk with latest trade history
  const liveRisk = useMemo(() => {
    if (!r) return null;
    return analyzeRisk(r.execution, config, tradeHistory);
  }, [r, config, tradeHistory]);

  // Daily stats from trade history
  const dailyStats = useMemo(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const today = tradeHistory.filter(t => t.time >= todayStart.getTime());
    const w = today.filter(t => t.result === 'win').length;
    const l = today.filter(t => t.result === 'loss').length;
    const total = today.length;
    const pnl = today.reduce((s, t) => s + t.pnl, 0);
    return { total, wins: w, losses: l, winRate: total > 0 ? (w / total) * 100 : 0, pnl };
  }, [tradeHistory]);

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-sm overflow-hidden">
      {/* ══ Header ══ */}
      <div className="px-3 sm:px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-gradient-to-r from-violet-50 via-white to-amber-50 dark:from-violet-950/30 dark:via-zinc-900 dark:to-amber-950/20">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-black text-sm tracking-wide uppercase text-violet-700 dark:text-violet-300">
            ⚡ Advanced Strategy
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
            {symbol} · {interval}
          </span>

          {/* Master grade */}
          {r && (
            <span className={`text-[10px] px-2 py-0.5 rounded font-black ${gradeColor(r.masterGrade)}`}>
              {r.masterGrade}
          </span>
          )}

          {/* Prop firm badge */}
          {config.propFirmMode && liveRisk?.propCompliance && (
            <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
              liveRisk.propCompliance.overallStatus === 'compliant'
                ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                : liveRisk.propCompliance.overallStatus === 'warning'
                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                : 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'
            }`}>
              🏦 {getPropPreset(config.propFirmId)?.name ?? 'Prop'} • {config.propPhase}
            </span>
          )}

          {/* Trade counter */}
          <span className={`text-[10px] px-2 py-0.5 rounded font-bold ml-auto ${
            dailyStats.total >= config.maxTradesPerDay
              ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
          }`}>
            {dailyStats.total}/{config.maxTradesPerDay}
          </span>

          <button onClick={() => setShowConfig(!showConfig)} className="text-[10px] px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">⚙️</button>
        </div>
      </div>

      {/* ══ Config Panel ══ */}
      {showConfig && (
        <div className="px-3 sm:px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/40">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Capital ($)', key: 'capital' as const, step: 50 },
              { label: 'Leverage (x)', key: 'leverage' as const, step: 1 },
              { label: 'Risk/Trade (%)', key: 'maxRiskPerTrade' as const, step: 0.25 },
              { label: 'Max Daily Loss (%)', key: 'maxDailyLoss' as const, step: 0.5 },
              { label: 'Max Drawdown (%)', key: 'maxDrawdown' as const, step: 1 },
              { label: 'Max Trades/Day', key: 'maxTradesPerDay' as const, step: 1 },
              { label: 'Min Confluence', key: 'minConfluenceScore' as const, step: 5 },
              { label: 'Min R:R', key: 'minRiskReward' as const, step: 0.25 },
            ].map(({ label, key, step }) => (
              <div key={key}>
                <label className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 block mb-1">{label}</label>
              <input
                type="number"
                  step={step}
                  value={config[key]}
                  onChange={e => setConfig(c => ({ ...c, [key]: Number(e.target.value) }))}
                className="w-full px-2 py-1.5 rounded text-xs font-mono bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 dark-mode-text"
              />
            </div>
            ))}
          </div>
          {/* Prop Firm Config */}
          <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-violet-400 mb-2">🏦 Prop Firm Mode</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 block mb-1">Firm</label>
                <select
                  value={config.propFirmId}
                  onChange={e => {
                    const id = e.target.value as PropFirmId;
                    const preset = getPropPreset(id);
                    setConfig(c => ({
                      ...c,
                      propFirmId: id,
                      propFirmMode: id !== 'none',
                      propAccountSize: preset?.accountSizes[2] ?? c.capital,
                      maxDailyLoss: preset?.phases[c.propPhase]?.maxDailyLoss ?? c.maxDailyLoss,
                      maxDrawdown: preset?.phases[c.propPhase]?.maxTotalDrawdown ?? c.maxDrawdown,
                      leverage: Math.min(c.leverage, preset?.phases[c.propPhase]?.maxLeverage ?? 100),
                      propStartDate: c.propStartDate || Date.now(),
                    }));
                  }}
                  className="w-full px-2 py-1.5 rounded text-xs font-mono bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 dark-mode-text"
                >
                  <option value="none">None (Custom)</option>
                  {PROP_FIRM_PRESETS.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              {config.propFirmMode && (
                <>
                  <div>
                    <label className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 block mb-1">Phase</label>
                    <select
                      value={config.propPhase}
                      onChange={e => {
                        const phase = e.target.value as ChallengePhase;
                        const preset = getPropPreset(config.propFirmId);
                        setConfig(c => ({
                          ...c,
                          propPhase: phase,
                          maxDailyLoss: preset?.phases[phase]?.maxDailyLoss ?? c.maxDailyLoss,
                          maxDrawdown: preset?.phases[phase]?.maxTotalDrawdown ?? c.maxDrawdown,
                        }));
                      }}
                      className="w-full px-2 py-1.5 rounded text-xs font-mono bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 dark-mode-text"
                    >
                      <option value="challenge">Challenge</option>
                      <option value="verification">Verification</option>
                      <option value="funded">Funded</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 block mb-1">Account Size</label>
                    <select
                      value={config.propAccountSize}
                      onChange={e => setConfig(c => ({ ...c, propAccountSize: Number(e.target.value), capital: Number(e.target.value) }))}
                      className="w-full px-2 py-1.5 rounded text-xs font-mono bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 dark-mode-text"
                    >
                      {(getPropPreset(config.propFirmId)?.accountSizes ?? []).map(s => (
                        <option key={s} value={s}>${s.toLocaleString()}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 block mb-1">Start Date</label>
                    <input
                      type="date"
                      value={config.propStartDate ? new Date(config.propStartDate).toISOString().slice(0, 10) : ''}
                      onChange={e => setConfig(c => ({ ...c, propStartDate: new Date(e.target.value).getTime() }))}
                      className="w-full px-2 py-1.5 rounded text-xs font-mono bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 dark-mode-text"
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex gap-2 mt-2">
            <button onClick={resetDay} className="text-[10px] px-2 py-1 rounded bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 hover:bg-rose-200 dark:hover:bg-rose-900/50 transition-colors">
              🗑 Reset Day
            </button>
            <label className="flex items-center gap-1 text-[10px] text-zinc-400">
              <input type="checkbox" checked={config.useKellySizing} onChange={e => setConfig(c => ({ ...c, useKellySizing: e.target.checked }))} className="rounded" />
              Kelly Sizing
            </label>
          </div>
        </div>
      )}

      {/* ══ Stop Warning ══ */}
      {liveRisk?.shouldStop && (
        <div className="px-3 py-2 bg-rose-50 dark:bg-rose-950/30 border-b border-rose-200 dark:border-rose-800/40">
          <div className="flex items-center gap-2 text-xs font-semibold text-rose-600 dark:text-rose-400">
            <span className="text-base">⛔</span>
            <span>{liveRisk.stopReason}</span>
          </div>
        </div>
      )}

      {/* ══ Daily P&L Bar ══ */}
      {dailyStats.total > 0 && (
        <div className="px-3 sm:px-4 py-2 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20">
          <div className="flex items-center gap-3 text-[10px]">
            <span className="font-semibold text-zinc-500 dark:text-zinc-400">P&amp;L:</span>
            <span className={`font-mono font-black text-sm ${dailyStats.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {dailyStats.pnl >= 0 ? '+' : '-'}{formatUSD(dailyStats.pnl)}
            </span>
            <span className="text-emerald-500 font-semibold">{dailyStats.wins}W</span>
            <span className="text-rose-500 font-semibold">{dailyStats.losses}L</span>
            {dailyStats.winRate > 0 && (
              <span className={`font-semibold ${dailyStats.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {dailyStats.winRate.toFixed(0)}% WR
              </span>
            )}
          </div>
          <div className="mt-1.5 flex gap-0.5">
            {tradeHistory.map((t, i) => (
              <div key={i} className={`flex-1 h-1.5 rounded-full ${
                t.result === 'win' ? 'bg-emerald-400' : t.result === 'loss' ? 'bg-rose-400' : 'bg-zinc-400'
              }`} />
            ))}
            {Array.from({ length: Math.max(0, config.maxTradesPerDay - tradeHistory.length) }).map((_, i) => (
              <div key={`e-${i}`} className="flex-1 h-1.5 rounded-full bg-zinc-800/30" />
            ))}
          </div>
        </div>
      )}

      {/* ══ Pillar Tabs ══ */}
      <div className="flex border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20 overflow-x-auto">
        {[
          { id: 'signal' as const, label: '🎯 Signal', emoji: '' },
          { id: 'flow' as const, label: '📊 Flow', emoji: '' },
          { id: 'liquidity' as const, label: '💧 Liquidity', emoji: '' },
          { id: 'structure' as const, label: '🏗 Structure', emoji: '' },
          { id: 'risk' as const, label: '🛡 Risk', emoji: '' },
          { id: 'shadows' as const, label: '🕯 Shadows', emoji: '' },
          { id: 'amd' as const, label: '⏱ AMD', emoji: '' },
          { id: 'fractals' as const, label: '📐 Fractals', emoji: '' },
          { id: 'levels' as const, label: '🏠 Levels', emoji: '' },
          { id: 'prop' as const, label: '🏦 Prop', emoji: '' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 min-w-0 px-2 py-2 text-[10px] font-semibold transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'text-violet-700 dark:text-violet-300 border-b-2 border-violet-500 bg-white dark:bg-zinc-950'
                : 'text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══ Content ══ */}
        <div className="p-3 sm:p-4">

        {/* ── UNIFIED SIGNAL TAB ── */}
        {activeTab === 'signal' && r ? (
          <div className="space-y-3">
            {/* ▓▓ ACTION ADVICE BAR ▓▓ */}
            <div className={`rounded-xl p-3 text-center ${
              r.masterDirection === 'LONG'
                ? 'bg-gradient-to-r from-emerald-950/60 to-emerald-900/30 ring-1 ring-emerald-500/40'
                : r.masterDirection === 'SHORT'
                ? 'bg-gradient-to-r from-rose-950/60 to-rose-900/30 ring-1 ring-rose-500/40'
                : 'bg-gradient-to-r from-zinc-900/60 to-zinc-800/30 ring-1 ring-zinc-700/40'
            }`}>
              <div className="text-[10px] font-bold tracking-wider uppercase mb-1 text-zinc-400">
                {r.unifiedSignal.direction.replace('_', ' ')}
              </div>
              <div className={`text-sm font-black ${
                r.masterDirection === 'LONG' ? 'text-emerald-400' : r.masterDirection === 'SHORT' ? 'text-rose-400' : 'text-zinc-300'
              }`}>
                {r.unifiedSignal.actionAdvice}
              </div>
              <div className="text-[9px] text-zinc-500 mt-1">{r.unifiedSignal.summary}</div>
            </div>

            {/* ▓▓ PILLAR OVERVIEW ▓▓ */}
            <div className="rounded-xl bg-zinc-900/30 p-2.5 space-y-1.5">
              <div className="text-[8px] uppercase font-bold tracking-wider text-zinc-500 mb-1">5-Pillar + MTF Confluence</div>
              {r.unifiedSignal.pillarSummary.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px]">{
                    p.status === 'bullish' ? '🟢' : p.status === 'bearish' ? '🔴' : '⚪'
                  }</span>
                  <span className="text-[9px] font-semibold w-20 text-zinc-300">{p.name}</span>
                  <div className="flex-1 h-1.5 bg-zinc-800/60 rounded-full overflow-hidden relative">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-600/40" />
                    {p.score >= 0 ? (
                      <div className="absolute inset-y-0 left-1/2 bg-emerald-500 rounded-r-full transition-all" style={{ width: `${Math.min(50, Math.abs(p.score) / 2)}%` }} />
                    ) : (
                      <div className="absolute inset-y-0 right-1/2 bg-rose-500 rounded-l-full transition-all" style={{ width: `${Math.min(50, Math.abs(p.score) / 2)}%` }} />
                    )}
                  </div>
                  <span className={`text-[8px] font-mono w-6 text-right font-bold ${p.score >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {p.score > 0 ? '+' : ''}{p.score.toFixed(0)}
                  </span>
                  <span className="text-[7px] text-zinc-500 w-40 truncate hidden sm:block">{p.detail}</span>
                </div>
              ))}
              <div className="pt-1.5 border-t border-zinc-800/40">
                <ScoreBar value={r.masterScore} label="MASTER" color={r.masterScore >= 0 ? 'bg-emerald-400' : 'bg-rose-400'} />
              </div>
            </div>

            {/* ▓▓ KEY LEVELS ▓▓ */}
            <div className="rounded-xl bg-zinc-900/30 p-2.5">
              <div className="text-[8px] uppercase font-bold tracking-wider text-zinc-500 mb-2">Key Levels</div>
              <div className="flex items-center gap-1 text-[9px]">
                <div className="text-center flex-1">
                  <div className="text-[7px] text-zinc-500 uppercase">Strong Sup</div>
                  <div className="font-mono font-bold text-emerald-500">{formatPrice(r.unifiedSignal.keyLevels.strongSupport)}</div>
                </div>
                <div className="text-zinc-700">›</div>
                <div className="text-center flex-1">
                  <div className="text-[7px] text-zinc-500 uppercase">Near Sup</div>
                  <div className="font-mono font-bold text-emerald-400">{formatPrice(r.unifiedSignal.keyLevels.nearSupport)}</div>
                </div>
                <div className="text-zinc-700">›</div>
                <div className="text-center flex-1 bg-zinc-800/40 rounded-lg py-1">
                  <div className="text-[7px] text-violet-400 uppercase font-bold">Price</div>
                  <div className="font-mono font-black text-violet-300">{formatPrice(r.unifiedSignal.keyLevels.currentPrice)}</div>
                </div>
                <div className="text-zinc-700">›</div>
                <div className="text-center flex-1">
                  <div className="text-[7px] text-zinc-500 uppercase">Near Res</div>
                  <div className="font-mono font-bold text-rose-400">{formatPrice(r.unifiedSignal.keyLevels.nearResistance)}</div>
                </div>
                <div className="text-zinc-700">›</div>
                <div className="text-center flex-1">
                  <div className="text-[7px] text-zinc-500 uppercase">Strong Res</div>
                  <div className="font-mono font-bold text-rose-500">{formatPrice(r.unifiedSignal.keyLevels.strongResistance)}</div>
                </div>
              </div>
            </div>

            {/* ▓▓ MTF ALIGNMENT ▓▓ */}
            <div className="rounded-xl bg-zinc-900/30 p-2.5">
              <div className="text-[8px] uppercase font-bold tracking-wider text-zinc-500 mb-2">
                Multi-Timeframe • <span className={
                  r.mtf.alignment === 'aligned-bull' ? 'text-emerald-400' : r.mtf.alignment === 'aligned-bear' ? 'text-rose-400' : 'text-amber-400'
                }>{r.mtf.alignment.replace('-', ' ').toUpperCase()}</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {r.mtf.timeframes.map(tf => (
                  <div key={tf.tf} className={`rounded-lg p-1.5 text-center ${
                    tf.trend === 'bullish' ? 'bg-emerald-900/20 ring-1 ring-emerald-700/30'
                    : tf.trend === 'bearish' ? 'bg-rose-900/20 ring-1 ring-rose-700/30'
                    : 'bg-zinc-800/30 ring-1 ring-zinc-700/20'
                  }`}>
                    <div className="text-[9px] font-black">{tf.tf}</div>
                    <div className={`text-[8px] font-bold ${
                      tf.trend === 'bullish' ? 'text-emerald-400' : tf.trend === 'bearish' ? 'text-rose-400' : 'text-zinc-400'
                    }`}>{tf.trend.toUpperCase()}</div>
                    <div className="text-[7px] text-zinc-500">RSI:{tf.rsi.toFixed(0)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ▓▓ ACTIVE SIGNAL (when trading) ▓▓ */}
            {r.masterDirection !== 'WAIT' && !liveRisk?.shouldStop && (
              <div className={`rounded-xl p-3 ${
                r.masterDirection === 'LONG'
                  ? 'bg-gradient-to-br from-emerald-950/40 to-emerald-900/20 ring-1 ring-emerald-600/30'
                  : 'bg-gradient-to-br from-rose-950/40 to-rose-900/20 ring-1 ring-rose-600/30'
              }`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-xl font-black ${
                    r.masterDirection === 'LONG' ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {r.masterDirection === 'LONG' ? '🟢 LONG' : '🔴 SHORT'}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${gradeColor(r.masterGrade)}`}>
                    {r.masterGrade}
                  </span>
                  <span className="ml-auto text-[10px] text-zinc-400">
                    Conviction: <span className="font-bold dark-mode-text">{r.unifiedSignal.conviction.toFixed(0)}%</span>
                  </span>
                </div>

                {/* Entry / SL / TP Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  <div className="rounded-lg bg-white/5 dark:bg-zinc-800/60 p-2 text-center">
                    <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400">Entry</div>
                    <div className="font-mono font-black text-sm dark-mode-text">{formatPrice(r.execution.entry)}</div>
                  </div>
                  <div className="rounded-lg bg-rose-900/20 p-2 text-center">
                    <div className="text-[9px] font-semibold uppercase tracking-wide text-rose-400">Stop Loss</div>
                    <div className="font-mono font-black text-sm text-rose-400">{formatPrice(r.execution.stopLoss)}</div>
                    <div className="text-[8px] text-rose-400/70">-{(Math.abs(r.execution.entry - r.execution.stopLoss) / r.execution.entry * 100).toFixed(2)}%</div>
                  </div>
                  <div className="rounded-lg bg-emerald-900/20 p-2 text-center">
                    <div className="text-[9px] font-semibold uppercase tracking-wide text-emerald-400">TP1</div>
                    <div className="font-mono font-black text-sm text-emerald-400">{formatPrice(r.execution.takeProfit1)}</div>
                    <div className="text-[8px] text-emerald-400/70">+{(Math.abs(r.execution.takeProfit1 - r.execution.entry) / r.execution.entry * 100).toFixed(2)}%</div>
                  </div>
                  <div className="rounded-lg bg-emerald-900/10 p-2 text-center">
                    <div className="text-[9px] font-semibold uppercase tracking-wide text-emerald-600">TP2</div>
                    <div className="font-mono font-black text-sm text-emerald-500">{formatPrice(r.execution.takeProfit2)}</div>
                    <div className="text-[8px] text-emerald-400/70">+{(Math.abs(r.execution.takeProfit2 - r.execution.entry) / r.execution.entry * 100).toFixed(2)}%</div>
                  </div>
                </div>

                {/* Position Sizing */}
                <div className="rounded-lg bg-zinc-800/40 p-2 mb-3">
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 mb-1.5">
                    Position • ${config.capital} • {config.leverage}x {config.useKellySizing ? '• Kelly' : ''}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                    <div><span className="text-zinc-400">Size: </span><span className="font-mono font-bold dark-mode-text">${(liveRisk?.positionNotional ?? 0).toFixed(0)}</span></div>
                    <div><span className="text-zinc-400">Risk: </span><span className="font-mono font-bold text-rose-500">${(liveRisk?.riskAmount ?? 0).toFixed(2)} ({(liveRisk?.riskPercent ?? 0).toFixed(1)}%)</span></div>
                    <div><span className="text-zinc-400">Reward: </span><span className="font-mono font-bold text-emerald-500">${(liveRisk?.rewardAmount ?? 0).toFixed(2)}</span></div>
                    <div><span className="text-zinc-400">R:R </span><span className={`font-mono font-bold ${r.execution.riskReward >= 1.5 ? 'text-emerald-500' : r.execution.riskReward >= 1 ? 'text-amber-500' : 'text-rose-500'}`}>1:{r.execution.riskReward.toFixed(1)}</span></div>
                  </div>
                  {liveRisk?.shouldReduceSize && (
                    <div className="text-[9px] text-amber-400 mt-1">⚠ Size reduced {((1 - liveRisk.sizeMultiplier) * 100).toFixed(0)}%</div>
                  )}
                </div>

                {/* Partial TPs */}
                {liveRisk && liveRisk.partialTPs.length > 0 && (
                  <div className="flex gap-1 mb-3">
                    {liveRisk.partialTPs.map((tp, i) => (
                      <div key={i} className="flex-1 rounded-lg bg-emerald-900/10 p-1.5 text-center">
                        <div className="text-[8px] text-emerald-400 font-semibold">{tp.label}</div>
                        <div className="font-mono text-[10px] text-emerald-500 font-bold">{formatPrice(tp.price)}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reasons & Warnings */}
                <div className="flex flex-wrap gap-1 mb-2">
                  {r.execution.reasons.map((reason, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded text-[9px] bg-zinc-700/50 text-zinc-300">✓ {reason}</span>
                  ))}
                </div>
                {r.execution.warnings.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {r.execution.warnings.map((w, i) => (
                      <span key={i} className="px-1.5 py-0.5 rounded text-[9px] bg-amber-900/20 text-amber-400">⚠ {w}</span>
                    ))}
                  </div>
                )}

                {/* Checklist Toggle */}
                <button onClick={() => setShowChecklist(!showChecklist)} className="text-[10px] text-violet-400 hover:text-violet-300 mb-2 underline">
                  {showChecklist ? '▼ Hide' : '▶ Show'} Checklist ({r.execution.passedCount}/{r.execution.totalChecks})
                </button>
                {showChecklist && (
                  <div className="rounded-lg bg-zinc-900/30 p-2 mb-3 space-y-0.5 max-h-52 overflow-y-auto">
                    {r.execution.checklist.map(item => <ChecklistRow key={item.id} item={item} />)}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <button onClick={() => logTrade('win')} disabled={liveRisk?.shouldStop} className="flex-1 py-2 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-white transition-colors disabled:opacity-30">✅ Won</button>
                  <button onClick={() => logTrade('loss')} disabled={liveRisk?.shouldStop} className="flex-1 py-2 rounded-lg text-xs font-bold bg-rose-500 hover:bg-rose-600 text-white transition-colors disabled:opacity-30">❌ Lost</button>
                  <button onClick={() => logTrade('breakeven')} disabled={liveRisk?.shouldStop} className="py-2 px-3 rounded-lg text-xs font-bold bg-zinc-700 hover:bg-zinc-600 dark-mode-text transition-colors disabled:opacity-30">⚖ BE</button>
                </div>
              </div>
            )}

            {/* ▓▓ PENDING SETUPS (when WAIT) ▓▓ */}
            {(r.masterDirection === 'WAIT' || liveRisk?.shouldStop) && r.unifiedSignal.pendingSetups.length > 0 && (
              <div className="rounded-xl bg-zinc-900/30 p-2.5">
                <div className="text-[8px] uppercase font-bold tracking-wider text-zinc-500 mb-2">
                  ⏳ Pending Setups ({r.unifiedSignal.pendingSetups.length})
                </div>
                <div className="space-y-2">
                  {r.unifiedSignal.pendingSetups.map((setup: PendingSetup) => (
                    <div key={setup.id} className={`rounded-lg p-2 ${
                      setup.type === 'long' ? 'bg-emerald-900/15 ring-1 ring-emerald-800/30' : 'bg-rose-900/15 ring-1 ring-rose-800/30'
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-black ${setup.type === 'long' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {setup.type === 'long' ? '🟢 LONG' : '🔴 SHORT'}
                        </span>
                        <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-zinc-800/50 text-zinc-300 font-bold">
                          {setup.confidence}% conf
                        </span>
                        <span className="ml-auto text-[8px] text-zinc-500">R:R {setup.riskReward.toFixed(1)}</span>
                      </div>
                      <div className="text-[9px] text-zinc-300 mb-1">{setup.trigger}</div>
                      <div className="grid grid-cols-4 gap-1 text-[8px]">
                        <div className="text-center">
                          <div className="text-zinc-500">Entry</div>
                          <div className="font-mono font-bold text-zinc-300">{formatPrice(setup.entryZone.low)}–{formatPrice(setup.entryZone.high)}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-rose-500">SL</div>
                          <div className="font-mono font-bold text-rose-400">{formatPrice(setup.stopLoss)}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-emerald-500">TP1</div>
                          <div className="font-mono font-bold text-emerald-400">{formatPrice(setup.target1)}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-emerald-600">TP2</div>
                          <div className="font-mono font-bold text-emerald-500">{formatPrice(setup.target2)}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {setup.reasons.map((r2, j) => (
                          <span key={j} className="text-[7px] px-1 py-0.5 rounded bg-zinc-800/50 text-zinc-400">
                            {r2}
                          </span>
                        ))}
                      </div>
                      <div className="text-[7px] text-rose-400/60 mt-0.5">❌ Invalid: {setup.invalidation}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ▓▓ SIGNAL HISTORY ▓▓ */}
            {signalHistory.length > 0 && (
              <div className="rounded-xl bg-zinc-900/30 p-2.5">
                <button onClick={() => setShowHistory(!showHistory)} className="text-[8px] uppercase font-bold tracking-wider text-zinc-500 hover:text-zinc-300 w-full text-left">
                  {showHistory ? '▼' : '▶'} Signal History ({signalHistory.length})
                </button>
                {showHistory && (
                  <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                    {signalHistory.map((s, i) => (
                      <div key={i} className={`flex items-center gap-2 text-[9px] py-0.5 ${s.expired ? 'opacity-40' : ''}`}>
                        <span>{s.direction === 'LONG' ? '🟢' : '🔴'}</span>
                        <span className={`font-bold ${s.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>{s.direction}</span>
                        <span className={`px-1 rounded text-[8px] ${gradeColor(s.grade)}`}>{s.grade}</span>
                        <span className="font-mono text-zinc-400">{formatPrice(s.entry)}</span>
                        <span className="text-zinc-500">→</span>
                        <span className="font-mono text-emerald-400">{formatPrice(s.tp1)}</span>
                        <span className="ml-auto text-[8px] text-zinc-600">{new Date(s.timestamp).toLocaleTimeString()}</span>
                        {s.expired && <span className="text-[7px] text-zinc-600">expired</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ▓▓ NO DATA STATE ▓▓ */}
            {candles.length < 50 && (
              <div className="text-center py-6">
                <div className="text-2xl mb-2">📊</div>
                <div className="text-sm text-zinc-500">Loading... ({candles.length}/50 candles)</div>
              </div>
            )}
          </div>
        ) : activeTab === 'signal' ? (
          <div className="text-center py-6">
            <div className="text-2xl mb-2">📊</div>
            <div className="text-sm text-zinc-500">
              {candles.length < 50 ? `Loading... (${candles.length}/50 candles)` : 'Analyzing...'}
            </div>
          </div>
        ) : null}

        {/* ── ORDER FLOW TAB ── */}
        {activeTab === 'flow' && r && (
          <div className="space-y-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-2">📊 Order Flow Analysis</div>

            {/* CVD & Pressure */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2">
                <div className="text-[8px] text-zinc-500 uppercase">CVD</div>
                <div className={`font-mono font-black text-lg ${r.orderFlow.cvd >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {r.orderFlow.cvd >= 0 ? '+' : ''}{r.orderFlow.cvd.toFixed(4)}
                </div>
                <div className={`text-[9px] font-semibold ${
                  r.orderFlow.cvdTrend === 'rising' ? 'text-emerald-400' : r.orderFlow.cvdTrend === 'falling' ? 'text-rose-400' : 'text-zinc-400'
                }`}>
                  {r.orderFlow.cvdTrend === 'rising' ? '📈' : r.orderFlow.cvdTrend === 'falling' ? '📉' : '➡️'} {r.orderFlow.cvdTrend}
                </div>
              </div>
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2">
                <div className="text-[8px] text-zinc-500 uppercase">Net Flow</div>
                <div className={`font-black text-lg ${
                  r.orderFlow.netFlow === 'buying' ? 'text-emerald-500' : r.orderFlow.netFlow === 'selling' ? 'text-rose-500' : 'text-zinc-400'
                }`}>
                  {r.orderFlow.netFlow.toUpperCase()}
                </div>
                <div className="text-[9px] text-zinc-400">
                  Aggressive: <span className="font-bold dark-mode-text">{r.orderFlow.aggressiveSide}</span>
                </div>
              </div>
            </div>

            {/* Buy / Sell Pressure */}
            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2">
              <div className="text-[8px] text-zinc-500 uppercase mb-1">Buy / Sell Pressure</div>
              <div className="flex h-3 rounded-full overflow-hidden bg-zinc-700/30">
                <div className="bg-emerald-500 transition-all" style={{ width: `${r.orderFlow.buyPressure}%` }} />
                <div className="bg-rose-500 transition-all" style={{ width: `${r.orderFlow.sellPressure}%` }} />
              </div>
              <div className="flex justify-between text-[9px] mt-1">
                <span className="text-emerald-400 font-bold">Buy {r.orderFlow.buyPressure.toFixed(0)}%</span>
                <span className="text-rose-400 font-bold">Sell {r.orderFlow.sellPressure.toFixed(0)}%</span>
              </div>
            </div>

            {/* Whale Activity & Absorption */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2">
                <div className="text-[8px] text-zinc-500 uppercase">🐋 Whale Orders</div>
                <div className="font-mono font-bold text-sm dark-mode-text">{r.orderFlow.largeOrderCount}</div>
                <div className={`text-[9px] font-semibold ${
                  r.orderFlow.largeOrderBias === 'buy' ? 'text-emerald-400' : r.orderFlow.largeOrderBias === 'sell' ? 'text-rose-400' : 'text-zinc-400'
                }`}>
                  Bias: {r.orderFlow.largeOrderBias}
                </div>
              </div>
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2">
                <div className="text-[8px] text-zinc-500 uppercase">Absorption</div>
                <div className={`font-bold text-sm ${r.orderFlow.absorptionDetected ? 'text-amber-400' : 'text-zinc-500'}`}>
                  {r.orderFlow.absorptionDetected ? `${r.orderFlow.absorptionSide?.toUpperCase()} SIDE` : 'None'}
                </div>
                <div className="text-[9px] text-zinc-400">
                  Velocity: {r.orderFlow.tradeVelocity.toFixed(1)}/s
                </div>
              </div>
            </div>

            {/* Volume Profile */}
            {r.orderFlow.volumeProfile.length > 0 && (
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2">
                <div className="text-[8px] text-zinc-500 uppercase mb-1">Volume Profile</div>
                <div className="space-y-0.5">
                  {r.orderFlow.volumeProfile.filter(n => n.totalVolume > 0).slice(-10).reverse().map((node, i) => {
                    const maxVol = Math.max(...r.orderFlow.volumeProfile.map(n => n.totalVolume));
                    const pct = maxVol > 0 ? (node.totalVolume / maxVol) * 100 : 0;
                    return (
                      <div key={i} className="flex items-center gap-1">
                        <span className="text-[8px] font-mono text-zinc-400 w-16 text-right">{formatPrice(node.price)}</span>
                        <div className="flex-1 h-2 bg-zinc-700/30 rounded-full overflow-hidden flex">
                          <div className="bg-emerald-500/70 h-full" style={{ width: `${maxVol > 0 ? (node.buyVolume / maxVol) * 100 : 0}%` }} />
                          <div className="bg-rose-500/70 h-full" style={{ width: `${maxVol > 0 ? (node.sellVolume / maxVol) * 100 : 0}%` }} />
                        </div>
                        {node.isHighVolume && <span className="text-[8px] text-amber-400">HVN</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <ScoreBar value={r.orderFlow.score} label="Score" />
          </div>
        )}

        {/* ── LIQUIDITY TAB ── */}
        {activeTab === 'liquidity' && r && (
          <div className="space-y-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-2">💧 Liquidity Analysis</div>

            {/* Nearest S/R */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-2">
                <div className="text-[8px] text-emerald-500 uppercase">Nearest Support</div>
                {r.liquidity.nearestSupport ? (
                  <>
                    <div className="font-mono font-black text-sm text-emerald-600 dark:text-emerald-400">
                      {formatPrice(r.liquidity.nearestSupport.midPrice)}
                    </div>
                    <div className="text-[9px] text-emerald-400">
                      Str: {r.liquidity.nearestSupport.strength} • {r.liquidity.nearestSupport.source}
                    </div>
                  </>
                ) : <div className="text-xs text-zinc-500">—</div>}
              </div>
              <div className="rounded-lg bg-rose-50 dark:bg-rose-900/20 p-2">
                <div className="text-[8px] text-rose-500 uppercase">Nearest Resistance</div>
                {r.liquidity.nearestResistance ? (
                  <>
                    <div className="font-mono font-black text-sm text-rose-600 dark:text-rose-400">
                      {formatPrice(r.liquidity.nearestResistance.midPrice)}
                    </div>
                    <div className="text-[9px] text-rose-400">
                      Str: {r.liquidity.nearestResistance.strength} • {r.liquidity.nearestResistance.source}
                    </div>
                  </>
                ) : <div className="text-xs text-zinc-500">—</div>}
              </div>
            </div>

            {/* Liquidity Zones */}
            {r.liquidity.zones.length > 0 && (
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2">
                <div className="text-[8px] text-zinc-500 uppercase mb-1">Active Zones ({r.liquidity.zones.length})</div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {r.liquidity.zones.slice(0, 8).map((zone, i) => (
                    <div key={i} className="flex items-center gap-1 text-[9px]">
                      <span className={`w-1.5 h-1.5 rounded-full ${zone.type === 'support' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                      <span className="font-mono dark-mode-text">{formatPrice(zone.midPrice)}</span>
                      <span className="text-zinc-500">{zone.source}</span>
                      <div className="flex-1" />
                      <div className="w-12 h-1 bg-zinc-700/30 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${zone.type === 'support' ? 'bg-emerald-400' : 'bg-rose-400'}`} style={{ width: `${zone.strength}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sweep Events */}
            {r.liquidity.sweepEvents.length > 0 && (
              <div className="rounded-lg bg-amber-50/50 dark:bg-amber-900/10 p-2">
                <div className="text-[8px] text-amber-500 uppercase mb-1">🌊 Recent Sweeps</div>
                {r.liquidity.sweepEvents.map((sweep, i) => (
                  <div key={i} className="flex items-center gap-1 text-[9px]">
                    <span>{sweep.type === 'sell-side' ? '⬇️' : '⬆️'}</span>
                    <span className="dark-mode-text">{sweep.type}</span>
                    <span className="font-mono text-zinc-400">{formatPrice(sweep.price)}</span>
                    <span className={sweep.recovered ? 'text-emerald-400' : 'text-rose-400'}>
                      {sweep.recovered ? '✅ recovered' : '❌ not recovered'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Imbalance Zones */}
            {r.liquidity.imbalanceZones.length > 0 && (
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2">
                <div className="text-[8px] text-zinc-500 uppercase mb-1">Order Book Imbalances</div>
                {r.liquidity.imbalanceZones.slice(0, 5).map((zone, i) => (
                  <div key={i} className="flex items-center gap-1 text-[9px]">
                    <span className={zone.type === 'bid-heavy' ? 'text-emerald-400' : 'text-rose-400'}>
                      {zone.type === 'bid-heavy' ? '🟢' : '🔴'}
                    </span>
                    <span className="font-mono dark-mode-text">{formatPrice(zone.priceLevel)}</span>
                    <span className="text-zinc-500">ratio: {zone.ratio.toFixed(1)}</span>
                    <span className={`text-[8px] px-1 rounded ${
                      zone.strength === 'strong' ? 'bg-violet-900/30 text-violet-400' :
                      zone.strength === 'medium' ? 'bg-amber-900/30 text-amber-400' :
                      'bg-zinc-800/30 text-zinc-500'
                    }`}>{zone.strength}</span>
                  </div>
                ))}
              </div>
            )}

            <ScoreBar value={r.liquidity.score} label="Score" />
          </div>
        )}

        {/* ── STRUCTURE TAB ── */}
        {activeTab === 'structure' && r && (
          <div className="space-y-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-2">🏗 Market Structure</div>

            {/* Trend & Phase */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2 text-center">
                <div className="text-[8px] text-zinc-500 uppercase">Trend</div>
                <div className={`font-bold text-sm ${
                  r.structure.trend === 'bullish' ? 'text-emerald-500' : r.structure.trend === 'bearish' ? 'text-rose-500' : 'text-zinc-400'
                }`}>
                  {r.structure.trend === 'bullish' ? '📈' : r.structure.trend === 'bearish' ? '📉' : '↔️'} {r.structure.trend.toUpperCase()}
                </div>
                <MiniGauge value={r.structure.trendStrength} label="" />
              </div>
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2 text-center">
                <div className="text-[8px] text-zinc-500 uppercase">Phase</div>
                <div className="font-bold text-xs dark-mode-text mt-1">
                  {r.structure.phase === 'accumulation' ? '🔄' :
                   r.structure.phase === 'markup' ? '🚀' :
                   r.structure.phase === 'distribution' ? '📦' :
                   r.structure.phase === 'markdown' ? '💧' : '❓'} {r.structure.phase}
                </div>
              </div>
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2 text-center">
                <div className="text-[8px] text-zinc-500 uppercase">Zone</div>
                <div className={`font-bold text-xs mt-1 ${
                  r.structure.premiumDiscount === 'discount' ? 'text-emerald-400' :
                  r.structure.premiumDiscount === 'premium' ? 'text-rose-400' :
                  'text-zinc-400'
                }`}>
                  {r.structure.premiumDiscount === 'discount' ? '💰' : r.structure.premiumDiscount === 'premium' ? '💸' : '⚖️'} {r.structure.premiumDiscount}
                </div>
                <div className="text-[8px] text-zinc-500">EQ: {formatPrice(r.structure.equilibriumPrice)}</div>
              </div>
            </div>

            {/* MSS Detection */}
            {r.structure.mssDetected && (
              <div className={`rounded-lg p-2 ring-1 ${
                r.structure.mssDirection === 'bullish'
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 ring-emerald-500/30'
                  : 'bg-rose-50 dark:bg-rose-900/20 ring-rose-500/30'
              }`}>
                <div className="flex items-center gap-2">
                  <span className="text-base">🔥</span>
                  <span className={`text-xs font-black ${
                    r.structure.mssDirection === 'bullish' ? 'text-emerald-500' : 'text-rose-500'
                  }`}>
                    MSS DETECTED — {r.structure.mssDirection?.toUpperCase()}
                    </span>
                </div>
                <div className="text-[9px] text-zinc-400 mt-1">
                  Market Structure Shift confirmed by CHoCH + BOS
                </div>
              </div>
            )}

            {/* BOS & CHoCH */}
            {(r.structure.recentBOS.length > 0 || r.structure.recentCHoCH.length > 0) && (
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2">
                <div className="text-[8px] text-zinc-500 uppercase mb-1">Structure Breaks</div>
                {r.structure.recentCHoCH.map((b, i) => (
                  <div key={`choch-${i}`} className="flex items-center gap-1 text-[9px] py-0.5">
                    <span className="text-amber-400 font-bold">CHoCH</span>
                    <span className={b.direction === 'bullish' ? 'text-emerald-400' : 'text-rose-400'}>
                      {b.direction}
                    </span>
                    <span className="font-mono text-zinc-400">@ {formatPrice(b.brokenLevel)}</span>
                    <span className={`text-[8px] px-1 rounded ${
                      b.strength === 'strong' ? 'bg-violet-900/30 text-violet-400' : 'bg-zinc-800/30 text-zinc-500'
                    }`}>{b.strength}</span>
                  </div>
                ))}
                {r.structure.recentBOS.map((b, i) => (
                  <div key={`bos-${i}`} className="flex items-center gap-1 text-[9px] py-0.5">
                    <span className="text-sky-400 font-bold">BOS</span>
                    <span className={b.direction === 'bullish' ? 'text-emerald-400' : 'text-rose-400'}>
                      {b.direction}
                    </span>
                    <span className="font-mono text-zinc-400">@ {formatPrice(b.brokenLevel)}</span>
                    <span className={`text-[8px] px-1 rounded ${
                      b.strength === 'strong' ? 'bg-violet-900/30 text-violet-400' : 'bg-zinc-800/30 text-zinc-500'
                    }`}>{b.strength}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Points of Interest */}
            {r.structure.pointsOfInterest.length > 0 && (
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2">
                <div className="text-[8px] text-zinc-500 uppercase mb-1">Points of Interest</div>
                {r.structure.pointsOfInterest.slice(0, 6).map((poi, i) => (
                  <div key={i} className="flex items-center gap-1 text-[9px] py-0.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${poi.direction === 'bullish' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                    <span className="dark-mode-text">{poi.type}</span>
                    <span className="font-mono text-zinc-400">{formatPrice(poi.price)}</span>
                    <div className="flex-1" />
                    <div className="w-10 h-1 bg-zinc-700/30 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${poi.direction === 'bullish' ? 'bg-emerald-400' : 'bg-rose-400'}`} style={{ width: `${poi.strength}%` }} />
                    </div>
                  </div>
                ))}
            </div>
          )}

            {/* Fib Levels */}
            {r.structure.fibLevels.length > 0 && (
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2">
                <div className="text-[8px] text-zinc-500 uppercase mb-1">Fibonacci Levels</div>
                <div className="grid grid-cols-4 gap-1">
                  {r.structure.fibLevels.map((fib, i) => (
                    <div key={i} className="text-center">
                      <div className="text-[8px] text-zinc-500">{fib.label}</div>
                      <div className="font-mono text-[9px] dark-mode-text">{formatPrice(fib.price)}</div>
                    </div>
                  ))}
                </div>
        </div>
            )}

            <ScoreBar value={r.structure.score} label="Score" />
          </div>
        )}

        {/* ── RISK TAB ── */}
        {activeTab === 'risk' && (
          <div className="space-y-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-2">🛡 Risk Management</div>

            {/* Heat Index */}
            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-3">
              <div className="text-[9px] text-zinc-500 uppercase mb-1">Heat Index (Risk Exposure)</div>
              <div className="flex items-center gap-3">
                <div className={`text-3xl font-black ${
                  (liveRisk?.heatIndex ?? 0) > 70 ? 'text-rose-500' :
                  (liveRisk?.heatIndex ?? 0) > 40 ? 'text-amber-500' :
                  'text-emerald-500'
                }`}>
                  {(liveRisk?.heatIndex ?? 0).toFixed(0)}
                </div>
                <div className="flex-1">
                  <MiniGauge value={liveRisk?.heatIndex ?? 0} label="Heat" danger />
                </div>
          </div>
        </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2">
                <div className="text-[8px] text-zinc-500 uppercase">Drawdown</div>
                <div className={`font-mono font-bold text-sm ${
                  (liveRisk?.drawdownCurrent ?? 0) > config.maxDrawdown * 0.5 ? 'text-rose-500' : 'text-emerald-500'
                }`}>
                  {(liveRisk?.drawdownCurrent ?? 0).toFixed(1)}%
                </div>
                <div className="text-[8px] text-zinc-500">Max: {config.maxDrawdown}%</div>
          </div>
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2">
                <div className="text-[8px] text-zinc-500 uppercase">Daily P&L</div>
                <div className={`font-mono font-bold text-sm ${
                  (liveRisk?.dailyPnlPct ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'
                }`}>
                  {(liveRisk?.dailyPnlPct ?? 0) >= 0 ? '+' : ''}{(liveRisk?.dailyPnlPct ?? 0).toFixed(1)}%
                </div>
                <div className="text-[8px] text-zinc-500">Limit: -{config.maxDailyLoss}%</div>
              </div>
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2">
                <div className="text-[8px] text-zinc-500 uppercase">Consecutive L</div>
                <div className={`font-mono font-bold text-sm ${
                  (liveRisk?.consecutiveLosses ?? 0) >= 2 ? 'text-rose-500' : 'dark-mode-text'
                }`}>
                  {liveRisk?.consecutiveLosses ?? 0} / {config.maxConsecutiveLosses}
                </div>
              </div>
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2">
                <div className="text-[8px] text-zinc-500 uppercase">Win Rate (Last 20)</div>
                <div className={`font-mono font-bold text-sm ${
                  (liveRisk?.recentWinRate ?? 50) >= 50 ? 'text-emerald-500' : 'text-rose-500'
                }`}>
                  {(liveRisk?.recentWinRate ?? 50).toFixed(0)}%
                </div>
              </div>
            </div>

            {/* Kelly & Sizing */}
            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2">
              <div className="text-[8px] text-zinc-500 uppercase mb-1">Position Sizing</div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <span className="text-zinc-400">Kelly Fraction: </span>
                  <span className="font-mono font-bold dark-mode-text">{((liveRisk?.adjustedKelly ?? 0) * 100).toFixed(2)}%</span>
                </div>
                <div>
                  <span className="text-zinc-400">Size Multiplier: </span>
                  <span className={`font-mono font-bold ${(liveRisk?.sizeMultiplier ?? 1) < 0.8 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {(liveRisk?.sizeMultiplier ?? 1).toFixed(2)}x
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400">Risk/Trade: </span>
                  <span className="font-mono font-bold text-rose-400">
                    ${(liveRisk?.riskAmount ?? 0).toFixed(2)} ({(liveRisk?.riskPercent ?? 0).toFixed(1)}%)
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400">Max Position: </span>
                  <span className="font-mono font-bold dark-mode-text">
                    ${(liveRisk?.positionNotional ?? 0).toFixed(0)}
                </span>
                </div>
              </div>
            </div>

            {/* Risk Rules Status */}
            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2">
              <div className="text-[8px] text-zinc-500 uppercase mb-1">Risk Rules</div>
              <div className="space-y-1">
                {[
                  { label: 'Daily Loss Limit', ok: (liveRisk?.dailyPnlPct ?? 0) > -config.maxDailyLoss, detail: `${(liveRisk?.dailyPnlPct ?? 0).toFixed(1)}% / -${config.maxDailyLoss}%` },
                  { label: 'Max Drawdown', ok: (liveRisk?.drawdownCurrent ?? 0) < config.maxDrawdown, detail: `${(liveRisk?.drawdownCurrent ?? 0).toFixed(1)}% / ${config.maxDrawdown}%` },
                  { label: 'Consecutive Losses', ok: (liveRisk?.consecutiveLosses ?? 0) < config.maxConsecutiveLosses, detail: `${liveRisk?.consecutiveLosses ?? 0} / ${config.maxConsecutiveLosses}` },
                  { label: 'Max Trades/Day', ok: dailyStats.total < config.maxTradesPerDay, detail: `${dailyStats.total} / ${config.maxTradesPerDay}` },
                  { label: 'Size Not Reduced', ok: !(liveRisk?.shouldReduceSize ?? false), detail: liveRisk?.shouldReduceSize ? `Reduced to ${((liveRisk?.sizeMultiplier ?? 1) * 100).toFixed(0)}%` : 'Full size' },
                ].map((rule, i) => (
                  <div key={i} className="flex items-center gap-1 text-[9px]">
                    <span>{rule.ok ? '✅' : '❌'}</span>
                    <span className="dark-mode-text">{rule.label}</span>
                    <span className="ml-auto text-zinc-500">{rule.detail}</span>
              </div>
            ))}
              </div>
          </div>
        </div>
      )}

        {/* ── SHADOWS TAB ── */}
        {activeTab === 'shadows' && r && (
          <div className="space-y-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-2">🕯 Shadow / Wick Analysis</div>

            {/* ▓▓ SHADOW BIAS BANNER ▓▓ */}
            <div className={`rounded-xl p-3 text-center ${
              r.shadows.bias === 'bullish'
                ? 'bg-gradient-to-r from-emerald-950/60 to-emerald-900/30 ring-1 ring-emerald-500/40'
                : r.shadows.bias === 'bearish'
                ? 'bg-gradient-to-r from-rose-950/60 to-rose-900/30 ring-1 ring-rose-500/40'
                : 'bg-gradient-to-r from-zinc-900/60 to-zinc-800/30 ring-1 ring-zinc-700/40'
            }`}>
              <div className="text-[10px] font-bold tracking-wider uppercase mb-1 text-zinc-400">
                Shadow Bias
              </div>
              <div className={`text-sm font-black ${
                r.shadows.bias === 'bullish' ? 'text-emerald-400' : r.shadows.bias === 'bearish' ? 'text-rose-400' : 'text-zinc-300'
              }`}>
                {r.shadows.bias === 'bullish' ? '🟢 BULLISH REJECTION' : r.shadows.bias === 'bearish' ? '🔴 BEARISH REJECTION' : '⚪ NEUTRAL'}
              </div>
              <div className="text-[9px] text-zinc-500 mt-1">{r.shadows.summary}</div>
            </div>

            {/* ▓▓ SHADOW STATS ▓▓ */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2 text-center">
                <div className="text-[8px] text-zinc-500 uppercase">Avg Upper Wick</div>
                <div className="font-mono font-bold text-sm text-rose-400">{r.shadows.avgUpperWickPct.toFixed(1)}%</div>
              </div>
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2 text-center">
                <div className="text-[8px] text-zinc-500 uppercase">Avg Lower Wick</div>
                <div className="font-mono font-bold text-sm text-emerald-400">{r.shadows.avgLowerWickPct.toFixed(1)}%</div>
              </div>
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2 text-center">
                <div className="text-[8px] text-zinc-500 uppercase">Shadow Ratio</div>
                <div className="font-mono font-bold text-sm dark-mode-text">{r.shadows.avgShadowRatio.toFixed(2)}x</div>
                <div className="text-[7px] text-zinc-500">wick / body</div>
              </div>
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2 text-center">
                <div className="text-[8px] text-zinc-500 uppercase">Wick Dominance</div>
                <div className={`font-bold text-sm ${
                  r.shadows.wickDominance === 'lower' ? 'text-emerald-400'
                  : r.shadows.wickDominance === 'upper' ? 'text-rose-400'
                  : 'text-zinc-400'
                }`}>
                  {r.shadows.wickDominance === 'lower' ? '⬇️ Lower' : r.shadows.wickDominance === 'upper' ? '⬆️ Upper' : '⚖️ Balanced'}
                </div>
              </div>
            </div>

            {/* ▓▓ RECENT SHADOW PATTERNS ▓▓ */}
            {r.shadows.patterns.length > 0 && (
              <div className="rounded-xl bg-zinc-900/30 p-2.5">
                <div className="text-[8px] uppercase font-bold tracking-wider text-zinc-500 mb-2">
                  🕯 Shadow Patterns ({r.shadows.patterns.length})
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {r.shadows.patterns.slice(0, 10).map((pat, i) => (
                    <div key={i} className={`rounded-lg p-2 ${
                      pat.direction === 'bullish' ? 'bg-emerald-900/15 ring-1 ring-emerald-800/30'
                      : pat.direction === 'bearish' ? 'bg-rose-900/15 ring-1 ring-rose-800/30'
                      : 'bg-zinc-800/30 ring-1 ring-zinc-700/20'
                    }`}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px]">
                          {pat.direction === 'bullish' ? '🟢' : pat.direction === 'bearish' ? '🔴' : '⚪'}
                        </span>
                        <span className={`text-[10px] font-black ${
                          pat.direction === 'bullish' ? 'text-emerald-400'
                          : pat.direction === 'bearish' ? 'text-rose-400'
                          : 'text-zinc-300'
                        }`}>
                          {pat.type.replace(/-/g, ' ').toUpperCase()}
                        </span>
                        <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-zinc-800/50 text-zinc-300 font-bold">
                          {pat.strength.toFixed(0)}%
                        </span>
                        <span className="ml-auto text-[8px] text-zinc-500">
                          wick: {pat.wickPct.toFixed(0)}% ATR
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[9px]">
                        <span className="text-zinc-400">Price: <span className="font-mono dark-mode-text">{formatPrice(pat.price)}</span></span>
                        <span className="text-zinc-500">→</span>
                        <span className="text-zinc-400">Rejection: <span className="font-mono dark-mode-text">{formatPrice(pat.rejectionPrice)}</span></span>
                      </div>
                      <div className="text-[8px] text-zinc-500 mt-0.5">{pat.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ▓▓ STOP HUNT EVENTS ▓▓ */}
            {r.shadows.stopHunts.length > 0 && (
              <div className="rounded-xl bg-amber-900/10 ring-1 ring-amber-800/30 p-2.5">
                <div className="text-[8px] uppercase font-bold tracking-wider text-amber-400 mb-2">
                  🎯 Stop Hunt Detection ({r.shadows.stopHunts.length})
                </div>
                <div className="space-y-1.5">
                  {r.shadows.stopHunts.slice(0, 5).map((hunt, i) => (
                    <div key={i} className={`rounded-lg p-2 ${
                      hunt.type === 'long'
                        ? 'bg-emerald-900/15 ring-1 ring-emerald-800/25'
                        : 'bg-rose-900/15 ring-1 ring-rose-800/25'
                    }`}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px]">{hunt.type === 'long' ? '⬇️🟢' : '⬆️🔴'}</span>
                        <span className={`text-[10px] font-bold ${
                          hunt.type === 'long' ? 'text-emerald-400' : 'text-rose-400'
                        }`}>
                          {hunt.type === 'long' ? 'LONG STOP HUNT' : 'SHORT STOP HUNT'}
                        </span>
                        <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-zinc-800/50 text-zinc-300 font-bold">
                          {hunt.strength.toFixed(0)}%
                        </span>
                        <span className={`ml-auto text-[8px] font-bold ${hunt.recovered ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {hunt.recovered ? '✅ Recovered' : '❌ Not recovered'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-[8px] mt-1">
                        <div className="text-center">
                          <div className="text-zinc-500">Level Hunted</div>
                          <div className="font-mono font-bold dark-mode-text">{formatPrice(hunt.levelHunted)}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-zinc-500">Wick Extreme</div>
                          <div className="font-mono font-bold text-amber-400">
                            {formatPrice(hunt.type === 'long' ? hunt.wickLow : hunt.wickHigh)}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-zinc-500">Recovery</div>
                          <div className="font-mono font-bold dark-mode-text">{formatPrice(hunt.recoveryPrice)}</div>
                        </div>
                      </div>
                      <div className="text-[7px] text-zinc-500 mt-1">{hunt.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ▓▓ SHADOW CLUSTER ZONES (Hidden S/R) ▓▓ */}
            {r.shadows.clusterZones.length > 0 && (
              <div className="rounded-xl bg-zinc-900/30 p-2.5">
                <div className="text-[8px] uppercase font-bold tracking-wider text-zinc-500 mb-2">
                  📍 Wick Cluster Zones — Hidden S/R ({r.shadows.clusterZones.length})
                </div>
                <div className="space-y-1">
                  {r.shadows.clusterZones.slice(0, 8).map((zone, i) => (
                    <div key={i} className="flex items-center gap-2 text-[9px]">
                      <span className={`w-2 h-2 rounded-full ${zone.type === 'support' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                      <span className={`font-bold text-[9px] w-14 ${zone.type === 'support' ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {zone.type === 'support' ? 'SUP' : 'RES'}
                      </span>
                      <span className="font-mono dark-mode-text w-20">
                        {formatPrice(zone.priceLow)}–{formatPrice(zone.priceHigh)}
                      </span>
                      <span className="text-zinc-500">
                        {zone.wickCount} wicks
                      </span>
                      <div className="flex-1 h-1.5 bg-zinc-800/60 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${zone.type === 'support' ? 'bg-emerald-500' : 'bg-rose-500'}`}
                          style={{ width: `${zone.strength}%` }}
                        />
                      </div>
                      <span className="text-[8px] text-zinc-500 w-8 text-right">{zone.strength.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ▓▓ LAST 10 CANDLES SHADOW VISUALIZATION ▓▓ */}
            <div className="rounded-xl bg-zinc-900/30 p-2.5">
              <div className="text-[8px] uppercase font-bold tracking-wider text-zinc-500 mb-2">
                📊 Recent Candle Shadows (Last 10)
              </div>
              <div className="flex gap-1 items-end justify-center" style={{ height: 80 }}>
                {r.shadows.recentMetrics.slice(-10).map((m, i) => {
                  const maxRange = Math.max(...r.shadows.recentMetrics.slice(-10).map(rm => rm.totalRange)) || 1;
                  const scale = 70 / maxRange;
                  const uwH = m.upperWick * scale;
                  const bodyH = Math.max(2, m.body * scale);
                  const lwH = m.lowerWick * scale;
                  return (
                    <div key={i} className="flex flex-col items-center flex-1 min-w-0" title={`UW:${m.upperWickPct.toFixed(0)}% B:${m.bodyPct.toFixed(0)}% LW:${m.lowerWickPct.toFixed(0)}%`}>
                      {/* Upper wick */}
                      <div className="w-px bg-zinc-500" style={{ height: `${uwH}px` }} />
                      {/* Body */}
                      <div
                        className={`w-3 rounded-sm ${m.isBullish ? 'bg-emerald-500' : 'bg-rose-500'}`}
                        style={{ height: `${bodyH}px` }}
                      />
                      {/* Lower wick */}
                      <div className="w-px bg-zinc-500" style={{ height: `${lwH}px` }} />
                      {/* Labels */}
                      <div className="text-[6px] text-zinc-600 mt-0.5 whitespace-nowrap">
                        {m.upperWickPct > 40 ? '⬆' : m.lowerWickPct > 40 ? '⬇' : '·'}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-[7px] text-zinc-600 mt-1">
                <span>← Older</span>
                <span>⬆=Upper wick dominant ⬇=Lower wick dominant</span>
                <span>Newer →</span>
              </div>
            </div>

            <ScoreBar value={r.shadows.score} label="Shadow Score" />
          </div>
        )}

        {/* ── PROP FIRM TAB ── */}
        {activeTab === 'prop' && (
          <div className="space-y-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-2">🏦 Prop Firm Dashboard</div>

            {!config.propFirmMode ? (
              <div className="text-center py-8">
                <div className="text-3xl mb-3">🏦</div>
                <div className="text-sm font-semibold dark-mode-text mb-1">Prop Trading Mode Disabled</div>
                <div className="text-[11px] text-zinc-500 mb-4 max-w-xs mx-auto">
                  Enable Prop Firm Mode in settings (⚙️) to track compliance with prop firm rules like FTMO, Topstep, Apex, etc.
                </div>
                <button
                  onClick={() => { setShowConfig(true); setConfig(c => ({ ...c, propFirmMode: true, propFirmId: 'ftmo', propAccountSize: 100000, capital: 100000, propStartDate: Date.now() })); }}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white transition-colors"
                >
                  🚀 Quick Start with FTMO $100K
                </button>
              </div>
            ) : liveRisk?.propCompliance ? (
              <>
                {/* ▓▓ ACCOUNT HEALTH ▓▓ */}
                <div className={`rounded-xl p-3 text-center ${
                  liveRisk.propCompliance.overallStatus === 'compliant'
                    ? 'bg-gradient-to-r from-emerald-950/60 to-emerald-900/30 ring-1 ring-emerald-500/40'
                    : liveRisk.propCompliance.overallStatus === 'warning'
                    ? 'bg-gradient-to-r from-amber-950/60 to-amber-900/30 ring-1 ring-amber-500/40'
                    : 'bg-gradient-to-r from-rose-950/60 to-rose-900/30 ring-1 ring-rose-500/40'
                }`}>
                  <div className="text-[10px] font-bold tracking-wider uppercase mb-1 text-zinc-400">
                    {getPropPreset(config.propFirmId)?.name ?? 'Prop Firm'} — {config.propPhase.toUpperCase()}
                  </div>
                  <div className={`text-2xl font-black ${
                    liveRisk.propCompliance.overallStatus === 'compliant' ? 'text-emerald-400'
                    : liveRisk.propCompliance.overallStatus === 'warning' ? 'text-amber-400'
                    : 'text-rose-400'
                  }`}>
                    {liveRisk.propCompliance.overallStatus === 'compliant' ? '✅ COMPLIANT'
                    : liveRisk.propCompliance.overallStatus === 'warning' ? '⚠️ WARNING'
                    : '⛔ VIOLATED'}
                  </div>
                  <div className="text-[9px] text-zinc-500 mt-1">
                    Account: ${config.propAccountSize.toLocaleString()} • Health: {liveRisk.propCompliance.accountHealth.toFixed(0)}%
                  </div>
                </div>

                {/* ▓▓ ACCOUNT HEALTH BAR ▓▓ */}
                <div className="rounded-xl bg-zinc-900/30 p-2.5">
                  <div className="text-[8px] uppercase font-bold tracking-wider text-zinc-500 mb-2">Account Health</div>
                  <div className="h-3 bg-zinc-800/60 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        liveRisk.propCompliance.accountHealth > 70 ? 'bg-emerald-500'
                        : liveRisk.propCompliance.accountHealth > 40 ? 'bg-amber-500'
                        : 'bg-rose-500'
                      }`}
                      style={{ width: `${liveRisk.propCompliance.accountHealth}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[8px] text-zinc-500 mt-1">
                    <span>Danger</span>
                    <span className="font-bold dark-mode-text">{liveRisk.propCompliance.accountHealth.toFixed(0)}%</span>
                    <span>Safe</span>
                  </div>
                </div>

                {/* ▓▓ PROFIT TARGET PROGRESS ▓▓ */}
                {liveRisk.propCompliance.profitTargetPct > 0 && (
                  <div className="rounded-xl bg-zinc-900/30 p-2.5">
                    <div className="text-[8px] uppercase font-bold tracking-wider text-zinc-500 mb-2">
                      🎯 Profit Target — {liveRisk.propCompliance.currentProfitPct.toFixed(2)}% / {liveRisk.propCompliance.profitTargetPct}%
                    </div>
                    <div className="h-4 bg-zinc-800/60 rounded-full overflow-hidden relative">
                      <div
                        className={`h-full rounded-full transition-all ${
                          liveRisk.propCompliance.progressToTarget >= 100 ? 'bg-emerald-500' : 'bg-violet-500'
                        }`}
                        style={{ width: `${Math.min(100, liveRisk.propCompliance.progressToTarget)}%` }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[9px] font-bold text-white drop-shadow">
                          {liveRisk.propCompliance.progressToTarget.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-between text-[9px] mt-1.5">
                      <span className="text-zinc-400">
                        Current: <span className={`font-bold ${liveRisk.propCompliance.currentProfitPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {liveRisk.propCompliance.currentProfitPct >= 0 ? '+' : ''}{liveRisk.propCompliance.currentProfitPct.toFixed(2)}%
                        </span>
                      </span>
                      <span className="text-zinc-400">
                        Target: <span className="font-bold text-violet-400">${liveRisk.propCompliance.profitTarget.toLocaleString()}</span>
                      </span>
                    </div>
                  </div>
                )}

                {/* ▓▓ KEY METRICS GRID ▓▓ */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2 text-center">
                    <div className="text-[8px] text-zinc-500 uppercase">Days Traded</div>
                    <div className="font-mono font-bold text-sm dark-mode-text">
                      {liveRisk.propCompliance.daysTraded}
                      {liveRisk.propCompliance.minDaysRequired > 0 && (
                        <span className="text-[9px] text-zinc-500">/{liveRisk.propCompliance.minDaysRequired}</span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2 text-center">
                    <div className="text-[8px] text-zinc-500 uppercase">Days Left</div>
                    <div className={`font-mono font-bold text-sm ${
                      liveRisk.propCompliance.daysRemaining === -1 ? 'text-emerald-400'
                      : liveRisk.propCompliance.daysRemaining < 5 ? 'text-rose-400'
                      : 'dark-mode-text'
                    }`}>
                      {liveRisk.propCompliance.daysRemaining === -1 ? '∞' : liveRisk.propCompliance.daysRemaining}
                    </div>
                  </div>
                  <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2 text-center">
                    <div className="text-[8px] text-zinc-500 uppercase">Consistency</div>
                    <div className={`font-mono font-bold text-sm ${
                      liveRisk.propCompliance.consistencyScore > 70 ? 'text-emerald-400'
                      : liveRisk.propCompliance.consistencyScore > 40 ? 'text-amber-400'
                      : 'text-rose-400'
                    }`}>
                      {liveRisk.propCompliance.consistencyScore.toFixed(0)}%
                    </div>
                  </div>
                  <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 p-2 text-center">
                    <div className="text-[8px] text-zinc-500 uppercase">
                      {liveRisk.propCompliance.profitSplit > 0 ? 'Est. Payout' : 'Profit Split'}
                    </div>
                    <div className="font-mono font-bold text-sm text-emerald-400">
                      {liveRisk.propCompliance.profitSplit > 0
                        ? `$${liveRisk.propCompliance.estimatedPayout.toFixed(0)}`
                        : `${liveRisk.propCompliance.profitSplit}%`
                      }
                    </div>
                    {liveRisk.propCompliance.profitSplit > 0 && (
                      <div className="text-[7px] text-zinc-500">{liveRisk.propCompliance.profitSplit}% split</div>
                    )}
                  </div>
                </div>

                {/* ▓▓ DRAWDOWN VISUALIZATION ▓▓ */}
                <div className="rounded-xl bg-zinc-900/30 p-2.5">
                  <div className="text-[8px] uppercase font-bold tracking-wider text-zinc-500 mb-2">
                    {liveRisk.propCompliance.trailingDrawdownPct > 0 ? '📉 Trailing' : '📉'} Drawdown
                  </div>
                  <div className="flex items-end gap-2 mb-2">
                    <div className={`text-2xl font-black ${
                      liveRisk.propCompliance.trailingDrawdownPct > (getPropPreset(config.propFirmId)?.phases[config.propPhase]?.maxTotalDrawdown ?? 10) * 0.7 ? 'text-rose-400'
                      : liveRisk.propCompliance.trailingDrawdownPct > (getPropPreset(config.propFirmId)?.phases[config.propPhase]?.maxTotalDrawdown ?? 10) * 0.4 ? 'text-amber-400'
                      : 'text-emerald-400'
                    }`}>
                      {liveRisk.propCompliance.trailingDrawdownPct.toFixed(2)}%
                    </div>
                    <div className="text-[9px] text-zinc-500 mb-1">
                      / {getPropPreset(config.propFirmId)?.phases[config.propPhase]?.maxTotalDrawdown ?? config.maxDrawdown}% max
                    </div>
                  </div>
                  <div className="h-2 bg-zinc-800/60 rounded-full overflow-hidden">
                    {(() => {
                      const maxDD = getPropPreset(config.propFirmId)?.phases[config.propPhase]?.maxTotalDrawdown ?? config.maxDrawdown;
                      const pctFilled = maxDD > 0 ? Math.min(100, (liveRisk.propCompliance.trailingDrawdownPct / maxDD) * 100) : 0;
                      return (
                        <div
                          className={`h-full rounded-full transition-all ${
                            pctFilled > 75 ? 'bg-rose-500' : pctFilled > 50 ? 'bg-amber-500' : 'bg-emerald-500'
                          }`}
                          style={{ width: `${pctFilled}%` }}
                        />
                      );
                    })()}
                  </div>
                  <div className="text-[8px] text-zinc-500 mt-1">
                    High water mark: ${liveRisk.propCompliance.trailingDrawdownLevel.toLocaleString()}
                  </div>
                </div>

                {/* ▓▓ COMPLIANCE RULES ▓▓ */}
                <div className="rounded-xl bg-zinc-900/30 p-2.5">
                  <div className="text-[8px] uppercase font-bold tracking-wider text-zinc-500 mb-2">📋 Rule Compliance</div>
                  <div className="space-y-1.5">
                    {liveRisk.propCompliance.rules.map((rule) => (
                      <div key={rule.id} className="rounded-lg bg-zinc-800/30 p-2">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px]">
                            {rule.severity === 'ok' ? '✅' : rule.severity === 'warning' ? '⚠️' : rule.severity === 'danger' ? '🔶' : '⛔'}
                          </span>
                          <span className="text-[10px] font-semibold dark-mode-text flex-1">{rule.label}</span>
                          <span className={`text-[9px] font-mono font-bold ${
                            rule.severity === 'ok' ? 'text-emerald-400'
                            : rule.severity === 'warning' ? 'text-amber-400'
                            : 'text-rose-400'
                          }`}>
                            {rule.current}
                          </span>
                          <span className="text-[8px] text-zinc-500">/ {rule.limit}</span>
                        </div>
                        <div className="h-1.5 bg-zinc-700/40 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              rule.severity === 'ok' ? 'bg-emerald-500'
                              : rule.severity === 'warning' ? 'bg-amber-500'
                              : 'bg-rose-500'
                            }`}
                            style={{ width: `${rule.pctUsed}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ▓▓ PROP TIPS ▓▓ */}
                <div className="rounded-xl bg-violet-900/10 ring-1 ring-violet-800/30 p-2.5">
                  <div className="text-[8px] uppercase font-bold tracking-wider text-violet-400 mb-2">💡 Prop Trading Tips</div>
                  <div className="space-y-1 text-[9px] text-zinc-400">
                    {liveRisk.propCompliance.trailingDrawdownPct > (getPropPreset(config.propFirmId)?.phases[config.propPhase]?.maxTotalDrawdown ?? 10) * 0.5 && (
                      <div className="flex items-start gap-1.5">
                        <span className="text-rose-400">⚠</span>
                        <span>Drawdown over 50% of limit. <span className="text-rose-400 font-bold">Reduce position sizes immediately.</span></span>
                      </div>
                    )}
                    {liveRisk.propCompliance.maxSingleTradePct > 25 && (
                      <div className="flex items-start gap-1.5">
                        <span className="text-amber-400">⚠</span>
                        <span>Largest single trade is {liveRisk.propCompliance.maxSingleTradePct.toFixed(0)}% of total profit. <span className="text-amber-400 font-bold">Aim for smaller, consistent wins.</span></span>
                      </div>
                    )}
                    {liveRisk.propCompliance.daysTraded < liveRisk.propCompliance.minDaysRequired && (
                      <div className="flex items-start gap-1.5">
                        <span className="text-violet-400">ℹ</span>
                        <span>Need {liveRisk.propCompliance.minDaysRequired - liveRisk.propCompliance.daysTraded} more trading days to pass.</span>
                      </div>
                    )}
                    {liveRisk.propCompliance.progressToTarget >= 100 && liveRisk.propCompliance.daysTraded >= liveRisk.propCompliance.minDaysRequired && (
                      <div className="flex items-start gap-1.5">
                        <span className="text-emerald-400">🎉</span>
                        <span className="text-emerald-400 font-bold">All targets met! You may be eligible to pass this phase.</span>
                      </div>
                    )}
                    <div className="flex items-start gap-1.5">
                      <span className="text-zinc-500">📌</span>
                      <span>Risk max 1% per trade in prop accounts. Consistency beats big wins.</span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-6">
                <div className="text-2xl mb-2">📊</div>
                <div className="text-sm text-zinc-500">Calculating prop compliance...</div>
              </div>
            )}
          </div>
        )}

        {/* ── AMD TAB ── */}
        {activeTab === 'amd' && r && (
          <div className="space-y-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-2">⏱ AMD — 4H Roadmap + 5min Entry</div>

            {/* ▓▓ PHASE BANNER ▓▓ */}
            <div className={`rounded-xl p-3 text-center ${
              r.amd.phase === 'accumulation'
                ? 'bg-gradient-to-r from-blue-950/60 to-blue-900/30 ring-1 ring-blue-500/40'
                : r.amd.phase === 'manipulation'
                ? 'bg-gradient-to-r from-amber-950/60 to-amber-900/30 ring-1 ring-amber-500/40'
                : r.amd.phase === 'distribution'
                ? 'bg-gradient-to-r from-violet-950/60 to-violet-900/30 ring-1 ring-violet-500/40'
                : 'bg-gradient-to-r from-zinc-900/60 to-zinc-800/30 ring-1 ring-zinc-700/40'
            }`}>
              <div className="text-[10px] font-bold tracking-wider uppercase mb-1 text-zinc-400">
                Current Phase
              </div>
              <div className={`text-lg font-black ${
                r.amd.phase === 'accumulation' ? 'text-blue-400'
                : r.amd.phase === 'manipulation' ? 'text-amber-400'
                : r.amd.phase === 'distribution' ? 'text-violet-400'
                : 'text-zinc-400'
              }`}>
                {r.amd.phase === 'accumulation' ? '📦 ACCUMULATION'
                : r.amd.phase === 'manipulation' ? '⚡ MANIPULATION'
                : r.amd.phase === 'distribution' ? '🚀 DISTRIBUTION'
                : '👁 WATCHING'}
              </div>
              <div className="text-[9px] text-zinc-500 mt-1">{r.amd.phaseTiming}</div>
              {/* Phase progress bar */}
              <div className="mt-2 h-2 bg-zinc-800/60 rounded-full overflow-hidden">
                <div className="h-full flex">
                  <div
                    className="bg-blue-500/70 transition-all"
                    style={{ width: `${Math.min(r.amd.phaseProgress, 30)}%` }}
                    title="Accumulation"
                  />
                  <div
                    className="bg-amber-500/70 transition-all"
                    style={{ width: `${Math.max(0, Math.min(r.amd.phaseProgress - 30, 25))}%` }}
                    title="Manipulation"
                  />
                  <div
                    className="bg-violet-500/70 transition-all"
                    style={{ width: `${Math.max(0, r.amd.phaseProgress - 55)}%` }}
                    title="Distribution"
                  />
                </div>
              </div>
              <div className="flex justify-between text-[7px] text-zinc-600 mt-0.5 px-1">
                <span>Accum</span>
                <span>Manip</span>
                <span>Distrib</span>
              </div>
            </div>

            {/* ▓▓ SESSION WINDOW ▓▓ */}
            <div className={`rounded-lg p-2 flex items-center gap-2 ${
              r.amd.session.quality === 'premium' ? 'bg-emerald-900/20 ring-1 ring-emerald-800/30'
              : r.amd.session.quality === 'good' ? 'bg-blue-900/20 ring-1 ring-blue-800/30'
              : r.amd.session.quality === 'fair' ? 'bg-zinc-800/30 ring-1 ring-zinc-700/20'
              : 'bg-zinc-800/20 ring-1 ring-zinc-700/15'
            }`}>
              <span className="text-sm">
                {r.amd.session.quality === 'premium' ? '🔥' : r.amd.session.quality === 'good' ? '⚡' : r.amd.session.quality === 'fair' ? '🌙' : '💤'}
              </span>
              <div>
                <div className="text-[10px] font-bold dark-mode-text">{r.amd.session.name}</div>
                <div className="text-[8px] text-zinc-500">{r.amd.session.description}</div>
              </div>
              <span className={`ml-auto text-[8px] px-2 py-0.5 rounded-full font-bold ${
                r.amd.session.quality === 'premium' ? 'bg-emerald-500/20 text-emerald-400'
                : r.amd.session.quality === 'good' ? 'bg-blue-500/20 text-blue-400'
                : r.amd.session.quality === 'fair' ? 'bg-zinc-500/20 text-zinc-400'
                : 'bg-zinc-800/50 text-zinc-500'
              }`}>
                {r.amd.session.quality.toUpperCase()}
              </span>
            </div>

            {/* ▓▓ 4H ROADMAP ▓▓ */}
            <div className="rounded-xl bg-zinc-900/30 p-2.5">
              <div className="text-[8px] uppercase font-bold tracking-wider text-zinc-500 mb-2">
                🗺️ 4H Roadmap — Key Levels
              </div>
              {/* Visual 4H level map */}
              <div className="relative mx-auto" style={{ height: 120, maxWidth: 280 }}>
                {/* Previous 4H candle high */}
                <div className="absolute left-0 right-0 flex items-center gap-2" style={{ top: 0 }}>
                  <div className="h-px flex-1 bg-rose-500/60 border-t border-dashed border-rose-500/40" />
                  <span className="text-[8px] font-mono text-rose-400 whitespace-nowrap">
                    Prev 4H High: {formatPrice(r.amd.roadmap.keyLevels.prevHigh)}
                  </span>
                </div>
                {/* Previous 4H mid */}
                <div className="absolute left-0 right-0 flex items-center gap-2" style={{ top: 40 }}>
                  <div className="h-px flex-1 bg-zinc-500/40 border-t border-dashed border-zinc-500/30" />
                  <span className="text-[8px] font-mono text-zinc-400 whitespace-nowrap">
                    Prev 4H Mid: {formatPrice(r.amd.roadmap.keyLevels.prevMid)}
                  </span>
                </div>
                {/* Current price marker */}
                <div className="absolute left-0 right-0 flex items-center gap-2" style={{ top: 60 }}>
                  <div className="h-0.5 flex-1 bg-yellow-400/60" />
                  <span className="text-[8px] font-mono text-yellow-400 font-bold whitespace-nowrap">
                    ► Now: {formatPrice(r.amd.roadmap.current.close)}
                  </span>
                </div>
                {/* Previous 4H candle low */}
                <div className="absolute left-0 right-0 flex items-center gap-2" style={{ top: 100 }}>
                  <div className="h-px flex-1 bg-emerald-500/60 border-t border-dashed border-emerald-500/40" />
                  <span className="text-[8px] font-mono text-emerald-400 whitespace-nowrap">
                    Prev 4H Low: {formatPrice(r.amd.roadmap.keyLevels.prevLow)}
                  </span>
                </div>
              </div>

              {/* 4H Stats Grid */}
              <div className="grid grid-cols-3 gap-2 mt-3">
                <div className="rounded-lg bg-zinc-800/40 p-1.5 text-center">
                  <div className="text-[7px] text-zinc-500 uppercase">Prev 4H Bias</div>
                  <div className={`text-[10px] font-bold ${
                    r.amd.roadmap.bias4H === 'bullish' ? 'text-emerald-400'
                    : r.amd.roadmap.bias4H === 'bearish' ? 'text-rose-400'
                    : 'text-zinc-400'
                  }`}>
                    {r.amd.roadmap.bias4H === 'bullish' ? '🟢 Bullish'
                    : r.amd.roadmap.bias4H === 'bearish' ? '🔴 Bearish'
                    : '⚪ Neutral'}
                  </div>
                </div>
                <div className="rounded-lg bg-zinc-800/40 p-1.5 text-center">
                  <div className="text-[7px] text-zinc-500 uppercase">4H Range</div>
                  <div className="text-[10px] font-mono font-bold dark-mode-text">
                    {formatPrice(r.amd.roadmap.prevRange)}
                  </div>
                  {r.amd.roadmap.isExpanded && (
                    <div className="text-[6px] text-amber-400">EXPANDED</div>
                  )}
                </div>
                <div className="rounded-lg bg-zinc-800/40 p-1.5 text-center">
                  <div className="text-[7px] text-zinc-500 uppercase">4H Progress</div>
                  <div className="text-[10px] font-mono font-bold dark-mode-text">
                    {r.amd.phaseProgress.toFixed(0)}%
                  </div>
                </div>
              </div>
            </div>

            {/* ▓▓ ACCUMULATION ZONE ▓▓ */}
            {r.amd.accumulation.detected && (
              <div className="rounded-xl bg-blue-900/10 ring-1 ring-blue-800/25 p-2.5">
                <div className="text-[8px] uppercase font-bold tracking-wider text-blue-400 mb-1.5">
                  📦 Accumulation Zone Detected
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="text-center">
                    <div className="text-[7px] text-zinc-500">Range</div>
                    <div className="text-[9px] font-mono dark-mode-text">
                      {formatPrice(r.amd.accumulation.low)} – {formatPrice(r.amd.accumulation.high)}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-[7px] text-zinc-500">Width (% of 4H)</div>
                    <div className="text-[9px] font-mono font-bold text-blue-400">
                      {r.amd.accumulation.rangePct.toFixed(1)}%
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-[7px] text-zinc-500">Tightness</div>
                    <div className="flex items-center justify-center gap-1">
                      <div className="w-12 h-1.5 bg-zinc-800/60 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${r.amd.accumulation.tightness}%` }} />
                      </div>
                      <span className="text-[8px] text-blue-400">{r.amd.accumulation.tightness}%</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ▓▓ MANIPULATION EVENT ▓▓ */}
            {r.amd.manipulation.detected && (
              <div className={`rounded-xl p-2.5 ${
                r.amd.manipulation.direction === 'bullish'
                  ? 'bg-emerald-900/15 ring-1 ring-emerald-800/30'
                  : 'bg-rose-900/15 ring-1 ring-rose-800/30'
              }`}>
                <div className={`text-[8px] uppercase font-bold tracking-wider mb-1.5 ${
                  r.amd.manipulation.direction === 'bullish' ? 'text-amber-400' : 'text-amber-400'
                }`}>
                  ⚡ Manipulation Detected
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">
                    {r.amd.manipulation.direction === 'bullish' ? '⬇️🟢' : '⬆️🔴'}
                  </span>
                  <div>
                    <div className={`text-[10px] font-bold ${
                      r.amd.manipulation.direction === 'bullish' ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {r.amd.manipulation.type === 'sweep-low' ? 'SWEPT 4H LOW → Bullish Setup' : 'SWEPT 4H HIGH → Bearish Setup'}
                    </div>
                    <div className="text-[8px] text-zinc-500">{r.amd.manipulation.description}</div>
                  </div>
                  {r.amd.manipulation.isClean && (
                    <span className="ml-auto text-[8px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold">
                      CLEAN ✨
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-zinc-800/30 p-1.5 text-center">
                    <div className="text-[7px] text-zinc-500">Sweep Price</div>
                    <div className="font-mono text-[9px] font-bold text-amber-400">
                      {formatPrice(r.amd.manipulation.sweepPrice)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-zinc-800/30 p-1.5 text-center">
                    <div className="text-[7px] text-zinc-500">Level Swept</div>
                    <div className="font-mono text-[9px] font-bold dark-mode-text">
                      {formatPrice(r.amd.manipulation.levelSwept)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-zinc-800/30 p-1.5 text-center">
                    <div className="text-[7px] text-zinc-500">Recovery</div>
                    <div className="font-mono text-[9px] font-bold dark-mode-text">
                      {r.amd.manipulation.recoveryStrength.toFixed(0)}%
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ▓▓ DISTRIBUTION MOVE ▓▓ */}
            {r.amd.distribution.detected && (
              <div className="rounded-xl bg-violet-900/15 ring-1 ring-violet-800/30 p-2.5">
                <div className="text-[8px] uppercase font-bold tracking-wider text-violet-400 mb-1.5">
                  🚀 Distribution — {r.amd.distribution.direction === 'bullish' ? 'Moving Up' : 'Moving Down'}
                </div>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <div className="text-center">
                    <div className="text-[7px] text-zinc-500">Start</div>
                    <div className="font-mono text-[9px] dark-mode-text">{formatPrice(r.amd.distribution.startPrice)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[7px] text-zinc-500">Current</div>
                    <div className="font-mono text-[9px] font-bold dark-mode-text">{formatPrice(r.amd.distribution.currentPrice)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[7px] text-zinc-500">Target</div>
                    <div className={`font-mono text-[9px] font-bold ${
                      r.amd.distribution.direction === 'bullish' ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {formatPrice(r.amd.distribution.targetPrice)}
                    </div>
                  </div>
                </div>
                {/* Progress to target */}
                <div className="h-2.5 bg-zinc-800/60 rounded-full overflow-hidden mb-1">
                  <div
                    className="h-full bg-gradient-to-r from-violet-600 to-violet-400 rounded-full transition-all"
                    style={{ width: `${r.amd.distribution.progressPct}%` }}
                  />
                </div>
                <div className="flex justify-between text-[7px] text-zinc-500">
                  <span>Start</span>
                  <span className="font-bold text-violet-400">{r.amd.distribution.progressPct.toFixed(0)}% to target</span>
                  <span>Target</span>
                </div>
                <div className="flex gap-3 mt-1.5 text-[8px]">
                  <span className={r.amd.distribution.momentumConfirmed ? 'text-emerald-400' : 'text-zinc-500'}>
                    {r.amd.distribution.momentumConfirmed ? '✅' : '❌'} Momentum
                  </span>
                  <span className={r.amd.distribution.structureConfirmed ? 'text-emerald-400' : 'text-zinc-500'}>
                    {r.amd.distribution.structureConfirmed ? '✅' : '❌'} Structure Shift
                  </span>
                </div>
              </div>
            )}

            {/* ▓▓ AMD ENTRY SIGNAL ▓▓ */}
            {r.amd.entry.active ? (
              <div className={`rounded-xl p-3 ${
                r.amd.entry.direction === 'LONG'
                  ? 'bg-gradient-to-br from-emerald-950/60 to-emerald-900/20 ring-2 ring-emerald-500/50'
                  : 'bg-gradient-to-br from-rose-950/60 to-rose-900/20 ring-2 ring-rose-500/50'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">{r.amd.entry.direction === 'LONG' ? '🟢' : '🔴'}</span>
                  <div>
                    <div className={`text-sm font-black ${
                      r.amd.entry.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      AMD {r.amd.entry.direction} SIGNAL
                    </div>
                    <div className="text-[8px] text-zinc-400">{r.amd.entry.trigger}</div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="text-[8px] text-zinc-500">Confidence</div>
                    <div className={`font-mono font-bold ${
                      r.amd.entry.confidence >= 70 ? 'text-emerald-400'
                      : r.amd.entry.confidence >= 50 ? 'text-yellow-400'
                      : 'text-zinc-400'
                    }`}>
                      {r.amd.entry.confidence}%
                    </div>
                  </div>
                </div>
                {/* Entry levels */}
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div className="rounded-lg bg-zinc-800/40 p-1.5 text-center">
                    <div className="text-[7px] text-zinc-500">Entry</div>
                    <div className="font-mono text-[10px] font-bold dark-mode-text">{formatPrice(r.amd.entry.entry)}</div>
                  </div>
                  <div className="rounded-lg bg-rose-900/20 p-1.5 text-center">
                    <div className="text-[7px] text-zinc-500">Stop Loss</div>
                    <div className="font-mono text-[10px] font-bold text-rose-400">{formatPrice(r.amd.entry.stopLoss)}</div>
                  </div>
                </div>
                {/* Targets */}
                <div className="grid grid-cols-3 gap-1.5 mb-2">
                  <div className="rounded-lg bg-emerald-900/15 p-1.5 text-center">
                    <div className="text-[6px] text-zinc-500">TP1 (Mid)</div>
                    <div className="font-mono text-[9px] text-emerald-400">{formatPrice(r.amd.entry.takeProfit1)}</div>
                    <div className="text-[7px] text-zinc-500">R:R {r.amd.entry.riskReward1.toFixed(1)}</div>
                  </div>
                  <div className="rounded-lg bg-emerald-900/20 p-1.5 text-center">
                    <div className="text-[6px] text-zinc-500">TP2 (4H Level)</div>
                    <div className="font-mono text-[9px] text-emerald-400 font-bold">{formatPrice(r.amd.entry.takeProfit2)}</div>
                    <div className="text-[7px] text-zinc-500">R:R {r.amd.entry.riskReward2.toFixed(1)}</div>
                  </div>
                  <div className="rounded-lg bg-emerald-900/25 p-1.5 text-center">
                    <div className="text-[6px] text-zinc-500">TP3 (Ext)</div>
                    <div className="font-mono text-[9px] text-emerald-400">{formatPrice(r.amd.entry.takeProfit3)}</div>
                    <div className="text-[7px] text-zinc-500">R:R {r.amd.entry.riskReward3.toFixed(1)}</div>
                  </div>
                </div>
                <div className="text-[8px] text-zinc-500">
                  ❌ Invalidation: <span className="text-rose-400">{r.amd.entry.invalidation}</span>
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-zinc-900/30 ring-1 ring-zinc-700/20 p-3 text-center">
                <div className="text-lg mb-1">⏳</div>
                <div className="text-[10px] font-bold text-zinc-400">No AMD Entry Signal</div>
                <div className="text-[8px] text-zinc-500 mt-0.5">{r.amd.entry.trigger}</div>
              </div>
            )}

            {/* ▓▓ SHADOW CONFIRMATION ▓▓ */}
            <div className="rounded-lg bg-zinc-800/30 p-2 flex items-center gap-3">
              <span className="text-sm">{r.amd.shadowConfirmation.confirms ? '✅' : '⚠️'}</span>
              <div className="flex-1">
                <div className="text-[9px] font-bold dark-mode-text">Shadow Confirmation</div>
                <div className="text-[8px] text-zinc-500">
                  Bias: {r.amd.shadowConfirmation.bias} |
                  Stop hunt: {r.amd.shadowConfirmation.stopHuntDetected ? 'Yes' : 'No'} |
                  Pattern: {r.amd.shadowConfirmation.recentPattern.replace(/-/g, ' ')}
                </div>
              </div>
              <span className={`text-[8px] px-2 py-0.5 rounded-full font-bold ${
                r.amd.shadowConfirmation.confirms
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-zinc-700/30 text-zinc-500'
              }`}>
                {r.amd.shadowConfirmation.confirms ? 'CONFIRMED' : 'PENDING'}
              </span>
            </div>

            {/* ▓▓ AMD SUMMARY ▓▓ */}
            <div className="rounded-xl bg-zinc-900/30 ring-1 ring-zinc-700/20 p-2.5 text-center">
              <div className="text-[9px] text-zinc-400 mb-1">{r.amd.summary}</div>
              <div className="flex items-center justify-center gap-1">
                <span className="text-[8px] text-zinc-500">Setup Quality:</span>
                <div className="w-20 h-1.5 bg-zinc-800/60 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      r.amd.score >= 70 ? 'bg-emerald-500'
                      : r.amd.score >= 40 ? 'bg-yellow-500'
                      : 'bg-zinc-600'
                    }`}
                    style={{ width: `${r.amd.score}%` }}
                  />
                </div>
                <span className="text-[8px] font-bold dark-mode-text">{r.amd.score.toFixed(0)}%</span>
              </div>
            </div>
          </div>
        )}

        {/* ── FRACTALS TAB ── */}
        {activeTab === 'fractals' && r && (
          <div className="space-y-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-2">📐 Fractal Analysis</div>

            {/* ▓▓ ALLIGATOR STATE BANNER ▓▓ */}
            <div className={`rounded-xl p-3 text-center ${
              r.fractals.alligator.state === 'eating-bull'
                ? 'bg-gradient-to-r from-emerald-950/60 to-emerald-900/30 ring-1 ring-emerald-500/40'
                : r.fractals.alligator.state === 'eating-bear'
                ? 'bg-gradient-to-r from-rose-950/60 to-rose-900/30 ring-1 ring-rose-500/40'
                : r.fractals.alligator.state === 'awakening'
                ? 'bg-gradient-to-r from-amber-950/60 to-amber-900/30 ring-1 ring-amber-500/40'
                : 'bg-gradient-to-r from-zinc-900/60 to-zinc-800/30 ring-1 ring-zinc-700/40'
            }`}>
              <div className="text-[10px] font-bold tracking-wider uppercase mb-1 text-zinc-400">
                🐊 Williams Alligator
              </div>
              <div className={`text-sm font-black ${
                r.fractals.alligator.state === 'eating-bull' ? 'text-emerald-400'
                : r.fractals.alligator.state === 'eating-bear' ? 'text-rose-400'
                : r.fractals.alligator.state === 'awakening' ? 'text-amber-400'
                : r.fractals.alligator.state === 'sated' ? 'text-violet-400'
                : 'text-zinc-500'
              }`}>
                {r.fractals.alligator.state === 'eating-bull' ? '🐊🟢 EATING BULLISH'
                : r.fractals.alligator.state === 'eating-bear' ? '🐊🔴 EATING BEARISH'
                : r.fractals.alligator.state === 'awakening' ? '👁 AWAKENING'
                : r.fractals.alligator.state === 'sated' ? '😴 SATED'
                : '💤 SLEEPING'}
              </div>
              <div className="text-[8px] text-zinc-500 mt-1">{r.fractals.alligator.description}</div>
              {/* Alligator lines */}
              <div className="flex justify-center gap-4 mt-2 text-[8px]">
                <span className="text-blue-400">Jaw: <span className="font-mono">{formatPrice(r.fractals.alligator.jaw)}</span></span>
                <span className="text-rose-400">Teeth: <span className="font-mono">{formatPrice(r.fractals.alligator.teeth)}</span></span>
                <span className="text-emerald-400">Lips: <span className="font-mono">{formatPrice(r.fractals.alligator.lips)}</span></span>
              </div>
              <div className="text-[7px] text-zinc-600 mt-1">Mouth width: {r.fractals.alligator.mouthWidth.toFixed(2)} ATR</div>
            </div>

            {/* ▓▓ FRACTAL DIMENSION ▓▓ */}
            <div className={`rounded-xl p-2.5 ${
              r.fractals.dimension.regime === 'trending'
                ? 'bg-gradient-to-r from-emerald-900/20 to-emerald-800/10 ring-1 ring-emerald-800/25'
                : r.fractals.dimension.regime === 'mean-reverting'
                ? 'bg-gradient-to-r from-blue-900/20 to-blue-800/10 ring-1 ring-blue-800/25'
                : 'bg-zinc-900/30 ring-1 ring-zinc-700/20'
            }`}>
              <div className="text-[8px] uppercase font-bold tracking-wider text-zinc-500 mb-2">
                🧮 Fractal Dimension & Hurst Exponent
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div className="text-center">
                  <div className="text-[7px] text-zinc-500">Dimension</div>
                  <div className="font-mono text-sm font-bold dark-mode-text">{r.fractals.dimension.value.toFixed(3)}</div>
                </div>
                <div className="text-center">
                  <div className="text-[7px] text-zinc-500">Hurst (H)</div>
                  <div className={`font-mono text-sm font-bold ${
                    r.fractals.dimension.hurstExponent > 0.6 ? 'text-emerald-400'
                    : r.fractals.dimension.hurstExponent < 0.4 ? 'text-blue-400'
                    : 'text-zinc-400'
                  }`}>{r.fractals.dimension.hurstExponent.toFixed(3)}</div>
                </div>
                <div className="text-center">
                  <div className="text-[7px] text-zinc-500">Regime</div>
                  <div className={`text-[10px] font-bold ${
                    r.fractals.dimension.regime === 'trending' ? 'text-emerald-400'
                    : r.fractals.dimension.regime === 'mean-reverting' ? 'text-blue-400'
                    : 'text-zinc-400'
                  }`}>
                    {r.fractals.dimension.regime === 'trending' ? '📈 Trend'
                    : r.fractals.dimension.regime === 'mean-reverting' ? '↔️ Revert'
                    : '🎲 Random'}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-[7px] text-zinc-500">Advice</div>
                  <div className={`text-[9px] font-bold ${
                    r.fractals.dimension.tradingAdvice === 'trend-follow' ? 'text-emerald-400'
                    : r.fractals.dimension.tradingAdvice === 'mean-revert' ? 'text-blue-400'
                    : 'text-rose-400'
                  }`}>
                    {r.fractals.dimension.tradingAdvice === 'trend-follow' ? '🏄 Trend Follow'
                    : r.fractals.dimension.tradingAdvice === 'mean-revert' ? '↩️ Mean Revert'
                    : '🚫 Stay Out'}
                  </div>
                </div>
              </div>
              {/* H exponent visual scale */}
              <div className="mt-2 relative h-3 bg-zinc-800/60 rounded-full overflow-hidden">
                <div className="absolute inset-0 flex">
                  <div className="flex-1 bg-blue-500/20" title="Mean-reverting" />
                  <div className="flex-1 bg-zinc-500/20" title="Random" />
                  <div className="flex-1 bg-emerald-500/20" title="Trending" />
                </div>
                <div
                  className="absolute top-0 h-full w-1 bg-yellow-400 rounded-full"
                  style={{ left: `${r.fractals.dimension.hurstExponent * 100}%` }}
                  title={`H = ${r.fractals.dimension.hurstExponent.toFixed(3)}`}
                />
              </div>
              <div className="flex justify-between text-[6px] text-zinc-600 mt-0.5 px-1">
                <span>H=0 Revert</span>
                <span>H=0.5 Random</span>
                <span>H=1.0 Trend</span>
              </div>
            </div>

            {/* ▓▓ FRACTAL BANDS ▓▓ */}
            <div className="rounded-xl bg-zinc-900/30 p-2.5">
              <div className="text-[8px] uppercase font-bold tracking-wider text-zinc-500 mb-2">
                📊 Fractal Bands
              </div>
              <div className="grid grid-cols-4 gap-2 mb-2">
                <div className="text-center">
                  <div className="text-[7px] text-zinc-500">Upper</div>
                  <div className="font-mono text-[9px] text-rose-400">{formatPrice(r.fractals.bands.currentUpper)}</div>
                </div>
                <div className="text-center">
                  <div className="text-[7px] text-zinc-500">Mid</div>
                  <div className="font-mono text-[9px] dark-mode-text">{formatPrice(r.fractals.bands.currentMid)}</div>
                </div>
                <div className="text-center">
                  <div className="text-[7px] text-zinc-500">Lower</div>
                  <div className="font-mono text-[9px] text-emerald-400">{formatPrice(r.fractals.bands.currentLower)}</div>
                </div>
                <div className="text-center">
                  <div className="text-[7px] text-zinc-500">Width</div>
                  <div className="font-mono text-[9px] dark-mode-text">{r.fractals.bands.bandwidthPct.toFixed(2)}%</div>
                </div>
              </div>
              {/* Price position in band */}
              <div className="h-3 bg-gradient-to-r from-emerald-900/40 via-zinc-800/40 to-rose-900/40 rounded-full overflow-hidden relative">
                <div
                  className="absolute top-0 h-full w-2 bg-yellow-400 rounded-full shadow-lg shadow-yellow-400/30"
                  style={{ left: `calc(${r.fractals.bands.pricePosition}% - 4px)` }}
                />
              </div>
              <div className="flex justify-between text-[6px] text-zinc-600 mt-0.5 px-1">
                <span>Lower Band (Buy)</span>
                <span className="font-bold text-yellow-400">{r.fractals.bands.pricePosition.toFixed(0)}%</span>
                <span>Upper Band (Sell)</span>
              </div>
            </div>

            {/* ▓▓ FRACTAL LEVELS (S/R) ▓▓ */}
            {r.fractals.levels.length > 0 && (
              <div className="rounded-xl bg-zinc-900/30 p-2.5">
                <div className="text-[8px] uppercase font-bold tracking-wider text-zinc-500 mb-2">
                  📍 Fractal S/R Levels ({r.fractals.levels.length})
                </div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {r.fractals.levels.slice(0, 10).map((level, i) => (
                    <div key={i} className="flex items-center gap-2 text-[9px]">
                      <span className={`w-2 h-2 rounded-full ${level.type === 'support' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                      <span className={`font-bold w-8 ${level.type === 'support' ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {level.type === 'support' ? 'SUP' : 'RES'}
                      </span>
                      <span className="font-mono dark-mode-text w-16">{formatPrice(level.price)}</span>
                      <span className="text-zinc-500">{level.touchCount} frac{level.touchCount > 1 ? 's' : ''}</span>
                      {level.isCluster && (
                        <span className="text-[7px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold">CLUSTER</span>
                      )}
                      <div className="flex-1 h-1.5 bg-zinc-800/60 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${level.type === 'support' ? 'bg-emerald-500' : 'bg-rose-500'}`}
                          style={{ width: `${level.strength}%` }}
                        />
                      </div>
                      <span className="text-[7px] text-zinc-500 w-6 text-right">{level.strength.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ▓▓ BREAKOUT SIGNALS ▓▓ */}
            {r.fractals.breakouts.length > 0 && (
              <div className="rounded-xl bg-zinc-900/30 p-2.5">
                <div className="text-[8px] uppercase font-bold tracking-wider text-zinc-500 mb-2">
                  💥 Fractal Breakouts ({r.fractals.breakouts.length})
                </div>
                <div className="space-y-1.5">
                  {r.fractals.breakouts.slice(0, 5).map((bo, i) => (
                    <div key={i} className={`rounded-lg p-2 ${
                      bo.direction === 'bullish' ? 'bg-emerald-900/15 ring-1 ring-emerald-800/25'
                      : 'bg-rose-900/15 ring-1 ring-rose-800/25'
                    }`}>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px]">{bo.direction === 'bullish' ? '🟢⬆️' : '🔴⬇️'}</span>
                        <span className={`text-[10px] font-bold ${
                          bo.direction === 'bullish' ? 'text-emerald-400' : 'text-rose-400'
                        }`}>
                          {bo.direction.toUpperCase()} BREAKOUT
                        </span>
                        <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-zinc-800/50 text-zinc-300 font-bold">
                          {bo.breakStrength.toFixed(0)}%
                        </span>
                      </div>
                      <div className="text-[8px] text-zinc-500 mt-0.5">{bo.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ▓▓ SELF-SIMILARITY ▓▓ */}
            <div className="rounded-xl bg-zinc-900/30 p-2.5">
              <div className="text-[8px] uppercase font-bold tracking-wider text-zinc-500 mb-2">
                🔄 Self-Similarity Across Timeframes
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-sm ${
                  r.fractals.selfSimilarity.alignment === 'aligned' ? '✅' : '⚠️'
                }`}>
                  {r.fractals.selfSimilarity.alignment === 'aligned' ? '✅' : '⚠️'}
                </span>
                <div className="flex-1">
                  <div className="text-[9px] dark-mode-text">{r.fractals.selfSimilarity.patternMatch}</div>
                </div>
                <span className={`text-[8px] px-2 py-0.5 rounded-full font-bold ${
                  r.fractals.selfSimilarity.score >= 75 ? 'bg-emerald-500/20 text-emerald-400'
                  : r.fractals.selfSimilarity.score >= 50 ? 'bg-yellow-500/20 text-yellow-400'
                  : 'bg-zinc-700/30 text-zinc-500'
                }`}>
                  {r.fractals.selfSimilarity.score}%
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {r.fractals.selfSimilarity.timeframes.map((tf, i) => (
                  <div key={i} className="rounded-lg bg-zinc-800/30 p-1.5 text-center">
                    <div className="text-[7px] text-zinc-500">{tf.tf}</div>
                    <div className={`text-[9px] font-bold ${
                      tf.fractalBias === 'bullish' ? 'text-emerald-400'
                      : tf.fractalBias === 'bearish' ? 'text-rose-400'
                      : 'text-zinc-400'
                    }`}>
                      {tf.trend === 'up' ? '↗' : tf.trend === 'down' ? '↘' : '→'} {tf.fractalBias}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ▓▓ ACTIVE FRACTALS ▓▓ */}
            <div className="rounded-xl bg-zinc-900/30 p-2.5">
              <div className="text-[8px] uppercase font-bold tracking-wider text-zinc-500 mb-1">
                🔺🔻 Active Fractals ({r.fractals.activeFractals.length} of {r.fractals.fractals.length})
              </div>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                {r.fractals.activeFractals.slice(0, 20).map((f, i) => (
                  <span key={i} className={`inline-flex items-center gap-0.5 text-[7px] px-1.5 py-0.5 rounded ${
                    f.type === 'high'
                      ? 'bg-rose-900/20 text-rose-400 ring-1 ring-rose-800/20'
                      : 'bg-emerald-900/20 text-emerald-400 ring-1 ring-emerald-800/20'
                  }`}>
                    {f.type === 'high' ? '🔻' : '🔺'}
                    <span className="font-mono">{formatPrice(f.price)}</span>
                    <span className="text-zinc-500">o{f.order}</span>
                  </span>
                ))}
              </div>
            </div>

            <ScoreBar value={r.fractals.score} label="Fractal Score" />
          </div>
        )}

        {/* Fractals tab no data */}
        {activeTab === 'fractals' && !r && (
          <div className="text-center py-6">
            <div className="text-2xl mb-2">📐</div>
            <div className="text-sm text-zinc-500">
              {candles.length < 20 ? `Loading... (${candles.length}/20 candles)` : 'Analyzing fractals...'}
            </div>
          </div>
        )}

        {/* ── FLOOR/CEILING LEVELS TAB ── */}
        {activeTab === 'levels' && r && (
          <div className="space-y-3">
            {/* ▓▓ LEVEL ENTRY SIGNALS — ACTIVE ALERTS ▓▓ */}
            {(() => {
              const ls = r.floorCeiling.levelSignals;
              return (
                <div className="rounded-xl bg-zinc-950/60 ring-1 ring-zinc-700/30 p-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                      ⚡ Level Entry Signals
                      {ls.activeCount > 0 && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-amber-900/40 text-amber-300 text-[9px] font-mono">
                          {ls.activeCount}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => setAlertsEnabled(!alertsEnabled)}
                      className={`text-[8px] px-2 py-0.5 rounded-full font-bold transition-colors ${
                        alertsEnabled
                          ? 'bg-emerald-900/40 text-emerald-300 ring-1 ring-emerald-700/40'
                          : 'bg-zinc-800 text-zinc-500 ring-1 ring-zinc-700/30'
                      }`}
                    >
                      {alertsEnabled ? '🔔 Alerts ON' : '🔕 Alerts OFF'}
                    </button>
                  </div>

                  {/* Best signal card */}
                  {ls.bestSignal && (() => {
                    const sig = ls.bestSignal!;
                    return (
                      <div className={`rounded-xl p-3 mb-2 ring-1 ${
                        sig.direction === 'LONG'
                          ? 'bg-gradient-to-r from-emerald-950/60 to-cyan-950/40 ring-emerald-500/40'
                          : 'bg-gradient-to-r from-rose-950/60 to-orange-950/40 ring-rose-500/40'
                      }`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className={`text-lg ${sig.direction === 'LONG' ? '' : ''}`}>
                              {sig.type === 'BOUNCE_LONG' ? '🟢⬆' : sig.type === 'BOUNCE_SHORT' ? '🔴⬇' : sig.type === 'BREAKOUT_LONG' ? '🚀⬆' : '💥⬇'}
                            </span>
                            <div>
                              <div className={`text-[12px] font-black ${sig.direction === 'LONG' ? 'text-emerald-300' : 'text-rose-300'}`}>
                                {sig.type.replace('_', ' ')}
                              </div>
                              <div className="text-[8px] text-zinc-500">
                                {sig.tf} · {sig.confirmationPattern}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className={`text-[14px] font-black ${
                              sig.grade === 'A+' ? 'text-amber-300' : sig.grade === 'A' ? 'text-emerald-300' : sig.grade === 'B' ? 'text-cyan-300' : 'text-zinc-400'
                            }`}>
                              {sig.grade}
                            </div>
                            <div className="text-[8px] text-zinc-500">{sig.confidence.toFixed(0)}% conf</div>
                          </div>
                        </div>

                        {/* Entry / SL / TP grid */}
                        <div className="grid grid-cols-4 gap-1.5 mb-1.5">
                          <div className="rounded-lg bg-zinc-900/60 px-2 py-1 text-center">
                            <div className="text-[7px] uppercase text-zinc-500 font-bold">Entry</div>
                            <div className="text-[10px] font-mono font-bold text-white">{formatPrice(sig.entry)}</div>
                          </div>
                          <div className="rounded-lg bg-rose-950/40 px-2 py-1 text-center">
                            <div className="text-[7px] uppercase text-rose-500 font-bold">Stop</div>
                            <div className="text-[10px] font-mono font-bold text-rose-300">{formatPrice(sig.stopLoss)}</div>
                          </div>
                          <div className="rounded-lg bg-emerald-950/40 px-2 py-1 text-center">
                            <div className="text-[7px] uppercase text-emerald-500 font-bold">TP1</div>
                            <div className="text-[10px] font-mono font-bold text-emerald-300">{formatPrice(sig.takeProfit)}</div>
                          </div>
                          <div className="rounded-lg bg-cyan-950/40 px-2 py-1 text-center">
                            <div className="text-[7px] uppercase text-cyan-500 font-bold">TP2</div>
                            <div className="text-[10px] font-mono font-bold text-cyan-300">
                              {sig.takeProfit2 ? formatPrice(sig.takeProfit2) : '—'}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[8px]">
                          <span className="text-zinc-500">
                            R:R <span className="text-white font-bold">{sig.riskReward.toFixed(1)}:1</span>
                          </span>
                          <span className="text-zinc-500">
                            Level: <span className="text-white font-mono">{formatPrice(sig.level.price)}</span> ({sig.level.type})
                          </span>
                          <span className={`px-1 py-0.5 rounded font-bold ${
                            sig.direction === 'LONG' ? 'bg-emerald-900/40 text-emerald-300' : 'bg-rose-900/40 text-rose-300'
                          }`}>
                            {sig.direction}
                          </span>
                        </div>

                        {/* Reasons */}
                        <div className="mt-1.5 space-y-0.5">
                          {sig.reasons.map((r, i) => (
                            <div key={i} className="text-[8px] text-zinc-400 flex items-start gap-1">
                              <span className="text-zinc-600 mt-px">•</span> {r}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Other active signals */}
                  {ls.signals.length > 1 && (
                    <div className="space-y-1">
                      <div className="text-[7px] uppercase text-zinc-500 font-bold tracking-wider">
                        Other Active Signals
                      </div>
                      {ls.signals.slice(1, 5).map((sig, i) => (
                        <div key={i} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-[9px] ${
                          sig.direction === 'LONG' ? 'bg-emerald-950/20 ring-1 ring-emerald-900/20' : 'bg-rose-950/20 ring-1 ring-rose-900/20'
                        }`}>
                          <span className="text-[10px]">
                            {sig.type === 'BOUNCE_LONG' ? '🟢' : sig.type === 'BOUNCE_SHORT' ? '🔴' : sig.type === 'BREAKOUT_LONG' ? '🚀' : '💥'}
                          </span>
                          <span className={`font-bold ${sig.direction === 'LONG' ? 'text-emerald-300' : 'text-rose-300'}`}>
                            {sig.type.replace('_', ' ')}
                          </span>
                          <span className="text-[7px] text-zinc-600">{sig.tf}</span>
                          <span className="font-mono text-zinc-300">{formatPrice(sig.entry)}</span>
                          <span className={`ml-auto text-[8px] font-black ${
                            sig.grade === 'A+' ? 'text-amber-300' : sig.grade === 'A' ? 'text-emerald-300' : sig.grade === 'B' ? 'text-cyan-300' : 'text-zinc-400'
                          }`}>{sig.grade}</span>
                          <span className="text-[7px] text-zinc-500">R:R {sig.riskReward.toFixed(1)}</span>
                          <span className="text-[7px] text-zinc-600">{sig.confirmationPattern}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {ls.activeCount === 0 && (
                    <div className="text-center py-3">
                      <div className="text-[10px] text-zinc-500">No active signals</div>
                      <div className="text-[8px] text-zinc-600 mt-0.5">
                        Waiting for price to reach a level + confirmation candle...
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ▓▓ ALERT HISTORY ▓▓ */}
            {levelAlerts.length > 0 && (
              <details className="rounded-xl bg-zinc-900/30 ring-1 ring-zinc-800/30 p-2">
                <summary className="text-[8px] uppercase font-bold tracking-wider text-zinc-500 cursor-pointer select-none">
                  📋 Alert History ({levelAlerts.length})
                </summary>
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                  {levelAlerts.slice(0, 15).map((sig, i) => {
                    const age = Math.floor((Date.now() - sig.timestamp) / 60000);
                    const ageLabel = age < 1 ? 'just now' : age < 60 ? `${age}m ago` : `${Math.floor(age / 60)}h ago`;
                    return (
                      <div key={i} className={`flex items-center gap-2 px-2 py-1 rounded text-[8px] ${
                        sig.direction === 'LONG' ? 'bg-emerald-950/10' : 'bg-rose-950/10'
                      }`}>
                        <span className={`font-bold ${sig.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {sig.direction}
                        </span>
                        <span className="text-zinc-400">{sig.type.replace('_', ' ')}</span>
                        <span className="font-mono text-zinc-300">{formatPrice(sig.entry)}</span>
                        <span className={`font-black ${
                          sig.grade === 'A+' ? 'text-amber-300' : sig.grade === 'A' ? 'text-emerald-300' : 'text-cyan-300'
                        }`}>{sig.grade}</span>
                        <span className="text-zinc-600 ml-auto">{ageLabel}</span>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}

            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-2">🏠 Multi-Timeframe Floors &amp; Ceilings</div>

            {/* ▓▓ GLOBAL SUMMARY BAR ▓▓ */}
            <div className={`rounded-xl p-3 text-center ${
              r.floorCeiling.bias === 'near-floor-bounce'
                ? 'bg-gradient-to-r from-emerald-950/60 to-emerald-900/30 ring-1 ring-emerald-500/40'
                : r.floorCeiling.bias === 'near-ceiling-reject'
                ? 'bg-gradient-to-r from-rose-950/60 to-rose-900/30 ring-1 ring-rose-500/40'
                : r.floorCeiling.bias === 'breakout-up'
                ? 'bg-gradient-to-r from-cyan-950/60 to-cyan-900/30 ring-1 ring-cyan-500/40'
                : r.floorCeiling.bias === 'breakdown'
                ? 'bg-gradient-to-r from-orange-950/60 to-orange-900/30 ring-1 ring-orange-500/40'
                : 'bg-gradient-to-r from-zinc-900/60 to-zinc-800/30 ring-1 ring-zinc-600/40'
            }`}>
              <div className="text-[9px] uppercase tracking-wider text-zinc-400 mb-1">Price Position in Range</div>
              <div className="flex items-center gap-2 justify-center">
                <span className="text-[10px] text-emerald-400 font-mono">
                  {r.floorCeiling.globalFloor ? formatPrice(r.floorCeiling.globalFloor) : '—'}
                </span>
                <div className="flex-1 max-w-40 h-3 bg-zinc-800/60 rounded-full overflow-hidden relative">
                  <div className="absolute inset-0 bg-gradient-to-r from-emerald-600/30 via-zinc-600/20 to-rose-600/30 rounded-full" />
                  <div
                    className="absolute top-0 h-full w-1.5 bg-white rounded-full shadow-sm shadow-white/50 transition-all"
                    style={{ left: `calc(${Math.max(2, Math.min(98, r.floorCeiling.priceInRange))}% - 3px)` }}
                  />
                </div>
                <span className="text-[10px] text-rose-400 font-mono">
                  {r.floorCeiling.globalCeiling ? formatPrice(r.floorCeiling.globalCeiling) : '—'}
                </span>
              </div>
              <div className="mt-1 text-[11px] font-bold">
                {r.floorCeiling.bias === 'near-floor-bounce' && <span className="text-emerald-400">📈 Near Floor — Bounce Zone</span>}
                {r.floorCeiling.bias === 'near-ceiling-reject' && <span className="text-rose-400">📉 Near Ceiling — Rejection Zone</span>}
                {r.floorCeiling.bias === 'breakout-up' && <span className="text-cyan-400">🚀 Above Ceiling — Breakout</span>}
                {r.floorCeiling.bias === 'breakdown' && <span className="text-orange-400">💥 Below Floor — Breakdown</span>}
                {r.floorCeiling.bias === 'mid-range' && <span className="text-zinc-300">↔️ Mid-Range — No Edge</span>}
              </div>
              <div className="text-[9px] text-zinc-500 mt-0.5">
                Price at {r.floorCeiling.priceInRange.toFixed(0)}% of range • {formatPrice(r.floorCeiling.currentPrice)}
              </div>
            </div>

            {/* ▓▓ BREAK PREDICTION PANEL ▓▓ */}
            {r.floorCeiling.breakPredictions.predictions.length > 0 && (() => {
              const bp = r.floorCeiling.breakPredictions;
              return (
                <div className={`rounded-xl p-2.5 ${
                  bp.overallBias === 'breaking-up'
                    ? 'bg-gradient-to-r from-cyan-950/40 to-emerald-950/30 ring-1 ring-cyan-500/30'
                    : bp.overallBias === 'breaking-down'
                    ? 'bg-gradient-to-r from-orange-950/40 to-rose-950/30 ring-1 ring-orange-500/30'
                    : bp.overallBias === 'range-bound'
                    ? 'bg-gradient-to-r from-zinc-900/60 to-zinc-800/30 ring-1 ring-zinc-600/30'
                    : 'bg-gradient-to-r from-purple-950/30 to-zinc-900/30 ring-1 ring-purple-600/30'
                }`}>
                  <div className="text-[8px] uppercase font-bold tracking-wider text-amber-400 mb-2">
                    🔮 Break Prediction Engine
                  </div>

                  {/* Overall bias banner */}
                  <div className={`text-center mb-2 py-1.5 rounded-lg ${
                    bp.overallBias === 'breaking-up'
                      ? 'bg-cyan-900/30 text-cyan-300'
                      : bp.overallBias === 'breaking-down'
                      ? 'bg-orange-900/30 text-orange-300'
                      : bp.overallBias === 'range-bound'
                      ? 'bg-zinc-800/40 text-zinc-300'
                      : 'bg-purple-900/20 text-purple-300'
                  }`}>
                    <div className="text-[11px] font-bold">
                      {bp.overallBias === 'breaking-up' && '🚀 CEILING BREAK LIKELY'}
                      {bp.overallBias === 'breaking-down' && '💥 FLOOR BREAK LIKELY'}
                      {bp.overallBias === 'range-bound' && '🔒 RANGE BOUND — Levels Holding'}
                      {bp.overallBias === 'indeterminate' && '🔄 MIXED SIGNALS'}
                    </div>
                    <div className="text-[8px] opacity-70 mt-0.5">{bp.biasSummary}</div>
                  </div>

                  {/* Nearest floor + ceiling predictions side by side */}
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    {/* Nearest Ceiling Prediction */}
                    {bp.nearestCeilingPrediction && (() => {
                      const p = bp.nearestCeilingPrediction;
                      return (
                        <div className="rounded-lg bg-rose-950/20 ring-1 ring-rose-800/20 p-2">
                          <div className="text-[7px] uppercase tracking-wider text-rose-500/80 font-bold mb-1">
                            Nearest Ceiling
                          </div>
                          <div className="text-[10px] font-mono font-bold text-rose-300">
                            {formatPrice(p.level.price)}
                            <span className="text-[7px] text-zinc-500 ml-1">{p.tf}</span>
                          </div>
                          <div className="flex items-center gap-1 mt-1">
                            <div className="flex-1 h-2 bg-zinc-800/60 rounded-full overflow-hidden relative">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  p.breakProbability >= 60 ? 'bg-gradient-to-r from-rose-600 to-rose-400'
                                  : p.breakProbability >= 40 ? 'bg-gradient-to-r from-amber-700 to-amber-500'
                                  : 'bg-gradient-to-r from-emerald-700 to-emerald-500'
                                }`}
                                style={{ width: `${p.breakProbability}%` }}
                              />
                            </div>
                            <span className={`text-[9px] font-bold font-mono ${
                              p.breakProbability >= 60 ? 'text-rose-400'
                              : p.breakProbability >= 40 ? 'text-amber-400'
                              : 'text-emerald-400'
                            }`}>{p.breakProbability.toFixed(0)}%</span>
                          </div>
                          <div className={`text-[8px] mt-1 font-bold text-center py-0.5 rounded ${
                            p.verdict === 'LIKELY BREAK' ? 'bg-rose-900/40 text-rose-300'
                            : p.verdict === 'LIKELY HOLD' ? 'bg-emerald-900/40 text-emerald-300'
                            : 'bg-zinc-800/40 text-zinc-400'
                          }`}>
                            {p.verdict === 'LIKELY BREAK' ? '⚠️' : p.verdict === 'LIKELY HOLD' ? '🛡️' : '❓'} {p.verdict}
                          </div>
                          <div className="text-[7px] text-zinc-500 text-center mt-0.5">
                            {p.eta} • conf {p.confidence.toFixed(0)}%
                          </div>
                        </div>
                      );
                    })()}

                    {/* Nearest Floor Prediction */}
                    {bp.nearestFloorPrediction && (() => {
                      const p = bp.nearestFloorPrediction;
                      return (
                        <div className="rounded-lg bg-emerald-950/20 ring-1 ring-emerald-800/20 p-2">
                          <div className="text-[7px] uppercase tracking-wider text-emerald-500/80 font-bold mb-1">
                            Nearest Floor
                          </div>
                          <div className="text-[10px] font-mono font-bold text-emerald-300">
                            {formatPrice(p.level.price)}
                            <span className="text-[7px] text-zinc-500 ml-1">{p.tf}</span>
                          </div>
                          <div className="flex items-center gap-1 mt-1">
                            <div className="flex-1 h-2 bg-zinc-800/60 rounded-full overflow-hidden relative">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  p.breakProbability >= 60 ? 'bg-gradient-to-r from-rose-600 to-rose-400'
                                  : p.breakProbability >= 40 ? 'bg-gradient-to-r from-amber-700 to-amber-500'
                                  : 'bg-gradient-to-r from-emerald-700 to-emerald-500'
                                }`}
                                style={{ width: `${p.breakProbability}%` }}
                              />
                            </div>
                            <span className={`text-[9px] font-bold font-mono ${
                              p.breakProbability >= 60 ? 'text-rose-400'
                              : p.breakProbability >= 40 ? 'text-amber-400'
                              : 'text-emerald-400'
                            }`}>{p.breakProbability.toFixed(0)}%</span>
                          </div>
                          <div className={`text-[8px] mt-1 font-bold text-center py-0.5 rounded ${
                            p.verdict === 'LIKELY BREAK' ? 'bg-rose-900/40 text-rose-300'
                            : p.verdict === 'LIKELY HOLD' ? 'bg-emerald-900/40 text-emerald-300'
                            : 'bg-zinc-800/40 text-zinc-400'
                          }`}>
                            {p.verdict === 'LIKELY BREAK' ? '⚠️' : p.verdict === 'LIKELY HOLD' ? '🛡️' : '❓'} {p.verdict}
                          </div>
                          <div className="text-[7px] text-zinc-500 text-center mt-0.5">
                            {p.eta} • conf {p.confidence.toFixed(0)}%
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* All predictions list (top 6) */}
                  <div className="text-[7px] uppercase font-bold tracking-wider text-zinc-500 mb-1">
                    All Predictions ({bp.predictions.length} levels)
                  </div>
                  <div className="space-y-0.5 max-h-48 overflow-y-auto">
                    {bp.predictions.slice(0, 8).map((p, i) => (
                      <div key={i} className={`flex items-center gap-1.5 text-[9px] px-1.5 py-1 rounded-lg ${
                        p.verdict === 'LIKELY BREAK' ? 'bg-rose-950/20' :
                        p.verdict === 'LIKELY HOLD' ? 'bg-emerald-950/10' : 'bg-zinc-900/20'
                      }`}>
                        <span className={`text-[8px] font-mono px-1 py-0.5 rounded ${
                          p.level.type === 'floor' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-rose-900/30 text-rose-400'
                        }`}>{p.level.type === 'floor' ? '▼ FLR' : '▲ CLG'}</span>
                        <span className="font-mono font-bold text-zinc-200 w-20">{formatPrice(p.level.price)}</span>
                        <span className="text-[7px] text-zinc-600 w-8">{p.tf}</span>
                        <div className="flex-1 h-1.5 bg-zinc-800/40 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              p.breakProbability >= 60 ? 'bg-rose-500/70'
                              : p.breakProbability >= 40 ? 'bg-amber-500/60'
                              : 'bg-emerald-500/60'
                            }`}
                            style={{ width: `${p.breakProbability}%` }}
                          />
                        </div>
                        <span className={`text-[8px] font-mono font-bold w-8 text-right ${
                          p.breakProbability >= 60 ? 'text-rose-400'
                          : p.breakProbability >= 40 ? 'text-amber-400'
                          : 'text-emerald-400'
                        }`}>{p.breakProbability.toFixed(0)}%</span>
                        <span className={`text-[7px] px-1 py-0.5 rounded font-bold ${
                          p.verdict === 'LIKELY BREAK' ? 'bg-rose-900/40 text-rose-300'
                          : p.verdict === 'LIKELY HOLD' ? 'bg-emerald-900/40 text-emerald-300'
                          : 'bg-zinc-800/40 text-zinc-500'
                        }`}>
                          {p.verdict === 'LIKELY BREAK' ? 'BRK' : p.verdict === 'LIKELY HOLD' ? 'HLD' : '???'}
                        </span>
                        <span className="text-[7px] text-zinc-600 w-14 text-right">{p.eta}</span>
                      </div>
                    ))}
                  </div>

                  {/* Factor breakdown for most-likely-to-break level */}
                  {bp.mostLikelyBreak && bp.mostLikelyBreak.breakProbability >= 55 && (
                    <div className="mt-2 rounded-lg bg-zinc-900/40 ring-1 ring-zinc-800/30 p-2">
                      <div className="text-[7px] uppercase font-bold tracking-wider text-amber-500 mb-1">
                        📊 Top Break Risk: {formatPrice(bp.mostLikelyBreak.level.price)} ({bp.mostLikelyBreak.level.type === 'floor' ? 'Floor' : 'Ceiling'}, {bp.mostLikelyBreak.tf})
                      </div>
                      <div className="space-y-0.5">
                        {bp.mostLikelyBreak.factors
                          .sort((a, b) => Math.abs(b.value * b.weight) - Math.abs(a.value * a.weight))
                          .slice(0, 5)
                          .map((f, i) => (
                          <div key={i} className="flex items-center gap-1 text-[8px]">
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              f.value > 0.3 ? 'bg-rose-400' : f.value < -0.3 ? 'bg-emerald-400' : 'bg-zinc-500'
                            }`} />
                            <span className="text-zinc-400 w-16">{f.name}</span>
                            <div className="flex-1 h-1 bg-zinc-800/40 rounded-full overflow-hidden relative">
                              {/* Center line */}
                              <div className="absolute left-1/2 top-0 w-px h-full bg-zinc-600" />
                              {f.value >= 0 ? (
                                <div
                                  className="absolute top-0 h-full bg-rose-500/60 rounded-r-full"
                                  style={{ left: '50%', width: `${Math.abs(f.value) * 50}%` }}
                                />
                              ) : (
                                <div
                                  className="absolute top-0 h-full bg-emerald-500/60 rounded-l-full"
                                  style={{ right: '50%', width: `${Math.abs(f.value) * 50}%` }}
                                />
                              )}
                            </div>
                            <span className="text-[7px] text-zinc-500 w-28 text-right truncate">{f.detail}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ▓▓ CONFLUENT LEVELS (appear on multiple TFs) ▓▓ */}
            {r.floorCeiling.confluenceLevels.length > 0 && (
              <div className="rounded-xl bg-violet-950/20 ring-1 ring-violet-500/20 p-2.5">
                <div className="text-[8px] uppercase font-bold tracking-wider text-violet-400 mb-1.5">
                  ⭐ Cross-Timeframe Confluent Levels ({r.floorCeiling.confluenceLevels.length})
                </div>
                <div className="space-y-1">
                  {r.floorCeiling.confluenceLevels.slice(0, 6).map((cl, i) => (
                    <div key={i} className={`flex items-center gap-2 px-2 py-1 rounded-lg ${
                      cl.type === 'floor'
                        ? 'bg-emerald-900/20 ring-1 ring-emerald-800/20'
                        : 'bg-rose-900/20 ring-1 ring-rose-800/20'
                    }`}>
                      <span className="text-[10px]">{cl.type === 'floor' ? '🟢' : '🔴'}</span>
                      <span className="text-[10px] font-mono font-bold dark-mode-text flex-1">
                        {formatPrice(cl.price)}
                      </span>
                      <div className="flex gap-0.5">
                        {cl.timeframes.map(tf => (
                          <span key={tf} className="text-[7px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">
                            {tf}
                          </span>
                        ))}
                      </div>
                      <div className="w-12 h-1.5 bg-zinc-800/60 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${cl.type === 'floor' ? 'bg-emerald-500' : 'bg-rose-500'}`}
                          style={{ width: `${cl.confluenceScore}%` }}
                        />
                      </div>
                      <span className="text-[8px] font-mono text-zinc-500">{cl.confluenceScore.toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ▓▓ PER-TIMEFRAME LEVELS ▓▓ */}
            {r.floorCeiling.timeframes.map((tfData) => (
              <div key={tfData.tf} className="rounded-xl bg-zinc-900/30 p-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-900/40 text-violet-300 ring-1 ring-violet-700/30 font-mono">
                    {tfData.tf}
                  </span>
                  <span className={`text-[8px] px-1.5 py-0.5 rounded font-semibold ${
                    tfData.currentPosition === 'near-floor'
                      ? 'bg-emerald-900/30 text-emerald-400'
                      : tfData.currentPosition === 'near-ceiling'
                      ? 'bg-rose-900/30 text-rose-400'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {tfData.currentPosition === 'near-floor' ? '↗ Near Floor' : tfData.currentPosition === 'near-ceiling' ? '↘ Near Ceiling' : '↔ Mid-Range'}
                  </span>
                  <span className={`text-[6px] px-1 py-0.5 rounded font-mono ${
                    tfData.dataSource === 'fetched' ? 'bg-cyan-900/30 text-cyan-400' : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    {tfData.dataSource === 'fetched' ? '🔗 LIVE' : '🔄 Resampled'} · {tfData.candleCount}c
                  </span>
                  <span className="text-[8px] text-zinc-600 ml-auto font-mono">
                    Range: {formatPrice(tfData.range.low)} — {formatPrice(tfData.range.high)}
                  </span>
                </div>

                {/* Ceilings (resistance) */}
                {tfData.ceilings.length > 0 && (
                  <div className="mb-1.5">
                    <div className="text-[7px] uppercase tracking-wider text-rose-500/80 font-bold mb-0.5">Ceilings ▲</div>
                    <div className="space-y-0.5">
                      {tfData.ceilings.slice(0, 4).map((level, i) => {
                        const pred = r.floorCeiling.breakPredictions.predictions.find(
                          p => p.tf === tfData.tf && Math.abs(p.level.price - level.price) / level.price < 0.001
                        );
                        return (
                        <div key={i} className="flex items-center gap-1.5 text-[9px]">
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            level.strength >= 70 ? 'bg-rose-400' : level.strength >= 40 ? 'bg-rose-500/60' : 'bg-rose-600/40'
                          }`} />
                          <span className="font-mono font-bold text-rose-300 w-20">{formatPrice(level.price)}</span>
                          <div className="flex-1 h-1 bg-zinc-800/40 rounded-full overflow-hidden">
                            <div className="h-full bg-rose-500/60 rounded-full" style={{ width: `${level.strength}%` }} />
                          </div>
                          <span className="text-[7px] text-zinc-500 w-6 text-right">{level.strength.toFixed(0)}</span>
                          <span className="text-[7px] text-zinc-600 w-10 text-right">
                            +{level.distancePct.toFixed(2)}%
                          </span>
                          {level.touches > 1 && (
                            <span className="text-[7px] text-zinc-500">×{level.touches}</span>
                          )}
                          {level.source === 'round-number' && (
                            <span className="text-[6px] px-0.5 rounded bg-amber-900/30 text-amber-400">RN</span>
                          )}
                          {level.broken && (
                            <span className="text-[6px] px-0.5 rounded bg-zinc-800 text-zinc-500">BRK</span>
                          )}
                          {pred && (
                            <span className={`text-[6px] px-1 py-0.5 rounded font-bold ${
                              pred.verdict === 'LIKELY BREAK' ? 'bg-rose-900/50 text-rose-300'
                              : pred.verdict === 'LIKELY HOLD' ? 'bg-emerald-900/50 text-emerald-300'
                              : 'bg-zinc-800 text-zinc-400'
                            }`} title={`Break: ${pred.breakProbability.toFixed(0)}% | ${pred.eta}`}>
                              🔮{pred.breakProbability.toFixed(0)}%
                            </span>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Mid divider with current price */}
                <div className="flex items-center gap-2 py-1 my-1 border-t border-b border-zinc-800/40">
                  <span className="text-[7px] text-zinc-500 uppercase">Current</span>
                  <span className="text-[10px] font-mono font-bold text-white">{formatPrice(currentPrice)}</span>
                  <div className="flex-1 border-t border-dashed border-zinc-700" />
                  <span className="text-[8px] font-mono text-zinc-500">Mid: {formatPrice(tfData.midPoint)}</span>
                </div>

                {/* Floors (support) */}
                {tfData.floors.length > 0 && (
                  <div>
                    <div className="text-[7px] uppercase tracking-wider text-emerald-500/80 font-bold mb-0.5">Floors ▼</div>
                    <div className="space-y-0.5">
                      {tfData.floors.slice(0, 4).map((level, i) => {
                        const pred = r.floorCeiling.breakPredictions.predictions.find(
                          p => p.tf === tfData.tf && Math.abs(p.level.price - level.price) / level.price < 0.001
                        );
                        return (
                        <div key={i} className="flex items-center gap-1.5 text-[9px]">
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            level.strength >= 70 ? 'bg-emerald-400' : level.strength >= 40 ? 'bg-emerald-500/60' : 'bg-emerald-600/40'
                          }`} />
                          <span className="font-mono font-bold text-emerald-300 w-20">{formatPrice(level.price)}</span>
                          <div className="flex-1 h-1 bg-zinc-800/40 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500/60 rounded-full" style={{ width: `${level.strength}%` }} />
                          </div>
                          <span className="text-[7px] text-zinc-500 w-6 text-right">{level.strength.toFixed(0)}</span>
                          <span className="text-[7px] text-zinc-600 w-10 text-right">
                            -{level.distancePct.toFixed(2)}%
                          </span>
                          {level.touches > 1 && (
                            <span className="text-[7px] text-zinc-500">×{level.touches}</span>
                          )}
                          {level.source === 'round-number' && (
                            <span className="text-[6px] px-0.5 rounded bg-amber-900/30 text-amber-400">RN</span>
                          )}
                          {level.broken && (
                            <span className="text-[6px] px-0.5 rounded bg-zinc-800 text-zinc-500">BRK</span>
                          )}
                          {pred && (
                            <span className={`text-[6px] px-1 py-0.5 rounded font-bold ${
                              pred.verdict === 'LIKELY BREAK' ? 'bg-rose-900/50 text-rose-300'
                              : pred.verdict === 'LIKELY HOLD' ? 'bg-emerald-900/50 text-emerald-300'
                              : 'bg-zinc-800 text-zinc-400'
                            }`} title={`Break: ${pred.breakProbability.toFixed(0)}% | ${pred.eta}`}>
                              🔮{pred.breakProbability.toFixed(0)}%
                            </span>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {tfData.floors.length === 0 && tfData.ceilings.length === 0 && (
                  <div className="text-[9px] text-zinc-600 text-center py-2">
                    Not enough data for {tfData.tf} levels
                  </div>
                )}
              </div>
            ))}

            {r.floorCeiling.timeframes.length === 0 && (
              <div className="text-center py-4 text-[10px] text-zinc-500">
                Insufficient candle data for floor/ceiling analysis
              </div>
            )}
          </div>
        )}

        {/* Levels tab no data */}
        {activeTab === 'levels' && !r && (
          <div className="text-center py-6">
            <div className="text-2xl mb-2">🏠</div>
            <div className="text-sm text-zinc-500">
              {candles.length < 50 ? `Loading... (${candles.length}/50 candles)` : 'Analyzing floors & ceilings...'}
            </div>
          </div>
        )}

        {/* AMD tab no data */}
        {activeTab === 'amd' && !r && (
          <div className="text-center py-6">
            <div className="text-2xl mb-2">⏱</div>
            <div className="text-sm text-zinc-500">
              {candles.length < 96 ? `Need 96+ candles for AMD (${candles.length} loaded)` : 'Analyzing AMD phases...'}
            </div>
            <div className="text-[9px] text-zinc-600 mt-1">4H Roadmap requires ~8 hours of 5min data</div>
          </div>
        )}

        {/* Shadows tab no data */}
        {activeTab === 'shadows' && !r && (
          <div className="text-center py-6">
            <div className="text-2xl mb-2">🕯</div>
            <div className="text-sm text-zinc-500">
              {candles.length < 50 ? `Loading... (${candles.length}/50 candles)` : 'Analyzing shadows...'}
            </div>
          </div>
        )}

        {/* No data state for non-signal tabs */}
        {activeTab !== 'signal' && activeTab !== 'prop' && activeTab !== 'shadows' && !r && (
          <div className="text-center py-6">
            <div className="text-2xl mb-2">📊</div>
            <div className="text-sm text-zinc-400 dark:text-zinc-500">
              {candles.length < 50 ? `Loading... (${candles.length}/50 candles)` : 'Analyzing...'}
            </div>
          </div>
        )}
      </div>

      {/* ══ Footer ══ */}
      <div className="px-3 sm:px-4 py-2 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20 flex flex-wrap items-center gap-3 text-[10px] text-zinc-400 dark:text-zinc-500">
        <span>💰 <strong className="dark-mode-text">${config.capital}</strong></span>
        <span>⚡ <strong className="dark-mode-text">{config.leverage}x</strong></span>
        <span>🎯 <strong className="dark-mode-text">{config.maxRiskPerTrade}%</strong></span>
        <span>📊 <strong className="dark-mode-text">{currentPrice > 0 ? formatPrice(currentPrice) : '—'}</strong></span>
        {liveRisk && (
          <span className={`${liveRisk.heatIndex > 50 ? 'text-amber-400' : 'text-emerald-400'}`}>
            🌡 Heat: <strong>{liveRisk.heatIndex.toFixed(0)}</strong>
        </span>
        )}
        {config.propFirmMode && liveRisk?.propCompliance && (
          <span className={`${
            liveRisk.propCompliance.accountHealth > 70 ? 'text-emerald-400'
            : liveRisk.propCompliance.accountHealth > 40 ? 'text-amber-400'
            : 'text-rose-400'
          }`}>
            🏦 <strong>{liveRisk.propCompliance.accountHealth.toFixed(0)}%</strong>
            {liveRisk.propCompliance.profitTargetPct > 0 && (
              <> · {liveRisk.propCompliance.progressToTarget.toFixed(0)}% to target</>
            )}
          </span>
        )}
        <span className="ml-auto">{new Date().toLocaleTimeString()}</span>
      </div>
    </section>
  );
}
