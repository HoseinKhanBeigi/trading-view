export interface Trade {
  price: number;
  qty: number;
  time: number;
  isBuyerMaker: boolean;
}

export interface VWAPBucket {
  intervalIndex: number;
  startTime: number;
  endTime: number;
  vwap: number;
  totalVolume: number;
  tradeCount: number;
}

export interface BRRResult {
  brr: number;
  windowStart: number;
  windowEnd: number;
  buckets: VWAPBucket[];
  totalTrades: number;
  medianVwap: number;
  stdDev: number;
  spreadFromSpot: number;
}

const BRR_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const BUCKET_COUNT = 12;
const BUCKET_MS = 5 * 60 * 1000; // 5 minutes

function calcVWAP(trades: Trade[]): number {
  if (trades.length === 0) return 0;
  let sumPV = 0;
  let sumV = 0;
  for (const t of trades) {
    sumPV += t.price * t.qty;
    sumV += t.qty;
  }
  return sumV === 0 ? 0 : sumPV / sumV;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stddev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const sqDiffs = values.map((v) => (v - mean) ** 2);
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
}

export function calculateBRR(trades: Trade[], windowEnd?: number): BRRResult {
  const end = windowEnd ?? Date.now();
  const start = end - BRR_WINDOW_MS;

  const windowTrades = trades.filter((t) => t.time >= start && t.time < end);

  const buckets: VWAPBucket[] = [];
  for (let i = 0; i < BUCKET_COUNT; i++) {
    const bucketStart = start + i * BUCKET_MS;
    const bucketEnd = bucketStart + BUCKET_MS;
    const bucketTrades = windowTrades.filter(
      (t) => t.time >= bucketStart && t.time < bucketEnd
    );
    buckets.push({
      intervalIndex: i + 1,
      startTime: bucketStart,
      endTime: bucketEnd,
      vwap: calcVWAP(bucketTrades),
      totalVolume: bucketTrades.reduce((sum, t) => sum + t.qty, 0),
      tradeCount: bucketTrades.length,
    });
  }

  const validVwaps = buckets.filter((b) => b.vwap > 0).map((b) => b.vwap);
  const brr = validVwaps.length > 0
    ? validVwaps.reduce((a, b) => a + b, 0) / validVwaps.length
    : 0;

  const spotPrice = windowTrades.length > 0
    ? windowTrades[windowTrades.length - 1].price
    : 0;

  return {
    brr,
    windowStart: start,
    windowEnd: end,
    buckets,
    totalTrades: windowTrades.length,
    medianVwap: median(validVwaps),
    stdDev: stddev(validVwaps, brr),
    spreadFromSpot: spotPrice > 0 ? ((brr - spotPrice) / spotPrice) * 100 : 0,
  };
}

export async function fetchBinanceTrades(
  symbol: string,
  limitMs: number = BRR_WINDOW_MS
): Promise<Trade[]> {
  const endTime = Date.now();
  const startTime = endTime - limitMs;
  const url = `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${symbol.toUpperCase()}&startTime=${startTime}&endTime=${endTime}&limit=1000`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API error: ${res.status}`);

  const data = await res.json();
  return data.map((t: { p: string; q: string; T: number; m: boolean }) => ({
    price: parseFloat(t.p),
    qty: parseFloat(t.q),
    time: t.T,
    isBuyerMaker: t.m,
  }));
}
