import type { CandlestickData } from "lightweight-charts";
import { detectSwingPoints, type SwingPoint } from "./price-action";

// ═══════════════════════════════════════════════════════════════════════════════
// MULTI-TIMEFRAME FLOOR & CEILING DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Types ──────────────────────────────────────────────────────────────────

export type FloorCeilingLevel = {
  price: number;
  type: 'floor' | 'ceiling';
  strength: number;              // 0-100 (based on touches, recency, confluence)
  touches: number;               // number of times price tested this level
  firstSeen: number;             // timestamp of first touch
  lastSeen: number;              // timestamp of most recent touch
  zone: { high: number; low: number }; // price range of this zone
  broken: boolean;               // has price closed beyond this level?
  source: 'swing' | 'cluster' | 'round-number' | 'wick-rejection';
  distanceFromPrice: number;     // absolute distance from current price
  distancePct: number;           // percentage distance from current price
};

export type TimeframeFloorCeiling = {
  tf: string;                    // "1m" | "5m" | "15m" | "30m" | "1h" | "4h"
  floors: FloorCeilingLevel[];   // sorted by price descending (nearest first)
  ceilings: FloorCeilingLevel[]; // sorted by price ascending (nearest first)
  strongestFloor: FloorCeilingLevel | null;
  strongestCeiling: FloorCeilingLevel | null;
  nearestFloor: FloorCeilingLevel | null;
  nearestCeiling: FloorCeilingLevel | null;
  range: { high: number; low: number }; // trading range for this TF
  midPoint: number;              // middle of the range
  currentPosition: 'near-floor' | 'near-ceiling' | 'mid-range'; // where price is
  candleCount: number;           // how many candles were used for this TF
  dataSource: 'resampled' | 'fetched'; // was data resampled or fetched directly?
};

export type FloorCeilingAnalysis = {
  timeframes: TimeframeFloorCeiling[];
  // Cross-TF confluence: levels that appear on multiple timeframes
  confluenceLevels: ConfluentLevel[];
  // Summary
  globalFloor: number | null;    // strongest floor across all TFs
  globalCeiling: number | null;  // strongest ceiling across all TFs
  currentPrice: number;
  priceInRange: number;          // 0 (at floor) to 100 (at ceiling)
  bias: 'near-floor-bounce' | 'near-ceiling-reject' | 'mid-range' | 'breakout-up' | 'breakdown';
};

export type ConfluentLevel = {
  price: number;
  type: 'floor' | 'ceiling';
  timeframes: string[];          // which TFs agree on this level
  confluenceScore: number;       // more TFs = higher score (0-100)
  avgStrength: number;           // average strength across TFs
};

/**
 * Map of timeframe → candle array for pre-fetched higher-TF data.
 * e.g. { '30m': [...], '1h': [...], '4h': [...] }
 */
export type HTFCandleMap = Record<string, CandlestickData[]>;

// ─── Configuration ──────────────────────────────────────────────────────────

type FloorCeilingConfig = {
  clusterTolerancePct: number;   // how close prices need to be to form a cluster (% of price)
  maxLevelsPerTf: number;        // max floors/ceilings to return per timeframe
  minTouches: number;            // minimum touches to consider a level valid
  roundNumberFilter: boolean;    // detect psychological round numbers
  recencyWeight: number;         // how much recent touches matter (0-1)
};

const DEFAULT_CONFIG: FloorCeilingConfig = {
  clusterTolerancePct: 0.15,
  maxLevelsPerTf: 8,
  minTouches: 1,
  roundNumberFilter: true,
  recencyWeight: 0.6,
};

// All timeframes we want to show, in order
const ALL_TIMEFRAMES: { tf: string; minutes: number }[] = [
  { tf: '1m', minutes: 1 },
  { tf: '5m', minutes: 5 },
  { tf: '15m', minutes: 15 },
  { tf: '30m', minutes: 30 },
  { tf: '1h', minutes: 60 },
  { tf: '4h', minutes: 240 },
];

// ─── Timeframe Resample ─────────────────────────────────────────────────────

function resampleCandles(candles: CandlestickData[], factor: number): CandlestickData[] {
  if (factor <= 1 || candles.length < factor) return candles;
  const resampled: CandlestickData[] = [];
  for (let i = 0; i <= candles.length - factor; i += factor) {
    const slice = candles.slice(i, i + factor);
    const open = slice[0].open;
    const close = slice[slice.length - 1].close;
    const high = Math.max(...slice.map(c => c.high));
    const low = Math.min(...slice.map(c => c.low));
    const time = slice[slice.length - 1].time;
    resampled.push({ open, high, low, close, time });
  }
  return resampled;
}

