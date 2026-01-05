"use client";

import { useMarketStore } from "@/store";

export function HeaderPrice() {
  const candles = useMarketStore((s) => s.candles);
  const lastPrice = candles[candles.length - 1]?.close;
  
  if (!lastPrice) return null;
  
  return (
    <span className="font-mono tabular-nums text-sm dark-mode-text-secondary">
      ${lastPrice.toFixed(2)}
    </span>
  );
}

