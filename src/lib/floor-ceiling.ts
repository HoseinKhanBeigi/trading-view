import type { CandlestickData } from "lightweight-charts";
import { detectSwingPoints, type SwingPoint } from "./price-action";
import { ema, rsi, atr as calcATR } from "./indicators";
import { detectAllCandlestickPatterns, type CandlestickPattern } from "./candlestick-patterns";

// ═══════════════════════════════════════════════════════════════════════════════
// MULTI-TIMEFRAME FLOOR & CEILING DETECTION + BREAK PREDICTION
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

// ─── Break Prediction Types ────────────────────────────────────────────────

export type BreakPrediction = {
  level: FloorCeilingLevel;
  tf: string;                    // which timeframe this level belongs to
  breakProbability: number;      // 0-100 (100 = very likely to break)
  holdProbability: number;       // 0-100 (100 = very likely to hold)
  verdict: 'LIKELY BREAK' | 'LIKELY HOLD' | 'UNCERTAIN';
  confidence: number;            // 0-100 how confident the prediction is
  factors: BreakFactor[];        // individual factors that contribute
  eta: string;                   // estimated "time to test" label (e.g. "~5 candles")
};

export type BreakFactor = {
  name: string;
  value: number;                 // -1 (strong hold) to +1 (strong break)
  weight: number;                // importance 0-1
  detail: string;                // human-readable explanation
};

export type BreakPredictionSummary = {
  predictions: BreakPrediction[];         // all predictions, sorted by break probability
  mostLikelyBreak: BreakPrediction | null;  // the level most likely to break next
  mostLikelyHold: BreakPrediction | null;   // the strongest level (most likely to hold)
  nearestFloorPrediction: BreakPrediction | null;
  nearestCeilingPrediction: BreakPrediction | null;
  overallBias: 'breaking-up' | 'breaking-down' | 'range-bound' | 'indeterminate';
  biasSummary: string;           // human-readable prediction summary
};

// ─── Level Entry Signal Types ──────────────────────────────────────────────

export type LevelSignalType =
  | 'BOUNCE_LONG'       // Price at strong floor + bullish confirmation → BUY
  | 'BOUNCE_SHORT'      // Price at strong ceiling + bearish confirmation → SELL
  | 'BREAKOUT_LONG'     // Price breaks above ceiling + strong momentum → BUY
  | 'BREAKDOWN_SHORT';  // Price breaks below floor + strong momentum → SELL

export type LevelSignal = {
  id: string;                    // unique id for dedup
  type: LevelSignalType;
  direction: 'LONG' | 'SHORT';
  grade: 'A+' | 'A' | 'B' | 'C';  // quality grade
  level: FloorCeilingLevel;      // the floor/ceiling involved
  tf: string;                    // timeframe of the level
  entry: number;                 // suggested entry price
  stopLoss: number;              // stop-loss price
  takeProfit: number;            // primary take-profit
  takeProfit2: number | null;    // secondary TP
  riskReward: number;            // risk:reward ratio
  confidence: number;            // 0-100
  confirmationPattern: string;   // candle pattern that confirmed (e.g. "Hammer", "Bullish Engulfing")
  breakPrediction: BreakPrediction | null; // associated break prediction
  reasons: string[];             // human-readable list of why this signal fired
  timestamp: number;             // when signal was generated
  price: number;                 // current price at signal time
  active: boolean;               // still valid?
  invalidationPrice: number;     // price that invalidates signal
};

export type LevelSignalSummary = {
  signals: LevelSignal[];        // active signals sorted by grade
  bestSignal: LevelSignal | null;  // highest grade signal
  activeCount: number;
  longCount: number;
  shortCount: number;
};

// ─── Main Types ────────────────────────────────────────────────────────────

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
  // Break predictions
  breakPredictions: BreakPredictionSummary;
  // Entry signals
  levelSignals: LevelSignalSummary;
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