// ─── Core Level Detection ───────────────────────────────────────────────────

/**
 * Detect wick-rejection levels: where price touched a level but was rejected
 * (long upper wicks = ceiling rejections, long lower wicks = floor rejections)
 */
function detectWickRejections(candles: CandlestickData[], lookback: number = 50): SwingPoint[] {
  const rejections: SwingPoint[] = [];
  const recent = candles.slice(-lookback);

  for (let i = 0; i < recent.length; i++) {
    const c = recent[i];
    const body = Math.abs(c.close - c.open);
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const totalRange = c.high - c.low;

    if (totalRange === 0) continue;

    // Upper wick rejection (ceiling): upper wick > 60% of total range
    if (upperWick > totalRange * 0.6 && upperWick > body * 1.5) {
      rejections.push({
        index: candles.length - lookback + i,
        time: c.time as number,
        price: c.high,
        type: 'high',
      });
    }

    // Lower wick rejection (floor): lower wick > 60% of total range
    if (lowerWick > totalRange * 0.6 && lowerWick > body * 1.5) {
      rejections.push({
        index: candles.length - lookback + i,
        time: c.time as number,
        price: c.low,
        type: 'low',
      });
    }
  }

  return rejections;
}

/**
 * Detect round-number psychological levels near current price
 */
function detectRoundNumbers(currentPrice: number): { price: number; type: 'floor' | 'ceiling' }[] {
  const levels: { price: number; type: 'floor' | 'ceiling' }[] = [];

  // Determine appropriate round-number intervals based on price magnitude
  let intervals: number[];
  if (currentPrice >= 50000) {
    intervals = [1000, 5000, 10000];
  } else if (currentPrice >= 10000) {
    intervals = [500, 1000, 5000];
  } else if (currentPrice >= 1000) {
    intervals = [50, 100, 500];
  } else if (currentPrice >= 100) {
    intervals = [5, 10, 50];
  } else if (currentPrice >= 10) {
    intervals = [1, 5, 10];
  } else {
    intervals = [0.1, 0.5, 1];
  }

  for (const interval of intervals) {
    const below = Math.floor(currentPrice / interval) * interval;
    const above = Math.ceil(currentPrice / interval) * interval;

    if (below < currentPrice && below > 0) {
      levels.push({ price: below, type: 'floor' });
    }
    if (above > currentPrice) {
      levels.push({ price: above, type: 'ceiling' });
    }
  }

  // Deduplicate
  const seen = new Set<number>();
  return levels.filter(l => {
    if (seen.has(l.price)) return false;
    seen.add(l.price);
    return true;
  });
}

/**
 * Cluster nearby price levels together into zones
 */
function clusterLevels(
  points: { price: number; time: number; type: 'high' | 'low'; source: string }[],
  tolerancePct: number,
): { avgPrice: number; high: number; low: number; touches: number; firstSeen: number; lastSeen: number; type: 'high' | 'low'; source: string }[] {
  if (points.length === 0) return [];

  const sorted = [...points].sort((a, b) => a.price - b.price);
  const clusters: typeof points[] = [];
  const used = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    const cluster = [sorted[i]];
    used.add(i);

    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      const diff = Math.abs(sorted[j].price - sorted[i].price) / sorted[i].price * 100;
      if (diff <= tolerancePct) {
        cluster.push(sorted[j]);
        used.add(j);
      }
    }
    clusters.push(cluster);
  }

  return clusters.map(cluster => {
    const prices = cluster.map(p => p.price);
    const times = cluster.map(p => p.time);
    return {
      avgPrice: prices.reduce((a, b) => a + b, 0) / prices.length,
      high: Math.max(...prices),
      low: Math.min(...prices),
      touches: cluster.length,
      firstSeen: Math.min(...times),
      lastSeen: Math.max(...times),
      type: cluster[0].type, // predominant type
      source: cluster.length > 1 ? 'cluster' : cluster[0].source,
    };
  });
}

/**
 * Analyze a single timeframe to find floor and ceiling levels
 */
