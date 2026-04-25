"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useMarketStore } from "@/store";
import { startKlines, stopKlines } from "@/store/actions/candles";
import {
  calculateBRR,
  fetchBinanceTrades,
  type Trade,
  type BRRResult,
} from "@/lib/brr";

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatPrice(price: number) {
  if (price === 0) return "—";
  return price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatVolume(vol: number) {
  if (vol === 0) return "—";
  return vol.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

function VWAPBar({ bucket, maxVolume }: { bucket: BRRResult["buckets"][0]; maxVolume: number }) {
  const widthPct = maxVolume > 0 ? (bucket.totalVolume / maxVolume) * 100 : 0;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-8 text-xs dark-mode-text-secondary font-mono text-right shrink-0">
        #{bucket.intervalIndex}
      </div>
      <div className="w-[110px] text-xs dark-mode-text-secondary shrink-0 font-mono">
        {formatTime(bucket.startTime)}
      </div>
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <div className="flex-1 h-6 rounded bg-zinc-800/30 dark:bg-zinc-800/50 overflow-hidden relative">
          <div
            className="h-full rounded transition-all duration-500"
            style={{
              width: `${widthPct}%`,
              background: bucket.vwap > 0
                ? "linear-gradient(90deg, rgba(14,203,129,0.3), rgba(14,203,129,0.6))"
                : "rgba(100,100,100,0.2)",
            }}
          />
          <span className="absolute inset-0 flex items-center px-2 text-[11px] font-mono dark-mode-text">
            {formatVolume(bucket.totalVolume)} BTC
          </span>
        </div>
      </div>
      <div className="w-[100px] text-right text-sm font-mono font-medium dark-mode-text shrink-0">
        ${formatPrice(bucket.vwap)}
      </div>
      <div className="w-[60px] text-right text-xs dark-mode-text-secondary shrink-0 font-mono">
        {bucket.tradeCount.toLocaleString()}
      </div>
    </div>
  );
}

export default function BRRPage() {
  const params = useParams();
  const sym: string = (params.symbol as string) || "btcusdt";
  const setSymbol = useMarketStore((s) => s.setSymbol);
  const interval = useMarketStore((s) => s.interval);

  const [brr, setBrr] = useState<BRRResult | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setSymbol(sym);
    stopKlines();
    startKlines(sym, interval);
  }, [sym]);

  const computeBRR = useCallback(
    (tradeData: Trade[]) => {
      if (tradeData.length === 0) return;
      const result = calculateBRR(tradeData);
      setBrr(result);
      setLastUpdate(Date.now());
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setLoading(true);
      setError(null);
      try {
        const initial = await fetchBinanceTrades(sym.toUpperCase());
        if (cancelled) return;
        setTrades(initial);
        computeBRR(initial);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to fetch trades");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, [sym, computeBRR]);

  useEffect(() => {
    if (!autoRefresh) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    const wsUrl = `wss://fstream.binance.com/ws/${sym.toLowerCase()}@aggTrade`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const newTrade: Trade = {
        price: parseFloat(data.p),
        qty: parseFloat(data.q),
        time: data.T,
        isBuyerMaker: data.m,
      };

      setTrades((prev) => {
        const cutoff = Date.now() - 60 * 60 * 1000;
        const updated = [...prev.filter((t) => t.time >= cutoff), newTrade];
        return updated;
      });
    };

    ws.onerror = () => setError("WebSocket connection error");

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sym, autoRefresh]);

  useEffect(() => {
    if (!autoRefresh || trades.length === 0) return;
    const id = setInterval(() => computeBRR(trades), 3000);
    return () => clearInterval(id);
  }, [autoRefresh, trades, computeBRR]);

  const maxVolume = brr
    ? Math.max(...brr.buckets.map((b) => b.totalVolume))
    : 0;

  return (
    <div className="dark-mode-bg dark-mode-text min-h-screen">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Navigation */}
        <div className="flex items-center gap-3">
          <Link
            href={`/${sym.toLowerCase()}`}
            className="text-sm dark-mode-text-secondary hover:text-[var(--accent-green)] transition-colors"
          >
            &larr; Back to Dashboard
          </Link>
        </div>

        {/* Header */}
        <div className="rounded-xl border dark-mode-border dark-mode-bg-secondary p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold dark-mode-text">
                CME BRR Algorithm
              </h2>
              <p className="text-sm dark-mode-text-secondary mt-1">
                Bitcoin Reference Rate — VWAP across 12 equally-weighted 5-minute intervals
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  autoRefresh
                    ? "border-[var(--accent-green)] text-[var(--accent-green)] bg-[var(--accent-green)]/10"
                    : "dark-mode-border dark-mode-text-secondary"
                }`}
              >
                {autoRefresh ? "● LIVE" : "○ PAUSED"}
              </button>
              <div className="text-xs dark-mode-text-secondary font-mono">
                {sym.toUpperCase()}
              </div>
            </div>
          </div>

          {/* BRR Price */}
          {brr && !loading && (
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="rounded-lg dark-mode-bg p-4 border dark-mode-border">
                <div className="text-xs dark-mode-text-secondary uppercase tracking-wider">
                  BRR Price
                </div>
                <div className="text-2xl font-bold font-mono mt-1 text-[var(--accent-green)]">
                  ${formatPrice(brr.brr)}
                </div>
              </div>
              <div className="rounded-lg dark-mode-bg p-4 border dark-mode-border">
                <div className="text-xs dark-mode-text-secondary uppercase tracking-wider">
                  Median VWAP
                </div>
                <div className="text-2xl font-bold font-mono mt-1">
                  ${formatPrice(brr.medianVwap)}
                </div>
              </div>
              <div className="rounded-lg dark-mode-bg p-4 border dark-mode-border">
                <div className="text-xs dark-mode-text-secondary uppercase tracking-wider">
                  Std Deviation
                </div>
                <div className="text-2xl font-bold font-mono mt-1">
                  ${formatPrice(brr.stdDev)}
                </div>
              </div>
              <div className="rounded-lg dark-mode-bg p-4 border dark-mode-border">
                <div className="text-xs dark-mode-text-secondary uppercase tracking-wider">
                  Spread vs Spot
                </div>
                <div
                  className={`text-2xl font-bold font-mono mt-1 ${
                    brr.spreadFromSpot >= 0
                      ? "text-[var(--accent-green)]"
                      : "text-[var(--accent-red)]"
                  }`}
                >
                  {brr.spreadFromSpot >= 0 ? "+" : ""}
                  {brr.spreadFromSpot.toFixed(4)}%
                </div>
              </div>
            </div>
          )}
        </div>

        {/* How BRR Works */}
        <div className="rounded-xl border dark-mode-border dark-mode-bg-secondary p-6">
          <h3 className="text-lg font-semibold mb-3">How CME BRR Works</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div className="rounded-lg dark-mode-bg p-4 border dark-mode-border">
              <div className="text-[var(--accent-green)] font-bold text-lg mb-1">
                1
              </div>
              <div className="font-medium mb-1">Observation Window</div>
              <div className="dark-mode-text-secondary text-xs">
                A 1-hour window is divided into 12 equal 5-minute intervals.
                CME uses 3:00–4:00 PM London time for the official settlement.
              </div>
            </div>
            <div className="rounded-lg dark-mode-bg p-4 border dark-mode-border">
              <div className="text-[var(--accent-green)] font-bold text-lg mb-1">
                2
              </div>
              <div className="font-medium mb-1">VWAP per Interval</div>
              <div className="dark-mode-text-secondary text-xs">
                For each 5-minute bucket, the Volume-Weighted Average Price
                (VWAP) is calculated: &Sigma;(Price &times; Volume) / &Sigma;Volume
              </div>
            </div>
            <div className="rounded-lg dark-mode-bg p-4 border dark-mode-border">
              <div className="text-[var(--accent-green)] font-bold text-lg mb-1">
                3
              </div>
              <div className="font-medium mb-1">Equally-Weighted Average</div>
              <div className="dark-mode-text-secondary text-xs">
                The BRR is the simple arithmetic mean of all 12 interval VWAPs,
                reducing the impact of any single spike or flash crash.
              </div>
            </div>
          </div>
        </div>

        {/* 12 Interval Breakdown */}
        <div className="rounded-xl border dark-mode-border dark-mode-bg-secondary p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">
              5-Minute Interval Breakdown
            </h3>
            {brr && (
              <div className="text-xs dark-mode-text-secondary font-mono">
                {formatTime(brr.windowStart)} — {formatTime(brr.windowEnd)} ·{" "}
                {brr.totalTrades.toLocaleString()} trades
              </div>
            )}
          </div>

          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin w-8 h-8 border-2 border-[var(--accent-green)] border-t-transparent rounded-full" />
            </div>
          )}

          {error && (
            <div className="text-center py-8 text-[var(--accent-red)] text-sm">
              {error}
            </div>
          )}

          {brr && !loading && (
            <div>
              {/* Column headers */}
              <div className="flex items-center gap-3 pb-2 border-b dark-mode-border mb-1">
                <div className="w-8 text-[10px] dark-mode-text-secondary text-right shrink-0">
                  #
                </div>
                <div className="w-[110px] text-[10px] dark-mode-text-secondary shrink-0">
                  TIME
                </div>
                <div className="flex-1 text-[10px] dark-mode-text-secondary">
                  VOLUME
                </div>
                <div className="w-[100px] text-[10px] dark-mode-text-secondary text-right shrink-0">
                  VWAP
                </div>
                <div className="w-[60px] text-[10px] dark-mode-text-secondary text-right shrink-0">
                  TRADES
                </div>
              </div>
              {brr.buckets.map((bucket) => (
                <VWAPBar
                  key={bucket.intervalIndex}
                  bucket={bucket}
                  maxVolume={maxVolume}
                />
              ))}

              {/* Summary row */}
              <div className="flex items-center gap-3 pt-3 mt-2 border-t dark-mode-border">
                <div className="w-8 shrink-0" />
                <div className="w-[110px] text-xs font-semibold shrink-0">
                  BRR RESULT
                </div>
                <div className="flex-1" />
                <div className="w-[100px] text-right text-sm font-bold font-mono text-[var(--accent-green)] shrink-0">
                  ${formatPrice(brr.brr)}
                </div>
                <div className="w-[60px] text-right text-xs dark-mode-text-secondary shrink-0 font-mono">
                  {brr.totalTrades.toLocaleString()}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer note */}
        <div className="text-xs dark-mode-text-secondary text-center pb-4">
          Data source: Binance Futures aggregated trades · Recalculated every 3 seconds
          {lastUpdate > 0 && (
            <span> · Last update: {formatTime(lastUpdate)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
