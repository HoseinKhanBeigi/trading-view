"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useMarketStore } from "@/store";
import {
  generateScalpSignals,
  calculateDailyStats,
  getCurrentSession,
  getSessionInfo,
  type ScalpSignal,
  type DailyTradeLog,
  type ScalpConfig,
  type DailyStats,
  type ScalpSession,
  DEFAULT_SCALP_CONFIG,
} from "@/lib/scalp-signals";

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
    default: return 'text-zinc-400 bg-zinc-800/40';
  }
}

function ConfluenceDots({ count, max = 8 }: { count: number; max?: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${
            i < count
              ? count >= 6 ? 'bg-emerald-400' : count >= 4 ? 'bg-amber-400' : 'bg-zinc-400'
              : 'bg-zinc-700'
          }`}
        />
      ))}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function ScalpDashboard() {
  const candles = useMarketStore((s) => s.candles);
  const symbol = useMarketStore((s) => s.symbol);
  const interval = useMarketStore((s) => s.interval);

  const [config, setConfig] = useState<ScalpConfig>(DEFAULT_SCALP_CONFIG);
  const [signals, setSignals] = useState<ScalpSignal[]>([]);
  const [trades, setTrades] = useState<DailyTradeLog[]>([]);
  const [session, setSession] = useState<ScalpSession>(getCurrentSession());
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const lastUpdateRef = useRef(0);
  const lastSignalIdRef = useRef<string>('');

  // Update session every minute
  useEffect(() => {
    const timer = setInterval(() => setSession(getCurrentSession()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Generate signals when candles update - faster for 1m scalping
  useEffect(() => {
    if (candles.length < 50) return;
    const now = Date.now();
    // Faster updates for 1m timeframe (1.5s), slower for others (3s)
    const throttleMs = interval === '1m' ? 1500 : 3000;
    if (now - lastUpdateRef.current < throttleMs) return;
    lastUpdateRef.current = now;

    const newSignals = generateScalpSignals(candles, config);
    setSignals(newSignals);

    // Alert on new high-grade signal
    if (newSignals.length > 0 && newSignals[0].id !== lastSignalIdRef.current) {
      lastSignalIdRef.current = newSignals[0].id;
      if (soundEnabled && newSignals[0].grade === 'A+') {
        // Visual pulse effect handled by CSS
      }
    }
  }, [candles, config, soundEnabled]);

  // Update daily stats when trades change
  useEffect(() => {
    setDailyStats(calculateDailyStats(trades, config));
  }, [trades, config]);

  // Log a trade result
  const logTrade = useCallback((signal: ScalpSignal, result: 'win' | 'loss' | 'breakeven') => {
    const pnlMultiplier = result === 'win' ? 1 : result === 'loss' ? -1 : 0;
    const pnlDollar = result === 'win'
      ? signal.positionSize.rewardAmount
      : result === 'loss'
      ? -signal.positionSize.riskAmount
      : 0;

    const trade: DailyTradeLog = {
      id: `trade-${Date.now()}`,
      signal,
      result,
      pnlDollar,
      pnlPct: config.capital > 0 ? (pnlDollar / config.capital) * 100 : 0,
      exitPrice: result === 'win' ? signal.takeProfit1 : result === 'loss' ? signal.stopLoss : signal.entry,
      tradeNum: trades.length + 1,
      time: Date.now(),
    };

    setTrades(prev => [...prev, trade]);
  }, [trades, config]);

  // Reset daily trades
  const resetDay = useCallback(() => {
    setTrades([]);
  }, []);

  const sessionInfo = getSessionInfo(session);
  const bestSignal = signals.length > 0 ? signals[0] : null;
  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-sm overflow-hidden">
      {/* ══ Header ══ */}
      <div className="px-3 sm:px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-gradient-to-r from-violet-50 via-white to-amber-50 dark:from-violet-950/30 dark:via-zinc-900 dark:to-amber-950/20">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-black text-sm tracking-wide uppercase text-violet-700 dark:text-violet-300">
            🎯 Scalp Dashboard
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
            {symbol} · {interval}
          </span>

          {/* Session badge */}
          <span className={`text-[10px] px-2 py-0.5 rounded font-semibold bg-${sessionInfo.color}-100 dark:bg-${sessionInfo.color}-900/30 text-${sessionInfo.color}-700 dark:text-${sessionInfo.color}-400`}>
            {sessionInfo.emoji} {sessionInfo.name}
          </span>

          {/* Trade counter */}
          <span className={`text-[10px] px-2 py-0.5 rounded font-bold ml-auto ${
            (dailyStats?.totalTrades ?? 0) >= config.maxTradesPerDay
              ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
          }`}>
            {dailyStats?.totalTrades ?? 0}/{config.maxTradesPerDay} trades
          </span>

          {/* Settings toggle */}
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="text-[10px] px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* ══ Config Panel (Collapsible) ══ */}
      {showConfig && (
        <div className="px-3 sm:px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/40">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 block mb-1">Capital ($)</label>
              <input
                type="number"
                value={config.capital}
                onChange={e => setConfig(c => ({ ...c, capital: Number(e.target.value) }))}
                className="w-full px-2 py-1.5 rounded text-xs font-mono bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 dark-mode-text"
              />
            </div>
            <div>
              <label className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 block mb-1">Leverage (x)</label>
              <input
                type="number"
                value={config.leverage}
                onChange={e => setConfig(c => ({ ...c, leverage: Number(e.target.value) }))}
                className="w-full px-2 py-1.5 rounded text-xs font-mono bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 dark-mode-text"
              />
            </div>
            <div>
              <label className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 block mb-1">Risk/Trade (%)</label>
              <input
                type="number"
                step="0.5"
                value={config.riskPerTradePct}
                onChange={e => setConfig(c => ({ ...c, riskPerTradePct: Number(e.target.value) }))}
                className="w-full px-2 py-1.5 rounded text-xs font-mono bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 dark-mode-text"
              />
            </div>
            <div>
              <label className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 block mb-1">Max Daily Loss (%)</label>
              <input
                type="number"
                step="0.5"
                value={config.maxDailyLossPct}
                onChange={e => setConfig(c => ({ ...c, maxDailyLossPct: Number(e.target.value) }))}
                className="w-full px-2 py-1.5 rounded text-xs font-mono bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 dark-mode-text"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`text-[10px] px-2 py-1 rounded transition-colors ${
                soundEnabled ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
              }`}
            >
              {soundEnabled ? '🔔 Alerts ON' : '🔕 Alerts OFF'}
            </button>
            <button
              onClick={resetDay}
              className="text-[10px] px-2 py-1 rounded bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 hover:bg-rose-200 dark:hover:bg-rose-900/50 transition-colors"
            >
              🗑 Reset Day
            </button>
          </div>
        </div>
      )}

      {/* ══ Stop Warning ══ */}
      {dailyStats?.shouldStop && (
        <div className="px-3 py-2 bg-rose-50 dark:bg-rose-950/30 border-b border-rose-200 dark:border-rose-800/40">
          <div className="flex items-center gap-2 text-xs font-semibold text-rose-600 dark:text-rose-400">
            <span className="text-base">⛔</span>
            <span>{dailyStats.stopReason}</span>
          </div>
        </div>
      )}

      {/* ══ Daily P&L Bar ══ */}
      {dailyStats && dailyStats.totalTrades > 0 && (
        <div className="px-3 sm:px-4 py-2 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20">
          <div className="flex items-center gap-3 text-[10px]">
            <span className="font-semibold text-zinc-500 dark:text-zinc-400">Today&apos;s P&amp;L:</span>
            <span className={`font-mono font-black text-sm ${dailyStats.totalPnlDollar >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {dailyStats.totalPnlDollar >= 0 ? '+' : '-'}{formatUSD(dailyStats.totalPnlDollar)}
            </span>
            <span className={`font-mono ${dailyStats.totalPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              ({dailyStats.totalPnlPct >= 0 ? '+' : ''}{dailyStats.totalPnlPct.toFixed(1)}%)
            </span>
            <span className="text-zinc-400 dark:text-zinc-600">|</span>
            <span className="text-emerald-500 font-semibold">{dailyStats.wins}W</span>
            <span className="text-rose-500 font-semibold">{dailyStats.losses}L</span>
            {dailyStats.winRate > 0 && (
              <span className={`font-semibold ${dailyStats.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {dailyStats.winRate.toFixed(0)}% WR
              </span>
            )}
            {dailyStats.consecutiveLosses >= 2 && (
              <span className="text-rose-400 font-bold ml-auto">
                ⚠ {dailyStats.consecutiveLosses} losses in a row
              </span>
            )}
          </div>

          {/* Mini progress bar */}
          <div className="mt-1.5 flex gap-0.5">
            {trades.map((t, i) => (
              <div
                key={i}
                className={`flex-1 h-1.5 rounded-full ${
                  t.result === 'win' ? 'bg-emerald-400'
                  : t.result === 'loss' ? 'bg-rose-400'
                  : t.result === 'breakeven' ? 'bg-zinc-400'
                  : 'bg-zinc-600'
                }`}
                title={`Trade #${t.tradeNum}: ${t.result} ${t.pnlDollar >= 0 ? '+' : ''}$${t.pnlDollar.toFixed(2)}`}
              />
            ))}
            {Array.from({ length: Math.max(0, config.maxTradesPerDay - trades.length) }).map((_, i) => (
              <div key={`empty-${i}`} className="flex-1 h-1.5 rounded-full bg-zinc-800/30" />
            ))}
          </div>
        </div>
      )}

      {/* ══ Best Signal Card ══ */}
      {bestSignal && !(dailyStats?.shouldStop) ? (
        <div className="p-3 sm:p-4">
          {/* Main signal */}
          <div className={`rounded-xl p-3 sm:p-4 ${
            bestSignal.direction === 'LONG'
              ? 'bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/40 dark:to-emerald-900/20 ring-1 ring-emerald-300/50 dark:ring-emerald-600/30'
              : 'bg-gradient-to-br from-rose-50 to-rose-100/50 dark:from-rose-950/40 dark:to-rose-900/20 ring-1 ring-rose-300/50 dark:ring-rose-600/30'
          }`}>
            {/* Signal header */}
            <div className="flex items-center gap-2 mb-3">
              <span className={`text-2xl font-black ${
                bestSignal.direction === 'LONG' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}>
                {bestSignal.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT'}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${gradeColor(bestSignal.grade)}`}>
                {bestSignal.grade}
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                {bestSignal.strategy}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-[9px] text-zinc-400">Confluence</span>
                <ConfluenceDots count={bestSignal.confluenceCount} />
              </div>
            </div>

            {/* Entry / SL / TP grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              <div className="rounded-lg bg-white/60 dark:bg-zinc-800/60 p-2 text-center">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                  Entry <span className="text-amber-500">(Limit)</span>
                </div>
                <div className="font-mono font-black text-sm dark-mode-text">{formatPrice(bestSignal.entry)}</div>
                {currentPrice > 0 && (
                  <div className="text-[8px] text-zinc-400 mt-0.5">
                    Market: {formatPrice(currentPrice)}
                    {bestSignal.direction === 'LONG' ? (
                      <span className="text-emerald-400"> ({((currentPrice - bestSignal.entry) / currentPrice * 100).toFixed(3)}% better)</span>
                    ) : (
                      <span className="text-emerald-400"> ({((bestSignal.entry - currentPrice) / currentPrice * 100).toFixed(3)}% better)</span>
                    )}
                  </div>
                )}
              </div>
              <div className="rounded-lg bg-rose-50/60 dark:bg-rose-900/20 p-2 text-center">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-rose-400 dark:text-rose-500">Stop Loss</div>
                <div className="font-mono font-black text-sm text-rose-600 dark:text-rose-400">{formatPrice(bestSignal.stopLoss)}</div>
                <div className="text-[8px] text-rose-400">
                  -{(Math.abs(bestSignal.entry - bestSignal.stopLoss) / bestSignal.entry * 100).toFixed(2)}%
                </div>
              </div>
              <div className="rounded-lg bg-emerald-50/60 dark:bg-emerald-900/20 p-2 text-center">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-emerald-400 dark:text-emerald-500">TP1</div>
                <div className="font-mono font-black text-sm text-emerald-600 dark:text-emerald-400">{formatPrice(bestSignal.takeProfit1)}</div>
                <div className="text-[8px] text-emerald-400">
                  +{(Math.abs(bestSignal.takeProfit1 - bestSignal.entry) / bestSignal.entry * 100).toFixed(2)}%
                </div>
              </div>
              <div className="rounded-lg bg-emerald-50/30 dark:bg-emerald-900/10 p-2 text-center">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-emerald-300 dark:text-emerald-600">TP2</div>
                <div className="font-mono font-black text-sm text-emerald-500 dark:text-emerald-500">{formatPrice(bestSignal.takeProfit2)}</div>
                <div className="text-[8px] text-emerald-400">
                  +{(Math.abs(bestSignal.takeProfit2 - bestSignal.entry) / bestSignal.entry * 100).toFixed(2)}%
                </div>
              </div>
            </div>

            {/* Position Sizing */}
            <div className="rounded-lg bg-white/50 dark:bg-zinc-800/40 p-2 mb-3">
              <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-1.5">
                Position Sizing • ${config.capital} capital • {config.leverage}x leverage
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                <div>
                  <span className="text-zinc-400">Size: </span>
                  <span className="font-mono font-bold dark-mode-text">${bestSignal.positionSize.notionalSize.toFixed(0)}</span>
                </div>
                <div>
                  <span className="text-zinc-400">Risk: </span>
                  <span className="font-mono font-bold text-rose-500">
                    ${bestSignal.positionSize.riskAmount.toFixed(2)} ({bestSignal.positionSize.riskPct.toFixed(1)}%)
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400">Reward: </span>
                  <span className="font-mono font-bold text-emerald-500">
                    ${bestSignal.positionSize.rewardAmount.toFixed(2)} ({bestSignal.positionSize.rewardPct.toFixed(1)}%)
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400">R:R </span>
                  <span className={`font-mono font-bold ${bestSignal.riskReward >= 1.5 ? 'text-emerald-500' : bestSignal.riskReward >= 1 ? 'text-amber-500' : 'text-rose-500'}`}>
                    1:{bestSignal.riskReward.toFixed(1)}
                  </span>
                </div>
              </div>
            </div>

            {/* Reasons */}
            <div className="flex flex-wrap gap-1 mb-3">
              {bestSignal.reasons.map((r, i) => (
                <span key={i} className="px-1.5 py-0.5 rounded text-[9px] bg-white/60 dark:bg-zinc-700/50 text-zinc-600 dark:text-zinc-300">
                  ✓ {r}
                </span>
              ))}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => logTrade(bestSignal, 'win')}
                disabled={dailyStats?.shouldStop}
                className="flex-1 py-2 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ✅ Won (TP Hit)
              </button>
              <button
                onClick={() => logTrade(bestSignal, 'loss')}
                disabled={dailyStats?.shouldStop}
                className="flex-1 py-2 rounded-lg text-xs font-bold bg-rose-500 hover:bg-rose-600 text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ❌ Lost (SL Hit)
              </button>
              <button
                onClick={() => logTrade(bestSignal, 'breakeven')}
                disabled={dailyStats?.shouldStop}
                className="py-2 px-3 rounded-lg text-xs font-bold bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 dark-mode-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ⚖ BE
              </button>
            </div>
          </div>

          {/* Other signals */}
          {signals.length > 1 && (
            <div className="mt-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">
                Other Signals ({signals.length - 1})
              </div>
              <div className="space-y-1">
                {signals.slice(1, 5).map((sig) => (
                  <div
                    key={sig.id}
                    className={`rounded-lg p-2 text-xs flex items-center gap-2 ${
                      sig.direction === 'LONG'
                        ? 'bg-emerald-50/50 dark:bg-emerald-950/10 ring-1 ring-emerald-200/30 dark:ring-emerald-800/20'
                        : 'bg-rose-50/50 dark:bg-rose-950/10 ring-1 ring-rose-200/30 dark:ring-rose-800/20'
                    }`}
                  >
                    <span className={`font-bold text-[11px] ${
                      sig.direction === 'LONG' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}>
                      {sig.direction === 'LONG' ? '🟢' : '🔴'}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${gradeColor(sig.grade)}`}>
                      {sig.grade}
                    </span>
                    <span className="text-[9px] text-zinc-500 dark:text-zinc-400">{sig.strategy}</span>
                    <span className="font-mono text-[10px] dark-mode-text">
                      E:{formatPrice(sig.entry)}
                    </span>
                    <span className="font-mono text-[10px] text-rose-500">
                      SL:{formatPrice(sig.stopLoss)}
                    </span>
                    <span className="font-mono text-[10px] text-emerald-500">
                      TP:{formatPrice(sig.takeProfit1)}
                    </span>
                    <span className="ml-auto text-[9px] text-zinc-400">
                      R:R {sig.riskReward.toFixed(1)}
                    </span>
                    <ConfluenceDots count={sig.confluenceCount} max={6} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : !dailyStats?.shouldStop ? (
        <div className="p-6 text-center">
          <div className="text-2xl mb-2">👀</div>
          <div className="text-sm text-zinc-400 dark:text-zinc-500 font-medium">
            {candles.length < 50
              ? `Loading... (${candles.length}/50 candles)`
              : 'Scanning for scalp opportunities...'}
          </div>
          <div className="text-[10px] text-zinc-400 dark:text-zinc-600 mt-1">
            Waiting for confluence signals on {symbol} {interval}
          </div>
        </div>
      ) : null}

      {/* ══ Trade Log ══ */}
      {trades.length > 0 && (
        <div className="px-3 sm:px-4 py-3 border-t border-zinc-100 dark:border-zinc-800">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">
            Today&apos;s Trade Log
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {[...trades].reverse().map((t) => (
              <div
                key={t.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-[10px] ${
                  t.result === 'win'
                    ? 'bg-emerald-50 dark:bg-emerald-950/20'
                    : t.result === 'loss'
                    ? 'bg-rose-50 dark:bg-rose-950/20'
                    : 'bg-zinc-50 dark:bg-zinc-800/30'
                }`}
              >
                <span className="font-bold text-zinc-400 w-4">#{t.tradeNum}</span>
                <span className={`font-bold ${
                  t.signal.direction === 'LONG' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                }`}>
                  {t.signal.direction}
                </span>
                <span className="text-zinc-400 dark:text-zinc-500">{t.signal.strategy}</span>
                <span className="font-mono dark-mode-text">{formatPrice(t.signal.entry)}</span>
                <span className="text-zinc-400">→</span>
                <span className="font-mono dark-mode-text">{formatPrice(t.exitPrice)}</span>
                <span className={`ml-auto font-mono font-bold ${
                  t.pnlDollar > 0 ? 'text-emerald-500' : t.pnlDollar < 0 ? 'text-rose-500' : 'text-zinc-400'
                }`}>
                  {t.pnlDollar >= 0 ? '+' : ''}{formatUSD(t.pnlDollar)}
                </span>
                <span className={`font-mono ${
                  t.result === 'win' ? 'text-emerald-400' : t.result === 'loss' ? 'text-rose-400' : 'text-zinc-400'
                }`}>
                  {t.result === 'win' ? '✅' : t.result === 'loss' ? '❌' : '⚖️'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ Footer ══ */}
      <div className="px-3 sm:px-4 py-2 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20 flex flex-wrap items-center gap-3 text-[10px] text-zinc-400 dark:text-zinc-500">
        <span>
          💰 Capital: <strong className="dark-mode-text">${config.capital}</strong>
        </span>
        <span>
          ⚡ Leverage: <strong className="dark-mode-text">{config.leverage}x</strong>
        </span>
        <span>
          🎯 Risk: <strong className="dark-mode-text">{config.riskPerTradePct}% (${(config.capital * config.riskPerTradePct / 100).toFixed(2)})</strong>
        </span>
        <span>
          📊 Price: <strong className="dark-mode-text">{currentPrice > 0 ? formatPrice(currentPrice) : '—'}</strong>
        </span>
        <span className="ml-auto">
          {new Date().toLocaleTimeString()}
        </span>
      </div>
    </section>
  );
}