function analyzeTimeframe(
  candles: CandlestickData[],
  tf: string,
  currentPrice: number,
  config: FloorCeilingConfig,
  dataSource: 'resampled' | 'fetched' = 'resampled',
): TimeframeFloorCeiling {
  const empty: TimeframeFloorCeiling = {
    tf,
    floors: [],
    ceilings: [],
    strongestFloor: null,
    strongestCeiling: null,
    nearestFloor: null,
    nearestCeiling: null,
    range: { high: 0, low: 0 },
    midPoint: 0,
    currentPosition: 'mid-range',
    candleCount: 0,
    dataSource,
  };

  if (candles.length < 10) return empty;

  // ── 1. Detect swing points ──
  // Adapt left/right bars to timeframe: higher TFs can use fewer bars
  const leftBars = Math.max(2, Math.min(5, Math.floor(candles.length / 20)));
  const rightBars = leftBars;
  const swings = detectSwingPoints(candles, leftBars, rightBars);

  // ── 2. Detect wick rejections ──
  const wickRejections = detectWickRejections(candles, Math.min(candles.length, 100));

  // ── 3. Combine all raw price levels ──
  const allHighs: { price: number; time: number; type: 'high' | 'low'; source: string }[] = [];
  const allLows: { price: number; time: number; type: 'high' | 'low'; source: string }[] = [];

  for (const s of swings) {
    if (s.type === 'high') {
      allHighs.push({ price: s.price, time: s.time, type: 'high', source: 'swing' });
    } else {
      allLows.push({ price: s.price, time: s.time, type: 'low', source: 'swing' });
    }
  }

  for (const w of wickRejections) {
    if (w.type === 'high') {
      allHighs.push({ price: w.price, time: w.time, type: 'high', source: 'wick-rejection' });
    } else {
      allLows.push({ price: w.price, time: w.time, type: 'low', source: 'wick-rejection' });
    }
  }

  // ── 4. Cluster into zones ──
  const ceilingClusters = clusterLevels(allHighs, config.clusterTolerancePct);
  const floorClusters = clusterLevels(allLows, config.clusterTolerancePct);

  const totalTime = candles.length > 1
    ? (candles[candles.length - 1].time as number) - (candles[0].time as number)
    : 1;

  // ── 5. Build floor/ceiling levels with strength scoring ──
  const buildLevel = (
    cluster: typeof ceilingClusters[0],
    type: 'floor' | 'ceiling',
  ): FloorCeilingLevel => {
    const dist = Math.abs(currentPrice - cluster.avgPrice);
    const distPct = currentPrice > 0 ? (dist / currentPrice) * 100 : 0;

    // Recency score: 0-1, recent = higher
    const recencyNorm = totalTime > 0
      ? (cluster.lastSeen - (candles[0].time as number)) / totalTime
      : 0.5;

    // Check if level has been broken
    const broken = type === 'floor'
      ? candles.some(c => c.close < cluster.low * 0.999)
      : candles.some(c => c.close > cluster.high * 1.001);

    // Strength formula: touches + recency + unbroken bonus
    let strength = 0;
    strength += Math.min(40, cluster.touches * 15);  // touches (up to 40)
    strength += recencyNorm * config.recencyWeight * 35; // recency (up to ~21)
    if (!broken) strength += 20;                       // unbroken bonus
    if (cluster.source === 'cluster') strength += 10;  // multi-source bonus
    strength = Math.min(100, Math.max(0, strength));

    return {
      price: cluster.avgPrice,
      type,
      strength,
      touches: cluster.touches,
      firstSeen: cluster.firstSeen,
      lastSeen: cluster.lastSeen,
      zone: { high: cluster.high, low: cluster.low },
      broken,
      source: cluster.source as FloorCeilingLevel['source'],
      distanceFromPrice: dist,
      distancePct: distPct,
    };
  };

  // Build and filter floors (levels below current price)
  const floors = floorClusters
    .filter(c => c.avgPrice < currentPrice)
    .map(c => buildLevel(c, 'floor'))
    .filter(l => l.touches >= config.minTouches)
    .sort((a, b) => b.price - a.price) // nearest first
    .slice(0, config.maxLevelsPerTf);

  // Build and filter ceilings (levels above current price)
  const ceilings = ceilingClusters
    .filter(c => c.avgPrice > currentPrice)
    .map(c => buildLevel(c, 'ceiling'))
    .filter(l => l.touches >= config.minTouches)
    .sort((a, b) => a.price - b.price) // nearest first
    .slice(0, config.maxLevelsPerTf);

  // ── 6. Find strongest and nearest ──
  const strongestFloor = floors.length > 0
    ? floors.reduce((best, f) => f.strength > best.strength ? f : best)
    : null;
  const strongestCeiling = ceilings.length > 0
    ? ceilings.reduce((best, c) => c.strength > best.strength ? c : best)
    : null;
  const nearestFloor = floors.length > 0 ? floors[0] : null;
  const nearestCeiling = ceilings.length > 0 ? ceilings[0] : null;

  // ── 7. Range and position ──
  const rangeHigh = ceilings.length > 0 ? Math.max(...ceilings.map(c => c.price)) : currentPrice * 1.01;
  const rangeLow = floors.length > 0 ? Math.min(...floors.map(f => f.price)) : currentPrice * 0.99;
  const midPoint = (rangeHigh + rangeLow) / 2;
  const range = rangeHigh - rangeLow;

  let currentPosition: 'near-floor' | 'near-ceiling' | 'mid-range' = 'mid-range';
  if (range > 0) {
    const posInRange = (currentPrice - rangeLow) / range;
    if (posInRange <= 0.25) currentPosition = 'near-floor';
    else if (posInRange >= 0.75) currentPosition = 'near-ceiling';
  }

  return {
    tf,
    floors,
    ceilings,
    strongestFloor,
    strongestCeiling,
    nearestFloor,
    nearestCeiling,
    range: { high: rangeHigh, low: rangeLow },
    midPoint,
    currentPosition,
    candleCount: candles.length,
    dataSource,
  };
}

