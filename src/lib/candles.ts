export type TradeInput = { price: number; qty: number; time: number };
export type Ohlc = { time: number; open: number; high: number; low: number; close: number };

// Aggregates trades to 1-minute OHLC buckets (time rounded down to minute, in seconds epoch)
export function aggregateTradesTo1m(trades: TradeInput[]): Ohlc[] {
  if (!Array.isArray(trades) || trades.length === 0) return [];
  const buckets = new Map<number, Ohlc>();
  for (const t of trades) {
    const minuteSec = Math.floor(t.time / 60000) * 60; // seconds for lightweight-charts compatibility
    const existing = buckets.get(minuteSec);
    if (!existing) {
      buckets.set(minuteSec, { time: minuteSec, open: t.price, high: t.price, low: t.price, close: t.price });
    } else {
      existing.high = Math.max(existing.high, t.price);
      existing.low = Math.min(existing.low, t.price);
      existing.close = t.price;
    }
  }
  const out = Array.from(buckets.values());
  out.sort((a, b) => a.time - b.time);
  return out;
}


