"use client";

import { useMemo, useState, useEffect } from "react";
import { useMarketStore } from "@/store";
import type { Position } from "@/store/slices/positions";
import { toast } from "sonner";

export default function PositionsPanel() {
  const positions = useMarketStore((s) => s.positions);
  const closePosition = useMarketStore((s) => s.closePosition);
  const candles = useMarketStore((s) => s.candles);
  const lastPrice = candles[candles.length - 1]?.close ?? 0;
  const [balances, setBalances] = useState({ USD: 10000 });

  useEffect(() => {
    try {
      const raw = localStorage.getItem('futures-balances');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.USD === 'number') {
          setBalances({ USD: parsed.USD });
        }
      }
    } catch {}
  }, []);

  const positionsWithPnL = useMemo(() => {
    return positions.map((pos) => {
      const priceDiff = lastPrice - pos.entryPrice;
      const pnl = pos.side === 'long' 
        ? (priceDiff * pos.size * pos.leverage)
        : (-priceDiff * pos.size * pos.leverage);
      const pnlPct = (pnl / pos.margin) * 100;
      return { ...pos, pnl, pnlPct, currentPrice: lastPrice };
    });
  }, [positions, lastPrice]);

  function handleClose(pos: Position) {
    const priceDiff = lastPrice - pos.entryPrice;
    const pnl = pos.side === 'long' 
      ? (priceDiff * pos.size * pos.leverage)
      : (-priceDiff * pos.size * pos.leverage);
    closePosition(pos.id);
    // Return margin + PnL
    setBalances((b) => {
      const newBal = b.USD + pos.margin + pnl;
      try { localStorage.setItem('futures-balances', JSON.stringify({ USD: newBal })); } catch {}
      return { USD: newBal };
    });
    toast.success('Position closed', { 
      description: `${pos.side.toUpperCase()} ${pos.size} @ ${pos.entryPrice.toFixed(2)} → PnL: ${pnl.toFixed(2)} USD` 
    });
  }

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 dark-mode-bg overflow-hidden">
      <header className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 dark-mode-bg">
        <h3 className="text-sm font-semibold dark-mode-text">Open Positions</h3>
      </header>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800 text-sm">
        {positionsWithPnL.length === 0 && (
          <div className="px-3 py-3 text-zinc-500 dark:text-zinc-400">No open positions.</div>
        )}
        {positionsWithPnL.map((p) => (
          <div key={p.id} className="px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`px-2 py-0.5 rounded text-xs ${p.side==='long'?'bg-emerald-600 text-white':'bg-rose-600 text-white'}`}>
                {p.side.toUpperCase()}
              </span>
              <div className="flex flex-col">
                <span className="font-mono tabular-nums dark-mode-text">{p.size} {p.symbol.slice(0,3)}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Entry: {p.entryPrice.toFixed(2)} | {p.leverage}x
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className={`font-mono tabular-nums ${p.pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {p.pnl >= 0 ? '+' : ''}{p.pnl.toFixed(2)} USD
                </div>
                <div className={`text-xs ${p.pnlPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(2)}%
                </div>
              </div>
              <button
                className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => handleClose(p)}
              >
                Close
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