// ─── Cross-Timeframe Confluence ─────────────────────────────────────────────

function findConfluentLevels(
  timeframes: TimeframeFloorCeiling[],
  tolerancePct: number,
): ConfluentLevel[] {
  const allLevels: { price: number; type: 'floor' | 'ceiling'; tf: string; strength: number }[] = [];

  for (const tfData of timeframes) {
    for (const f of tfData.floors) {
      allLevels.push({ price: f.price, type: 'floor', tf: tfData.tf, strength: f.strength });
    }
    for (const c of tfData.ceilings) {
      allLevels.push({ price: c.price, type: 'ceiling', tf: tfData.tf, strength: c.strength });
    }
  }

  if (allLevels.length === 0) return [];

  // Group by similar price
  const used = new Set<number>();
  const confluent: ConfluentLevel[] = [];

  for (let i = 0; i < allLevels.length; i++) {
    if (used.has(i)) continue;
    const group = [allLevels[i]];
    used.add(i);

    for (let j = i + 1; j < allLevels.length; j++) {
      if (used.has(j)) continue;
      // Only group same-type levels
      if (allLevels[j].type !== allLevels[i].type) continue;
      const diff = Math.abs(allLevels[j].price - allLevels[i].price) / allLevels[i].price * 100;
      if (diff <= tolerancePct * 2) { // slightly wider tolerance for cross-TF
        group.push(allLevels[j]);
        used.add(j);
      }
    }

    // Only count if multiple timeframes agree
    const uniqueTFs = [...new Set(group.map(g => g.tf))];
    if (uniqueTFs.length >= 2) {
      const avgPrice = group.reduce((s, g) => s + g.price, 0) / group.length;
      const avgStrength = group.reduce((s, g) => s + g.strength, 0) / group.length;
      const confluenceScore = Math.min(100, (uniqueTFs.length / timeframes.length) * 80 + avgStrength * 0.2);

      confluent.push({
        price: avgPrice,
        type: group[0].type,
        timeframes: uniqueTFs,
        confluenceScore,
        avgStrength,
      });
    }
  }

  return confluent.sort((a, b) => b.confluenceScore - a.confluenceScore);
}

// ─── Master Analysis Function ───────────────────────────────────────────────

/**
 * Analyze floor (support) and ceiling (resistance) levels across multiple timeframes.
 *
 * For the base timeframe and small multiples (e.g. 1m→5m, 1m→15m) we resample.
 * For higher timeframes (30m, 1h, 4h) where resampling doesn't produce enough candles,
 * pass them in `htfCandles` (pre-fetched from Binance).
 *
 * @param candles - Base-timeframe candles from the store
 * @param baseInterval - The base interval string (e.g. "1m", "5m", etc.)
 * @param htfCandles - Optional map of TF→candles for higher timeframes fetched directly
 * @param config - Optional configuration overrides
 */
