"use client";

import { useEffect } from "react";
import { useMarketStore } from "@/store";

export function DynamicTitle() {
  const candles = useMarketStore((s) => s.candles);
  const lastPrice = candles[candles.length - 1]?.close;
  
  useEffect(() => {
    if (lastPrice) {
      document.title = `$${lastPrice.toFixed(2)}`;
    } else {
      document.title = "Pooleno Trading App";
    }
  }, [lastPrice]);
  
  return null;
}

