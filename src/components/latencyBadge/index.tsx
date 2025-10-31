"use client";
import { useMarketStore } from "@/store";

export function LatencyBadge() {
  const latency = useMarketStore((s) => s.latencyMs);
  if (latency == null) return null;
  const level = latency < 100 ? 'good' : latency < 300 ? 'warn' : 'bad';
  const bgClass = level === 'good'
    ? 'bg-emerald-500/10 border border-emerald-500/30'
    : level === 'warn'
    ? 'bg-amber-500/10 border border-amber-500/30'
    : 'bg-rose-500/10 border border-rose-500/30';
  const textClass = level === 'good'
    ? 'text-emerald-700 dark:text-emerald-300'
    : level === 'warn'
    ? 'text-amber-700 dark:text-amber-300'
    : 'text-rose-700 dark:text-rose-300';
  const value = Math.max(0, Math.round(latency));
  return (
    <div className={`flex items-center gap-1 rounded-md px-2 py-1 ${bgClass}`}>
      <span className={`text-xs font-medium ${textClass}`}>{value} ms</span>
    </div>
  );
}