export function analyzeFloorsCeilings(
  candles: CandlestickData[],
  baseInterval: string = '1m',
  htfCandles: HTFCandleMap = {},
  config: Partial<FloorCeilingConfig> = {},
): FloorCeilingAnalysis {
  const cfg: FloorCeilingConfig = { ...DEFAULT_CONFIG, ...config };

  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;

  // ── Determine resample factors from base interval ──
  const baseMinutes = intervalToMinutes(baseInterval);

  const timeframes: TimeframeFloorCeiling[] = [];

  for (const target of ALL_TIMEFRAMES) {
    // Check if we have pre-fetched candles for this TF
    if (htfCandles[target.tf] && htfCandles[target.tf].length >= 10) {
      const tfResult = analyzeTimeframe(htfCandles[target.tf], target.tf, currentPrice, cfg, 'fetched');
      timeframes.push(tfResult);
      continue;
    }

    // Otherwise try to resample from base candles
    const factor = Math.round(target.minutes / baseMinutes);
    if (factor < 1) continue; // skip TFs smaller than base

    const resampled = factor === 1 ? candles : resampleCandles(candles, factor);
    if (resampled.length < 10) continue; // not enough data after resample — skip

    const tfResult = analyzeTimeframe(resampled, target.tf, currentPrice, cfg, factor === 1 ? 'fetched' : 'resampled');
    timeframes.push(tfResult);
  }

  // ── Add round-number levels if enabled ──
  if (cfg.roundNumberFilter && currentPrice > 0 && timeframes.length > 0) {
    const roundLevels = detectRoundNumbers(currentPrice);
    for (const rl of roundLevels) {
      const dist = Math.abs(currentPrice - rl.price);
      const distPct = (dist / currentPrice) * 100;

      // Only add round numbers within 3% of current price
      if (distPct > 3) continue;

      const level: FloorCeilingLevel = {
        price: rl.price,
        type: rl.type,
        strength: 30 + Math.max(0, 30 - distPct * 10), // closer = stronger
        touches: 0,
        firstSeen: 0,
        lastSeen: 0,
        zone: { high: rl.price, low: rl.price },
        broken: false,
        source: 'round-number',
        distanceFromPrice: dist,
        distancePct: distPct,
      };

      // Add to all timeframes
      for (const tf of timeframes) {
        if (rl.type === 'floor') {
          tf.floors.push(level);
          tf.floors.sort((a, b) => b.price - a.price);
        } else {
          tf.ceilings.push(level);
          tf.ceilings.sort((a, b) => a.price - b.price);
        }
      }
    }
  }

  // ── Cross-TF confluence ──
  const confluenceLevels = findConfluentLevels(timeframes, cfg.clusterTolerancePct);

  // ── Global strongest floor/ceiling ──
  // Weight higher TFs more heavily for global levels
  const tfWeightMap: Record<string, number> = {
    '1m': 0.5, '5m': 0.7, '15m': 0.9, '30m': 1.1, '1h': 1.3, '4h': 1.5,
  };

  let globalFloor: number | null = null;
  let globalCeiling: number | null = null;
  let maxFloorScore = 0;
  let maxCeilingScore = 0;

  for (const tf of timeframes) {
    const w = tfWeightMap[tf.tf] ?? 1;
    if (tf.strongestFloor) {
      const score = tf.strongestFloor.strength * w;
      if (score > maxFloorScore) {
        maxFloorScore = score;
        globalFloor = tf.strongestFloor.price;
      }
    }
    if (tf.strongestCeiling) {
      const score = tf.strongestCeiling.strength * w;
      if (score > maxCeilingScore) {
        maxCeilingScore = score;
        globalCeiling = tf.strongestCeiling.price;
      }
    }
  }

  // Boost with confluence
  for (const cl of confluenceLevels) {
    if (cl.type === 'floor' && cl.confluenceScore > maxFloorScore) {
      globalFloor = cl.price;
    }
    if (cl.type === 'ceiling' && cl.confluenceScore > maxCeilingScore) {
      globalCeiling = cl.price;
    }
  }

  // ── Price position in range ──
  const rangeSize = (globalCeiling ?? currentPrice * 1.01) - (globalFloor ?? currentPrice * 0.99);
  const priceInRange = rangeSize > 0
    ? ((currentPrice - (globalFloor ?? currentPrice * 0.99)) / rangeSize) * 100
    : 50;

  // ── Bias ──
  let bias: FloorCeilingAnalysis['bias'] = 'mid-range';
  if (priceInRange <= 15) bias = 'near-floor-bounce';
  else if (priceInRange >= 85) bias = 'near-ceiling-reject';
  else if (priceInRange > 100) bias = 'breakout-up';
  else if (priceInRange < 0) bias = 'breakdown';

  return {
    timeframes,
    confluenceLevels,
    globalFloor,
    globalCeiling,
    currentPrice,
    priceInRange: Math.max(0, Math.min(100, priceInRange)),
    bias,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function intervalToMinutes(interval: string): number {
  const match = interval.match(/^(\d+)([mhd]|w)$/);
  if (!match) return 1;
  const val = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 'm': return val;
    case 'h': return val * 60;
    case 'd': return val * 1440;
    case 'w': return val * 10080;
    default: return 1;
  }
}
