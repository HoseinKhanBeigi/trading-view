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
  DEFAULT_ADVANCED_CONFIG,
} from "@/lib/advanced-strategy";

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
  const [showConfig, setShowConfig] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [activeTab, setActiveTab] = useState<'signal' | 'flow' | 'liquidity' | 'structure' | 'risk'>('signal');
  const lastUpdateRef = useRef(0);

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
    if (strategyResult) setResult(strategyResult);
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

        {/* ── SIGNAL TAB ── */}
        {activeTab === 'signal' && r && !(liveRisk?.shouldStop) && r.masterDirection !== 'WAIT' ? (
          <div>
            {/* Master Score Bars */}
            <div className="space-y-1 mb-4">
              <ScoreBar value={r.orderFlow.score} label="Order Flow" />
              <ScoreBar value={r.liquidity.score} label="Liquidity" />
              <ScoreBar value={r.structure.score} label="Structure" />
              <ScoreBar value={r.execution.confluenceScore - 50} label="Execution" />
              <div className="pt-1 border-t border-zinc-800/30">
                <ScoreBar value={r.masterScore} label="MASTER" color={r.masterScore >= 0 ? 'bg-emerald-400' : 'bg-rose-400'} />
              </div>
            </div>

            {/* Direction & Grade */}
          <div className={`rounded-xl p-3 sm:p-4 ${
              r.masterDirection === 'LONG'
              ? 'bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/40 dark:to-emerald-900/20 ring-1 ring-emerald-300/50 dark:ring-emerald-600/30'
              : 'bg-gradient-to-br from-rose-50 to-rose-100/50 dark:from-rose-950/40 dark:to-rose-900/20 ring-1 ring-rose-300/50 dark:ring-rose-600/30'
          }`}>
            <div className="flex items-center gap-2 mb-3">
              <span className={`text-2xl font-black ${
                  r.masterDirection === 'LONG' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}>
                  {r.masterDirection === 'LONG' ? '🟢 LONG' : '🔴 SHORT'}
              </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${gradeColor(r.masterGrade)}`}>
                  {r.masterGrade}
              </span>
                <span className="ml-auto text-[10px] text-zinc-400">
                  Confidence: <span className="font-bold dark-mode-text">{r.confidence.toFixed(0)}%</span>
              </span>
            </div>

              {/* Entry / SL / TP Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              <div className="rounded-lg bg-white/60 dark:bg-zinc-800/60 p-2 text-center">
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Entry</div>
                  <div className="font-mono font-black text-sm dark-mode-text">{formatPrice(r.execution.entry)}</div>
              </div>
              <div className="rounded-lg bg-rose-50/60 dark:bg-rose-900/20 p-2 text-center">
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-rose-400">Stop Loss</div>
                  <div className="font-mono font-black text-sm text-rose-600 dark:text-rose-400">{formatPrice(r.execution.stopLoss)}</div>
                  <div className="text-[8px] text-rose-400">-{(Math.abs(r.execution.entry - r.execution.stopLoss) / r.execution.entry * 100).toFixed(2)}%</div>
              </div>
              <div className="rounded-lg bg-emerald-50/60 dark:bg-emerald-900/20 p-2 text-center">
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-emerald-400">TP1</div>
                  <div className="font-mono font-black text-sm text-emerald-600 dark:text-emerald-400">{formatPrice(r.execution.takeProfit1)}</div>
                  <div className="text-[8px] text-emerald-400">+{(Math.abs(r.execution.takeProfit1 - r.execution.entry) / r.execution.entry * 100).toFixed(2)}%</div>
              </div>
              <div className="rounded-lg bg-emerald-50/30 dark:bg-emerald-900/10 p-2 text-center">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-emerald-300 dark:text-emerald-600">TP2</div>
                  <div className="font-mono font-black text-sm text-emerald-500">{formatPrice(r.execution.takeProfit2)}</div>
                  <div className="text-[8px] text-emerald-400">+{(Math.abs(r.execution.takeProfit2 - r.execution.entry) / r.execution.entry * 100).toFixed(2)}%</div>
              </div>
            </div>

            {/* Position Sizing */}
            <div className="rounded-lg bg-white/50 dark:bg-zinc-800/40 p-2 mb-3">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 mb-1.5">
                  Position • ${config.capital} • {config.leverage}x {config.useKellySizing ? '• Kelly' : ''}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                <div>
                  <span className="text-zinc-400">Size: </span>
                    <span className="font-mono font-bold dark-mode-text">${(liveRisk?.positionNotional ?? 0).toFixed(0)}</span>
                </div>
                <div>
                  <span className="text-zinc-400">Risk: </span>
                  <span className="font-mono font-bold text-rose-500">
                      ${(liveRisk?.riskAmount ?? 0).toFixed(2)} ({(liveRisk?.riskPercent ?? 0).toFixed(1)}%)
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400">Reward: </span>
                  <span className="font-mono font-bold text-emerald-500">
                      ${(liveRisk?.rewardAmount ?? 0).toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400">R:R </span>
                    <span className={`font-mono font-bold ${r.execution.riskReward >= 1.5 ? 'text-emerald-500' : r.execution.riskReward >= 1 ? 'text-amber-500' : 'text-rose-500'}`}>
                      1:{r.execution.riskReward.toFixed(1)}
                  </span>
                  </div>
                </div>
                {liveRisk?.shouldReduceSize && (
                  <div className="text-[9px] text-amber-400 mt-1">⚠ Size reduced {((1 - liveRisk.sizeMultiplier) * 100).toFixed(0)}% due to recent performance</div>
                )}
              </div>

              {/* Partial TPs */}
              {liveRisk && liveRisk.partialTPs.length > 0 && (
                <div className="flex gap-1 mb-3">
                  {liveRisk.partialTPs.map((tp, i) => (
                    <div key={i} className="flex-1 rounded-lg bg-emerald-50/30 dark:bg-emerald-900/10 p-1.5 text-center">
                      <div className="text-[8px] text-emerald-400 font-semibold">{tp.label}</div>
                      <div className="font-mono text-[10px] text-emerald-500 font-bold">{formatPrice(tp.price)}</div>
                    </div>
                  ))}
            </div>
              )}

            {/* Reasons */}
            <div className="flex flex-wrap gap-1 mb-3">
                {r.execution.reasons.map((reason, i) => (
                <span key={i} className="px-1.5 py-0.5 rounded text-[9px] bg-white/60 dark:bg-zinc-700/50 text-zinc-600 dark:text-zinc-300">
                    ✓ {reason}
                </span>
              ))}
            </div>

              {/* Warnings */}
              {r.execution.warnings.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {r.execution.warnings.map((w, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded text-[9px] bg-amber-100/60 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400">
                      ⚠ {w}
                    </span>
                  ))}
                </div>
              )}

              {/* Checklist Toggle */}
              <button onClick={() => setShowChecklist(!showChecklist)} className="text-[10px] text-violet-400 hover:text-violet-300 mb-2 underline">
                {showChecklist ? '▼ Hide' : '▶ Show'} Execution Checklist ({r.execution.passedCount}/{r.execution.totalChecks})
              </button>
              {showChecklist && (
                <div className="rounded-lg bg-zinc-900/30 p-2 mb-3 space-y-0.5 max-h-52 overflow-y-auto">
                  {r.execution.checklist.map(item => (
                    <ChecklistRow key={item.id} item={item} />
                  ))}
                </div>
              )}

              {/* Action Buttons */}
            <div className="flex gap-2">
              <button
                  onClick={() => logTrade('win')}
                  disabled={liveRisk?.shouldStop}
                  className="flex-1 py-2 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-white transition-colors disabled:opacity-30"
                >
                  ✅ Won
              </button>
              <button
                  onClick={() => logTrade('loss')}
                  disabled={liveRisk?.shouldStop}
                  className="flex-1 py-2 rounded-lg text-xs font-bold bg-rose-500 hover:bg-rose-600 text-white transition-colors disabled:opacity-30"
                >
                  ❌ Lost
              </button>
              <button
                  onClick={() => logTrade('breakeven')}
                  disabled={liveRisk?.shouldStop}
                  className="py-2 px-3 rounded-lg text-xs font-bold bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 dark-mode-text transition-colors disabled:opacity-30"
              >
                ⚖ BE
              </button>
            </div>
          </div>
          </div>
        ) : activeTab === 'signal' ? (
          <div className="text-center py-6">
            <div className="text-2xl mb-2">{liveRisk?.shouldStop ? '⛔' : '👀'}</div>
            <div className="text-sm text-zinc-400 dark:text-zinc-500 font-medium">
              {candles.length < 50
                ? `Loading... (${candles.length}/50 candles)`
                : liveRisk?.shouldStop
                ? 'Trading paused — risk limits reached'
                : r?.masterDirection === 'WAIT'
                ? 'No high-confluence setup found — WAIT'
                : 'Scanning for opportunities...'}
            </div>
            {r && r.masterDirection === 'WAIT' && (
              <div className="mt-3 space-y-1">
                <ScoreBar value={r.orderFlow.score} label="Order Flow" />
                <ScoreBar value={r.liquidity.score} label="Liquidity" />
                <ScoreBar value={r.structure.score} label="Structure" />
              </div>
            )}
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

        {/* No data state for non-signal tabs */}
        {activeTab !== 'signal' && !r && (
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
        <span className="ml-auto">{new Date().toLocaleTimeString()}</span>
      </div>
    </section>
  );
}
