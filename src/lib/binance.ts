export type BinanceSymbol = string; // e.g. "BTCUSDT"

// WebSocket endpoints (Futures)
export function tradeWsUrl(symbol: BinanceSymbol): string {
  return `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@trade`;
}

export function depthWsUrl(symbol: BinanceSymbol, speed: '100ms' | '1000ms' = '100ms'): string {
  return `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@depth@${speed}`;
}

// REST depth snapshot (for order book sync) - Futures
export function depthSnapshotUrl(symbol: BinanceSymbol, limit: 5 | 10 | 20 | 50 | 100 | 500 | 1000 = 1000): string {
  return `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol.toUpperCase()}&limit=${limit}`;
}

export async function fetchDepthSnapshot(symbol: BinanceSymbol, limit: 5 | 10 | 20 | 50 | 100 | 500 | 1000 = 1000) {
  const res = await fetch(depthSnapshotUrl(symbol, limit));
  if (!res.ok) throw new Error(`Binance depth snapshot failed: ${res.status}`);
  return res.json();
}

// ─── Kline (candle) fetching for any timeframe ──────────────────────────────

export type BinanceInterval = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1M';

export function klineRestUrl(symbol: BinanceSymbol, interval: BinanceInterval, limit: number = 500): string {
  const u = new URL("https://fapi.binance.com/fapi/v1/klines");
  u.searchParams.set("symbol", symbol.toUpperCase());
  u.searchParams.set("interval", interval);
  u.searchParams.set("limit", String(limit));
  return u.toString();
}

/**
 * Fetch klines (candles) from Binance Futures REST API for any timeframe.
 * Returns lightweight-charts compatible CandlestickData[].
 */
export async function fetchKlines(
  symbol: BinanceSymbol,
  interval: BinanceInterval,
  limit: number = 500,
): Promise<{ time: number; open: number; high: number; low: number; close: number }[]> {
  const res = await fetch(klineRestUrl(symbol, interval, limit));
  if (!res.ok) throw new Error(`Binance klines fetch failed: ${res.status}`);
  const raw: any[] = await res.json();
  return raw.map((k) => ({
    time: Math.floor(k[0] / 1000),  // seconds epoch for lightweight-charts
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
  }));
}
