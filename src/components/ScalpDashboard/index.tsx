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
  const [activeTab, setActiveTab] = useState<'signal' | 'flow' | 'liquidity' | 'structure' | 'risk' | 'shadows' | 'prop'>('signal');
  const lastUpdateRef = useRef(0);
  const lastSignalDirRef = useRef<string>('WAIT');

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
      candles, trades, orderBook, tradeHistory, config, symbol
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
    }
  }, [candles, trades, orderBook, tradeHistory, config, symbol, interval]);

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
