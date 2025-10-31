"use client";
import { useMarketStore } from "@/store";

export function StatusBadge() {
  const state = useMarketStore((s) => s.connectionState);
  const text = state === 'connected' ? 'Connected' : state === 'reconnecting' ? 'Reconnecting…' : state === 'connecting' ? 'Connecting…' : 'Disconnected';
  const dotColor = state === 'connected' ? 'bg-emerald-500' : state === 'reconnecting' ? 'bg-amber-500' : state === 'connecting' ? 'bg-sky-500' : 'bg-zinc-400';
  const bgClass = state === 'connected'
    ? 'bg-emerald-500/10 border border-emerald-500/30'
    : state === 'reconnecting'
    ? 'bg-amber-500/10 border border-amber-500/30'
    : state === 'connecting'
    ? 'bg-sky-500/10 border border-sky-500/30'
    : 'bg-zinc-500/10 border border-zinc-500/20';
  const textClass = state === 'connected'
    ? 'text-emerald-700 dark:text-emerald-300'
    : state === 'reconnecting'
    ? 'text-amber-700 dark:text-amber-300'
    : state === 'connecting'
    ? 'text-sky-700 dark:text-sky-300'
    : 'text-zinc-700 dark:text-zinc-300';
  return (
    <div className={`flex items-center gap-2 rounded-md px-2 py-1 ${bgClass}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${dotColor}`} />
      <span className={`text-xs ${textClass}`}>{text}</span>
    </div>
  );
}


