"use client";

import { startKlines, stopKlines } from "@/store/actions/candles";
import { useMarketStore } from "@/store";

export default function TimeframeButtons() {
  const interval = useMarketStore((s) => s.interval);
  const setIntervalVal = useMarketStore((s) => s.setInterval);
  const symbol = useMarketStore((s) => s.symbol);
  const frames = ["1m","3m","5m","15m","30m","1h","4h","1d","1w"];

  function apply(next: string) {
    if (next === interval) return;
    setIntervalVal(next);
    stopKlines();
    startKlines(symbol, next);
  }

  return (
    <div className="flex items-center gap-1 bg-white/80 dark:bg-zinc-900/70 shadow rounded-md px-1 py-1 overflow-x-auto dark-mode-bg dark-mode-text">
      {frames.map((f) => {
        const active = f === interval;
        return (
          <button
            key={f}
            onClick={() => apply(f)}
            className={`h-7 px-2 rounded text-xs border transition-colors ${active ? "bg-sky-600 text-white border-sky-600" : "bg-white/90 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
            aria-pressed={active}
          >
            {f}
          </button>
        );
      })}
    </div>
  );
}


