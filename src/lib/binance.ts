export type BinanceSymbol = string; // e.g. "BTCUSDT"

// WebSocket endpoints
export function tradeWsUrl(symbol: BinanceSymbol): string {
  return `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@trade`;
}

export function depthWsUrl(symbol: BinanceSymbol, speed: '100ms' | '1000ms' = '100ms'): string {
  return `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@depth@${speed}`;
}

// REST depth snapshot (for order book sync)
export function depthSnapshotUrl(symbol: BinanceSymbol, limit: 5 | 10 | 20 | 50 | 100 | 500 | 1000 = 1000): string {
  return `https://api.binance.com/api/v3/depth?symbol=${symbol.toUpperCase()}&limit=${limit}`;
}

export async function fetchDepthSnapshot(symbol: BinanceSymbol, limit: 5 | 10 | 20 | 50 | 100 | 500 | 1000 = 1000) {
  const res = await fetch(depthSnapshotUrl(symbol, limit));
  if (!res.ok) throw new Error(`Binance depth snapshot failed: ${res.status}`);
  return res.json();
}


