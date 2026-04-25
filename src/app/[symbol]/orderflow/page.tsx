"use client";

import { useEffect } from "react";
import CandlesChart from "@/components/candles-chart";
import OrderBookPanel from "@/components/OrderBook";
import { useMarketStore } from "@/store";
import { useParams } from "next/navigation";
import { startKlines, stopKlines } from "@/store/actions/candles";
import TimeframeButtons from "@/components/Timeframe";
import Link from "next/link";

export default function OrderFlowPage() {
  const params = useParams();
  const sym = params.symbol as string;
  const setSymbol = useMarketStore((s) => s.setSymbol);
  const symbol = useMarketStore((s) => s.symbol);
  const interval = useMarketStore((s) => s.interval);

  useEffect(() => {
    if (!sym) return;
    setSymbol(sym);
    stopKlines();
    startKlines(sym, interval);
  }, [sym, setSymbol, interval]);

  return (
    <div className="bg-white dark:bg-zinc-950 dark-mode-bg dark-mode-text h-[calc(100vh-4rem)] flex flex-col">
      {/* ATAS-style top bar: symbol + interval + back */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
        <div className="flex items-center gap-4">
          <Link
            href={`/${(symbol || sym || "").toLowerCase()}`}
            className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
          >
            ← Dashboard
          </Link>
          <span className="font-mono font-semibold text-zinc-900 dark:text-white">
            {(symbol || sym || "").toUpperCase()}
          </span>
          <TimeframeButtons />
        </div>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Order Flow · DOM + Chart
        </span>
      </div>

      {/* Main: DOM left, Chart right — like ATAS */}
      <div className="flex-1 flex min-h-0">
        <aside className="flex-shrink-0 w-[320px] lg:w-[360px] border-r border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col bg-white dark:bg-zinc-950">
          <OrderBookPanel compact levels={35} />
        </aside>
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <CandlesChart orderFlowMode />
        </main>
      </div>
    </div>
  );
}