// ═══════════════════════════════════════════════════════════════════════════════
// BREAK PREDICTION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Predict whether each floor/ceiling is likely to BREAK or HOLD.
 *
 * Scoring factors:
 *   1. Momentum toward level    — EMA slope + ROC direction
 *   2. Proximity                — Closer = more imminent, needs less energy
 *   3. Volatility expansion     — Rising ATR = bigger moves coming
 *   4. Touch fatigue            — More touches = weaker (orders absorbed)
 *   5. Range compression        — Narrowing candle ranges = pressure build
 *   6. Level strength (inverse) — Weak levels break easier
 *   7. Previously broken        — Broken-and-reclaimed levels are weaker
 *   8. RSI extreme              — Overbought approaching ceiling → higher break chance
 *   9. Cross-TF confluence      — Multi-TF levels are harder to break
 */
function predictBreaks(
  candles: CandlestickData[],
  timeframes: TimeframeFloorCeiling[],
  confluenceLevels: ConfluentLevel[],
  htfCandles: HTFCandleMap,
): BreakPredictionSummary {
  const empty: BreakPredictionSummary = {
    predictions: [],
    mostLikelyBreak: null,
    mostLikelyHold: null,
    nearestFloorPrediction: null,
    nearestCeilingPrediction: null,
    overallBias: 'indeterminate',
    biasSummary: 'Not enough data for break prediction',
  };

  if (candles.length < 20) return empty;

  const currentPrice = candles[candles.length - 1].close;
  const closes = candles.map(c => c.close);

  // ── Pre-compute indicators on base candles ──
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const rsiValues = rsi(closes, 14);
  const atrValues = calcATR(candles, 14);
  const last = candles.length - 1;

  const currentEma9 = ema9[last] ?? currentPrice;
  const currentEma21 = ema21[last] ?? currentPrice;
  const prevEma9 = ema9[last - 1] ?? currentPrice;
  const currentRSI = rsiValues[last] ?? 50;
  const currentATR = atrValues[last] ?? 0;
  const prevATR = atrValues[last - 5] ?? currentATR;

  // EMA slope (normalized): positive = price moving up
  const emaSlope = currentPrice > 0 ? (currentEma9 - prevEma9) / currentPrice * 1000 : 0;

  // Trend direction: above EMA21 = bullish
  const trendBias = currentEma9 > currentEma21 ? 1 : currentEma9 < currentEma21 ? -1 : 0;

  // ATR expansion ratio: >1 means volatility is increasing
  const atrExpansion = prevATR > 0 ? currentATR / prevATR : 1;

  // Range compression: compare last 5 candle ranges to previous 10
  const recentRanges = candles.slice(-5).map(c => c.high - c.low);
  const olderRanges = candles.slice(-15, -5).map(c => c.high - c.low);
  const avgRecentRange = recentRanges.reduce((s, r) => s + r, 0) / (recentRanges.length || 1);
  const avgOlderRange = olderRanges.reduce((s, r) => s + r, 0) / (olderRanges.length || 1);
  const rangeCompression = avgOlderRange > 0 ? avgRecentRange / avgOlderRange : 1;

  // Build set of confluent-level prices for quick lookup
  const confluentPrices = new Map<string, ConfluentLevel>();
  for (const cl of confluenceLevels) {
    confluentPrices.set(`${cl.type}-${cl.price.toFixed(2)}`, cl);
  }

  const predictions: BreakPrediction[] = [];

  for (const tfData of timeframes) {
    // Get candles for this timeframe (for TF-specific momentum)
    const tfCandles = htfCandles[tfData.tf] ?? candles;
    const tfCloses = tfCandles.map(c => c.close);
    const tfEma9 = ema(tfCloses, 9);
    const tfLast = tfCandles.length - 1;
    const tfEmaSlope = tfLast > 0 && tfCandles[tfLast]?.close > 0
      ? ((tfEma9[tfLast] ?? 0) - (tfEma9[tfLast - 1] ?? 0)) / tfCandles[tfLast].close * 1000
      : emaSlope;

    const allLevels = [
      ...tfData.floors.slice(0, 3),
      ...tfData.ceilings.slice(0, 3),
    ];

    for (const level of allLevels) {
      const factors: BreakFactor[] = [];

      // ── Factor 1: Momentum toward level ──
      // For floor: negative momentum = moving toward it = more break risk
      // For ceiling: positive momentum = moving toward it = more break risk
      const momentumToward = level.type === 'floor'
        ? -tfEmaSlope  // negative slope means moving down toward floor
        : tfEmaSlope;  // positive slope means moving up toward ceiling
      const momentumNorm = Math.max(-1, Math.min(1, momentumToward / 2));
      factors.push({
        name: 'Momentum',
        value: momentumNorm,
        weight: 0.2,
        detail: momentumNorm > 0.3
          ? `Strong momentum toward ${level.type} (slope: ${tfEmaSlope.toFixed(2)})`
          : momentumNorm < -0.3
          ? `Moving away from ${level.type}`
          : `Neutral momentum`,
      });

      // ── Factor 2: Proximity ──
      // Closer levels are more at risk (less energy needed)
      const proxScore = level.distancePct < 0.1 ? 1
        : level.distancePct < 0.3 ? 0.7
        : level.distancePct < 0.5 ? 0.4
        : level.distancePct < 1.0 ? 0.1
        : -0.2;
      factors.push({
        name: 'Proximity',
        value: proxScore,
        weight: 0.15,
        detail: `${level.distancePct.toFixed(2)}% away (${proxScore > 0.5 ? 'very close' : proxScore > 0 ? 'nearby' : 'distant'})`,
      });

      // ── Factor 3: Volatility expansion ──
      const volFactor = atrExpansion > 1.3 ? 0.8
        : atrExpansion > 1.1 ? 0.4
        : atrExpansion > 0.9 ? 0
        : -0.4;
      factors.push({
        name: 'Volatility',
        value: volFactor,
        weight: 0.15,
        detail: atrExpansion > 1.2
          ? `ATR expanding ${((atrExpansion - 1) * 100).toFixed(0)}% — larger moves expected`
          : atrExpansion < 0.8
          ? `ATR contracting — level likely to hold`
          : `Normal volatility`,
      });

      // ── Factor 4: Touch fatigue ──
      // More touches = more order absorption = weaker level
      const touchFatigue = level.touches >= 5 ? 0.8
        : level.touches >= 3 ? 0.4
        : level.touches === 2 ? 0.1
        : -0.3; // first touch = strong
      factors.push({
        name: 'Touch Fatigue',
        value: touchFatigue,
        weight: 0.12,
        detail: `${level.touches} touch${level.touches !== 1 ? 'es' : ''} — ${
          level.touches >= 4 ? 'heavily tested, orders depleted' :
          level.touches >= 2 ? 'moderately tested' : 'fresh level'
        }`,
      });

      // ── Factor 5: Range compression (squeeze) ──
      const squeezeFactor = rangeCompression < 0.6 ? 0.8
        : rangeCompression < 0.8 ? 0.4
        : rangeCompression > 1.3 ? -0.2
        : 0;
      factors.push({
        name: 'Compression',
        value: squeezeFactor,
        weight: 0.1,
        detail: rangeCompression < 0.7
          ? `Range compressed ${((1 - rangeCompression) * 100).toFixed(0)}% — pressure building`
          : `Normal range activity`,
      });

      // ── Factor 6: Level strength (inverse) ──
      // Weak levels break easier
      const strengthInv = level.strength < 30 ? 0.7
        : level.strength < 50 ? 0.3
        : level.strength < 70 ? -0.1
        : level.strength < 85 ? -0.4
        : -0.8;
      factors.push({
        name: 'Level Weakness',
        value: strengthInv,
        weight: 0.1,
        detail: `Strength ${level.strength.toFixed(0)} — ${
          level.strength >= 70 ? 'strong, hard to break' :
          level.strength >= 40 ? 'moderate' : 'weak, easy to break'
        }`,
      });

      // ── Factor 7: Previously broken ──
      const brokenFactor = level.broken ? 0.6 : -0.2;
      factors.push({
        name: 'Break History',
        value: brokenFactor,
        weight: 0.08,
        detail: level.broken ? 'Previously broken — weaker on retest' : 'Never broken — virgin level',
      });

      // ── Factor 8: RSI alignment ──
      // RSI > 70 approaching ceiling = momentum could push through (or exhaust)
      // RSI < 30 approaching floor = could break (or bounce)
      let rsiFactor = 0;
      if (level.type === 'ceiling') {
        rsiFactor = currentRSI > 70 ? 0.5      // overbought + approaching ceiling → could push through
          : currentRSI > 60 ? 0.2               // bullish but not extreme
          : currentRSI < 40 ? -0.5              // bearish, won't reach ceiling easily
          : 0;
      } else {
        rsiFactor = currentRSI < 30 ? 0.5       // oversold + approaching floor → could break down
          : currentRSI < 40 ? 0.2
          : currentRSI > 60 ? -0.5              // bullish, not going down
          : 0;
      }
      factors.push({
        name: 'RSI Signal',
        value: rsiFactor,
        weight: 0.05,
        detail: `RSI ${currentRSI.toFixed(0)} — ${
          currentRSI > 70 ? 'overbought' : currentRSI < 30 ? 'oversold' : 'neutral'
        }`,
      });

      // ── Factor 9: Cross-TF confluence (inverse — harder to break) ──
      let confluenceFactor = 0;
      for (const [, cl] of confluentPrices) {
        if (cl.type === level.type) {
          const diff = Math.abs(cl.price - level.price) / level.price * 100;
          if (diff < 0.3) { // same level
            confluenceFactor = -(cl.timeframes.length * 0.2); // more TFs = harder to break
            break;
          }
        }
      }
      confluenceFactor = Math.max(-1, Math.min(0, confluenceFactor));
      factors.push({
        name: 'Multi-TF',
        value: confluenceFactor,
        weight: 0.05,
        detail: confluenceFactor < -0.2
          ? 'Confirmed across timeframes — harder to break'
          : 'Single timeframe level',
      });

      // ── Compute weighted break probability ──
      let weightedSum = 0;
      let totalWeight = 0;
      for (const f of factors) {
        weightedSum += f.value * f.weight;
        totalWeight += f.weight;
      }
      const rawScore = totalWeight > 0 ? weightedSum / totalWeight : 0; // -1 to +1

      // Map to 0-100 probability
      const breakProbability = Math.max(0, Math.min(100, (rawScore + 1) * 50));
      const holdProbability = 100 - breakProbability;

      // Confidence: higher when factors agree (low variance)
      const factorValues = factors.map(f => f.value);
      const mean = factorValues.reduce((s, v) => s + v, 0) / factorValues.length;
      const variance = factorValues.reduce((s, v) => s + (v - mean) ** 2, 0) / factorValues.length;
      const confidence = Math.max(15, Math.min(95, 80 - variance * 100));

      // Verdict
      const verdict: BreakPrediction['verdict'] =
        breakProbability >= 62 ? 'LIKELY BREAK'
        : breakProbability <= 38 ? 'LIKELY HOLD'
        : 'UNCERTAIN';

      // ETA: rough guess based on distance and ATR
      const candlesToLevel = currentATR > 0
        ? Math.ceil(level.distanceFromPrice / currentATR)
        : 0;
      const eta = candlesToLevel <= 1 ? '⚡ Imminent'
        : candlesToLevel <= 3 ? `~${candlesToLevel} candles`
        : candlesToLevel <= 10 ? `~${candlesToLevel} candles`
        : `${candlesToLevel}+ candles`;

      predictions.push({
        level,
        tf: tfData.tf,
        breakProbability,
        holdProbability,
        verdict,
        confidence,
        factors,
        eta,
      });
    }
  }

  // Sort by break probability descending (most likely to break first)
  predictions.sort((a, b) => b.breakProbability - a.breakProbability);

  const mostLikelyBreak = predictions.length > 0 ? predictions[0] : null;
  const mostLikelyHold = predictions.length > 0 ? predictions[predictions.length - 1] : null;

  const nearestFloorPrediction = predictions.find(p => p.level.type === 'floor') ?? null;
  const nearestCeilingPrediction = predictions.find(p =>
    p.level.type === 'ceiling'
  ) ?? null;

  // Overall bias: are ceilings or floors more at risk?
  const floorPreds = predictions.filter(p => p.level.type === 'floor');
  const ceilingPreds = predictions.filter(p => p.level.type === 'ceiling');
  const avgFloorBreak = floorPreds.length > 0
    ? floorPreds.reduce((s, p) => s + p.breakProbability, 0) / floorPreds.length : 50;
  const avgCeilingBreak = ceilingPreds.length > 0
    ? ceilingPreds.reduce((s, p) => s + p.breakProbability, 0) / ceilingPreds.length : 50;

  let overallBias: BreakPredictionSummary['overallBias'] = 'indeterminate';
  let biasSummary = '';

  if (avgCeilingBreak >= 60 && avgCeilingBreak > avgFloorBreak + 10) {
    overallBias = 'breaking-up';
    biasSummary = `Ceilings under pressure (${avgCeilingBreak.toFixed(0)}% avg break prob) — likely breakout UP`;
  } else if (avgFloorBreak >= 60 && avgFloorBreak > avgCeilingBreak + 10) {
    overallBias = 'breaking-down';
    biasSummary = `Floors under pressure (${avgFloorBreak.toFixed(0)}% avg break prob) — likely breakdown DOWN`;
  } else if (avgFloorBreak < 45 && avgCeilingBreak < 45) {
    overallBias = 'range-bound';
    biasSummary = `Both floors and ceilings holding — range-bound price action`;
  } else {
    overallBias = 'indeterminate';
    biasSummary = `Mixed signals — floor break ${avgFloorBreak.toFixed(0)}%, ceiling break ${avgCeilingBreak.toFixed(0)}%`;
  }

  return {
    predictions,
    mostLikelyBreak,
    mostLikelyHold,
    nearestFloorPrediction,
    nearestCeilingPrediction,
    overallBias,
    biasSummary,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEVEL ENTRY SIGNAL GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate entry signals when price reaches a strong level with candle confirmation.
 *
 * Signal types:
 *   BOUNCE_LONG     — Price at floor + bullish candle (hammer, engulfing, pin bar)
 *   BOUNCE_SHORT    — Price at ceiling + bearish candle (shooting star, engulfing, pin bar)
 *   BREAKOUT_LONG   — Strong close above ceiling + momentum candle + LIKELY BREAK
 *   BREAKDOWN_SHORT — Strong close below floor + momentum candle + LIKELY BREAK
 *
 * Each signal includes: entry, SL, TP, R:R, grade, and confidence.
 */
function generateLevelSignals(
  candles: CandlestickData[],
  timeframes: TimeframeFloorCeiling[],
  breakPredictions: BreakPredictionSummary,
  confluenceLevels: ConfluentLevel[],
  htfCandles: HTFCandleMap,
): LevelSignalSummary {
  const empty: LevelSignalSummary = {
    signals: [],
    bestSignal: null,
    activeCount: 0,
    longCount: 0,
    shortCount: 0,
  };

  if (candles.length < 20) return empty;

  const currentPrice = candles[candles.length - 1].close;
  const lastCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];

  // ATR for SL/TP calculation
  const atrValues = calcATR(candles, 14);
  const currentATR = atrValues[candles.length - 1] ?? 0;
  if (currentATR <= 0) return empty;

  // Detect candle patterns on last few candles
  const recentPatterns = detectAllCandlestickPatterns(candles, 3);
  const lastCandlePatterns = recentPatterns.filter(
    p => p.index >= candles.length - 2 // patterns involving the last 1-2 candles
  );

  // Bullish confirmation patterns
  const bullishPatterns = lastCandlePatterns.filter(p => p.type === 'bullish');
  const bearishPatterns = lastCandlePatterns.filter(p => p.type === 'bearish');

  // Also check for simple "rejection candle" even without named patterns
  const lastBody = Math.abs(lastCandle.close - lastCandle.open);
  const lastRange = lastCandle.high - lastCandle.low;
  const lastLowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
  const lastUpperWick = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
  const isBullishRejection = lastRange > 0 && lastLowerWick > lastRange * 0.5 && lastCandle.close > lastCandle.open;
  const isBearishRejection = lastRange > 0 && lastUpperWick > lastRange * 0.5 && lastCandle.close < lastCandle.open;

  // Strong momentum candle check (for breakout signals)
  const isBullishMomentum = lastCandle.close > lastCandle.open && lastBody > currentATR * 0.8;
  const isBearishMomentum = lastCandle.close < lastCandle.open && lastBody > currentATR * 0.8;

  // Check if close is a breakout (close above previous high or below previous low)
  const prevHigh = prevCandle.high;
  const prevLow = prevCandle.low;

  // Build confluent price set for bonus scoring
  const confluentPriceSet = new Set(confluenceLevels.map(cl => cl.price.toFixed(2)));

  const signals: LevelSignal[] = [];
  const now = Date.now();

  for (const tfData of timeframes) {
    // ── Check FLOORS for bounce/breakdown signals ──
    for (const floor of tfData.floors.slice(0, 3)) {
      const isNear = floor.distancePct < 0.3; // within 0.3% of the level
      const isTouching = currentPrice <= floor.zone.high * 1.001 && currentPrice >= floor.zone.low * 0.998;
      const pred = breakPredictions.predictions.find(
        p => p.tf === tfData.tf && Math.abs(p.level.price - floor.price) / floor.price < 0.001
      );

      // ── BOUNCE LONG: at floor + bullish confirmation + LIKELY HOLD ──
      if ((isNear || isTouching) && (bullishPatterns.length > 0 || isBullishRejection)) {
        const confirmName = bullishPatterns.length > 0
          ? bullishPatterns.sort((a, b) => (b.strength === 'strong' ? 2 : b.strength === 'medium' ? 1 : 0) - (a.strength === 'strong' ? 2 : a.strength === 'medium' ? 1 : 0))[0].name
          : 'Bullish Wick Rejection';

        const sl = floor.zone.low - currentATR * 0.5;
        const risk = currentPrice - sl;
        const tp1 = currentPrice + risk * 2;
        const tp2 = currentPrice + risk * 3;
        const rr = risk > 0 ? (tp1 - currentPrice) / risk : 0;

        // Grade based on factors
        let gradeScore = 0;
        if (floor.strength >= 70) gradeScore += 3;
        else if (floor.strength >= 50) gradeScore += 2;
        else gradeScore += 1;
        if (pred && pred.holdProbability >= 60) gradeScore += 2;
        if (bullishPatterns.some(p => p.strength === 'strong')) gradeScore += 2;
        if (confluentPriceSet.has(floor.price.toFixed(2))) gradeScore += 2;
        if (rr >= 2) gradeScore += 1;

        const grade: LevelSignal['grade'] = gradeScore >= 8 ? 'A+' : gradeScore >= 6 ? 'A' : gradeScore >= 4 ? 'B' : 'C';
        const confidence = Math.min(95, 30 + gradeScore * 8);

        const reasons: string[] = [];
        reasons.push(`Price at ${tfData.tf} floor (${floor.price.toFixed(2)})`);
        reasons.push(`Confirmation: ${confirmName}`);
        if (pred) reasons.push(`Hold probability: ${pred.holdProbability.toFixed(0)}%`);
        if (floor.strength >= 60) reasons.push(`Strong level (${floor.strength.toFixed(0)})`);
        if (confluentPriceSet.has(floor.price.toFixed(2))) reasons.push('Multi-TF confluence');

        signals.push({
          id: `BL-${tfData.tf}-${floor.price.toFixed(2)}-${now}`,
          type: 'BOUNCE_LONG',
          direction: 'LONG',
          grade,
          level: floor,
          tf: tfData.tf,
          entry: currentPrice,
          stopLoss: sl,
          takeProfit: tp1,
          takeProfit2: tp2,
          riskReward: rr,
          confidence,
          confirmationPattern: confirmName,
          breakPrediction: pred ?? null,
          reasons,
          timestamp: now,
          price: currentPrice,
          active: true,
          invalidationPrice: sl,
        });
      }

      // ── BREAKDOWN SHORT: price closes below floor + bearish momentum + LIKELY BREAK ──
      const brokeBelow = lastCandle.close < floor.zone.low * 0.999 && prevCandle.close >= floor.zone.low * 0.999;
      if (brokeBelow && (isBearishMomentum || bearishPatterns.length > 0)) {
        const confirmName = bearishPatterns.length > 0
          ? bearishPatterns[0].name
          : 'Bearish Momentum Candle';

        const sl = floor.zone.high + currentATR * 0.5;
        const risk = sl - currentPrice;
        const tp1 = currentPrice - risk * 2;
        const tp2 = currentPrice - risk * 3;
        const rr = risk > 0 ? (currentPrice - tp1) / risk : 0;

        let gradeScore = 0;
        if (floor.strength < 40) gradeScore += 2; // weak floor = easier break
        if (pred && pred.breakProbability >= 60) gradeScore += 3;
        if (isBearishMomentum) gradeScore += 2;
        if (lastBody > currentATR) gradeScore += 1;
        if (rr >= 2) gradeScore += 1;

        const grade: LevelSignal['grade'] = gradeScore >= 7 ? 'A+' : gradeScore >= 5 ? 'A' : gradeScore >= 3 ? 'B' : 'C';
        const confidence = Math.min(90, 25 + gradeScore * 8);

        const reasons: string[] = [];
        reasons.push(`Price broke below ${tfData.tf} floor (${floor.price.toFixed(2)})`);
        reasons.push(`Confirmation: ${confirmName}`);
        if (pred) reasons.push(`Break probability: ${pred.breakProbability.toFixed(0)}%`);
        if (floor.touches >= 3) reasons.push(`Weakened by ${floor.touches} touches`);

        signals.push({
          id: `BD-${tfData.tf}-${floor.price.toFixed(2)}-${now}`,
          type: 'BREAKDOWN_SHORT',
          direction: 'SHORT',
          grade,
          level: floor,
          tf: tfData.tf,
          entry: currentPrice,
          stopLoss: sl,
          takeProfit: tp1,
          takeProfit2: tp2,
          riskReward: rr,
          confidence,
          confirmationPattern: confirmName,
          breakPrediction: pred ?? null,
          reasons,
          timestamp: now,
          price: currentPrice,
          active: true,
          invalidationPrice: sl,
        });
      }
    }

    // ── Check CEILINGS for bounce/breakout signals ──
    for (const ceiling of tfData.ceilings.slice(0, 3)) {
      const isNear = ceiling.distancePct < 0.3;
      const isTouching = currentPrice >= ceiling.zone.low * 0.999 && currentPrice <= ceiling.zone.high * 1.001;
      const pred = breakPredictions.predictions.find(
        p => p.tf === tfData.tf && Math.abs(p.level.price - ceiling.price) / ceiling.price < 0.001
      );

      // ── BOUNCE SHORT: at ceiling + bearish confirmation + LIKELY HOLD ──
      if ((isNear || isTouching) && (bearishPatterns.length > 0 || isBearishRejection)) {
        const confirmName = bearishPatterns.length > 0
          ? bearishPatterns.sort((a, b) => (b.strength === 'strong' ? 2 : b.strength === 'medium' ? 1 : 0) - (a.strength === 'strong' ? 2 : a.strength === 'medium' ? 1 : 0))[0].name
          : 'Bearish Wick Rejection';

        const sl = ceiling.zone.high + currentATR * 0.5;
        const risk = sl - currentPrice;
        const tp1 = currentPrice - risk * 2;
        const tp2 = currentPrice - risk * 3;
        const rr = risk > 0 ? (currentPrice - tp1) / risk : 0;

        let gradeScore = 0;
        if (ceiling.strength >= 70) gradeScore += 3;
        else if (ceiling.strength >= 50) gradeScore += 2;
        else gradeScore += 1;
        if (pred && pred.holdProbability >= 60) gradeScore += 2;
        if (bearishPatterns.some(p => p.strength === 'strong')) gradeScore += 2;
        if (confluentPriceSet.has(ceiling.price.toFixed(2))) gradeScore += 2;
        if (rr >= 2) gradeScore += 1;

        const grade: LevelSignal['grade'] = gradeScore >= 8 ? 'A+' : gradeScore >= 6 ? 'A' : gradeScore >= 4 ? 'B' : 'C';
        const confidence = Math.min(95, 30 + gradeScore * 8);

        const reasons: string[] = [];
        reasons.push(`Price at ${tfData.tf} ceiling (${ceiling.price.toFixed(2)})`);
        reasons.push(`Confirmation: ${confirmName}`);
        if (pred) reasons.push(`Hold probability: ${pred.holdProbability.toFixed(0)}%`);
        if (ceiling.strength >= 60) reasons.push(`Strong level (${ceiling.strength.toFixed(0)})`);
        if (confluentPriceSet.has(ceiling.price.toFixed(2))) reasons.push('Multi-TF confluence');

        signals.push({
          id: `BS-${tfData.tf}-${ceiling.price.toFixed(2)}-${now}`,
          type: 'BOUNCE_SHORT',
          direction: 'SHORT',
          grade,
          level: ceiling,
          tf: tfData.tf,
          entry: currentPrice,
          stopLoss: sl,
          takeProfit: tp1,
          takeProfit2: tp2,
          riskReward: rr,
          confidence,
          confirmationPattern: confirmName,
          breakPrediction: pred ?? null,
          reasons,
          timestamp: now,
          price: currentPrice,
          active: true,
          invalidationPrice: sl,
        });
      }

      // ── BREAKOUT LONG: price closes above ceiling + bullish momentum + LIKELY BREAK ──
      const brokeAbove = lastCandle.close > ceiling.zone.high * 1.001 && prevCandle.close <= ceiling.zone.high * 1.001;
      if (brokeAbove && (isBullishMomentum || bullishPatterns.length > 0)) {
        const confirmName = bullishPatterns.length > 0
          ? bullishPatterns[0].name
          : 'Bullish Momentum Candle';

        const sl = ceiling.zone.low - currentATR * 0.5;
        const risk = currentPrice - sl;
        const tp1 = currentPrice + risk * 2;
        const tp2 = currentPrice + risk * 3;
        const rr = risk > 0 ? (tp1 - currentPrice) / risk : 0;

        let gradeScore = 0;
        if (ceiling.strength < 40) gradeScore += 2;
        if (pred && pred.breakProbability >= 60) gradeScore += 3;
        if (isBullishMomentum) gradeScore += 2;
        if (lastBody > currentATR) gradeScore += 1;
        if (rr >= 2) gradeScore += 1;

        const grade: LevelSignal['grade'] = gradeScore >= 7 ? 'A+' : gradeScore >= 5 ? 'A' : gradeScore >= 3 ? 'B' : 'C';
        const confidence = Math.min(90, 25 + gradeScore * 8);

        const reasons: string[] = [];
        reasons.push(`Price broke above ${tfData.tf} ceiling (${ceiling.price.toFixed(2)})`);
        reasons.push(`Confirmation: ${confirmName}`);
        if (pred) reasons.push(`Break probability: ${pred.breakProbability.toFixed(0)}%`);
        if (ceiling.touches >= 3) reasons.push(`Weakened by ${ceiling.touches} touches`);

        signals.push({
          id: `BO-${tfData.tf}-${ceiling.price.toFixed(2)}-${now}`,
          type: 'BREAKOUT_LONG',
          direction: 'LONG',
          grade,
          level: ceiling,
          tf: tfData.tf,
          entry: currentPrice,
          stopLoss: sl,
          takeProfit: tp1,
          takeProfit2: tp2,
          riskReward: rr,
          confidence,
          confirmationPattern: confirmName,
          breakPrediction: pred ?? null,
          reasons,
          timestamp: now,
          price: currentPrice,
          active: true,
          invalidationPrice: sl,
        });
      }
    }
  }

  // Deduplicate: keep highest grade per direction per price zone
  const deduped = new Map<string, LevelSignal>();
  for (const sig of signals) {
    const key = `${sig.direction}-${sig.level.price.toFixed(1)}`;
    const existing = deduped.get(key);
    if (!existing || gradeRank(sig.grade) > gradeRank(existing.grade)) {
      deduped.set(key, sig);
    }
  }

  const finalSignals = [...deduped.values()].sort(
    (a, b) => gradeRank(b.grade) - gradeRank(a.grade) || b.confidence - a.confidence
  );

  return {
    signals: finalSignals,
    bestSignal: finalSignals.length > 0 ? finalSignals[0] : null,
    activeCount: finalSignals.length,
    longCount: finalSignals.filter(s => s.direction === 'LONG').length,
    shortCount: finalSignals.filter(s => s.direction === 'SHORT').length,
  };
}

function gradeRank(grade: string): number {
  switch (grade) {
    case 'A+': return 4;
    case 'A': return 3;
    case 'B': return 2;
    case 'C': return 1;
    default: return 0;
  }
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

  // ── Break predictions ──
  const breakPredictions = predictBreaks(candles, timeframes, confluenceLevels, htfCandles);

  // ── Level entry signals ──
  const levelSignals = generateLevelSignals(candles, timeframes, breakPredictions, confluenceLevels, htfCandles);

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
    breakPredictions,
    levelSignals,
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
