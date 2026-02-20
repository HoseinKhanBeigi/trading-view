import type { CandlestickData } from "lightweight-charts";
import { analyzeShadows, type ShadowAnalysisResult, type StopHuntEvent } from "./shadow-analysis";

// ═══════════════════════════════════════════════════════════════════════════════
// AMD STRATEGY ENGINE — 4H Roadmap + 5min Entry
// ═══════════════════════════════════════════════════════════════════════════════
//
// Accumulation → Manipulation → Distribution
//
// Each 4H candle is a "roadmap":
//   • Previous 4H high/low = liquidity targets
//   • Phase 1 (first ~25%): Accumulation — tight range, smart money loads
//   • Phase 2 (middle ~25%): Manipulation — sweep/stop hunt past 4H level
//   • Phase 3 (last ~50%): Distribution — the real move (profit leg)
//
// Uses 5min candles for precise entry after manipulation confirms.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Types ───────────────────────────────────────────────────────────────────

export type AMDPhase = 'accumulation' | 'manipulation' | 'distribution' | 'unknown';

export type HTFCandle = {
  open: number;
  high: number;
  low: number;
  close: number;
  time: number;
  range: number;          // high - low
  midPoint: number;
  bodySize: number;
  isBullish: boolean;
  upperWick: number;
  lowerWick: number;
};

export type FourHourRoadmap = {
  // Previous completed 4H candle
  previous: HTFCandle;
  // Current forming 4H candle
  current: HTFCandle;
  // Key levels from the previous 4H candle
  keyLevels: {
    prevHigh: number;       // sell-side liquidity target (shorts' stops)
    prevLow: number;        // buy-side liquidity target (longs' stops)
    prevMid: number;        // midpoint (equilibrium)
    prevOpen: number;
    prevClose: number;
    currentOpen: number;
    currentHigh: number;
    currentLow: number;
  };
  // Range analysis
  prevRange: number;        // ATR-like measure of previous 4H candle
  isExpanded: boolean;      // was prev 4H range larger than average?
  bias4H: 'bullish' | 'bearish' | 'neutral'; // prev 4H candle bias
};

export type AccumulationZone = {
  high: number;
  low: number;
  midPrice: number;
  rangeWidth: number;
  rangePct: number;         // as % of 4H range
  candlesInRange: number;   // how many 5min candles in the range
  detected: boolean;
  tightness: number;        // 0-100 (100 = very tight, ideal)
};

export type ManipulationEvent = {
  detected: boolean;
  type: 'sweep-low' | 'sweep-high' | 'none';
  direction: 'bullish' | 'bearish' | 'none';  // bullish = swept low (long setup)
  sweepPrice: number;       // the extreme of the manipulation wick
  levelSwept: number;       // which key level was swept
  recoveryPrice: number;    // where price recovered to
  recoveryStrength: number; // 0-100
  candleIndex: number;      // which 5min candle
  time: number;
  wickSize: number;         // size of the manipulation wick
  isClean: boolean;         // clean sweep with immediate recovery
  description: string;
};

export type DistributionMove = {
  detected: boolean;
  direction: 'bullish' | 'bearish' | 'none';
  startPrice: number;
  currentPrice: number;
  targetPrice: number;      // opposite 4H level
  moveSize: number;         // how much has it moved in distribution
  progressPct: number;      // % of distance to target covered
  momentumConfirmed: boolean; // is momentum confirming the move?
  structureConfirmed: boolean; // BOS/CHoCH on 5min?
};

export type AMDEntrySignal = {
  active: boolean;
  direction: 'LONG' | 'SHORT' | 'NONE';
  entry: number;
  stopLoss: number;
  takeProfit1: number;      // midpoint target
  takeProfit2: number;      // opposite 4H level
  takeProfit3: number;      // extension target
  riskReward1: number;
  riskReward2: number;
  riskReward3: number;
  confidence: number;       // 0-100
  trigger: string;          // what triggered the entry
  invalidation: string;     // what would invalidate this setup
};

export type AMDSessionWindow = {
  name: string;
  isActive: boolean;
  quality: 'premium' | 'good' | 'fair' | 'poor';
  description: string;
};

export type AMDAnalysisResult = {
  // 4H Roadmap
  roadmap: FourHourRoadmap;
  // Current AMD phase
  phase: AMDPhase;
  phaseProgress: number;    // 0-100 (how far into the current 4H candle)
  phaseTiming: string;      // human-readable timing info
  // Accumulation detection
  accumulation: AccumulationZone;
  // Manipulation detection
  manipulation: ManipulationEvent;
  // Distribution detection
  distribution: DistributionMove;
  // Entry signal
  entry: AMDEntrySignal;
  // Session window
  session: AMDSessionWindow;
  // Shadow analysis on 5min (sub-analysis)
  shadowConfirmation: {
    confirms: boolean;
    bias: 'bullish' | 'bearish' | 'neutral';
    stopHuntDetected: boolean;
    recentPattern: string;
  };
  // Overall AMD score
  score: number;            // 0-100 (setup quality)
  summary: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildHTFCandle(candles: CandlestickData[]): HTFCandle {
  if (candles.length === 0) {
    return {
      open: 0, high: 0, low: 0, close: 0, time: 0,
      range: 0, midPoint: 0, bodySize: 0, isBullish: true,
      upperWick: 0, lowerWick: 0,
    };
  }
  const open = candles[0].open;
  const close = candles[candles.length - 1].close;
  const high = Math.max(...candles.map(c => c.high));
  const low = Math.min(...candles.map(c => c.low));
  const time = candles[0].time as number;
  const range = high - low;
  const bodySize = Math.abs(close - open);
  const isBullish = close >= open;
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;

  return {
    open, high, low, close, time,
    range, midPoint: (high + low) / 2,
    bodySize, isBullish, upperWick, lowerWick,
  };
}

/** Split 5min candles into 4H buckets (48 candles each) */
function split4HBuckets(candles: CandlestickData[]): CandlestickData[][] {
  const candlesPerBucket = 48; // 4H / 5min = 48
  const buckets: CandlestickData[][] = [];

  // Work backward from the end to find completed 4H blocks
  const total = candles.length;
  if (total < candlesPerBucket) return [candles];

  // Use time-based bucketing if timestamps available
  // Each 4H period = 4*60*60 = 14400 seconds
  const fourHourSec = 14400;
  const firstTime = candles[0].time as number;

  // Round first candle time down to nearest 4H boundary
  const boundary = Math.floor(firstTime / fourHourSec) * fourHourSec;

  let currentBucket: CandlestickData[] = [];
  let currentBoundary = boundary;

  for (const c of candles) {
    const t = c.time as number;
    while (t >= currentBoundary + fourHourSec) {
      if (currentBucket.length > 0) {
        buckets.push(currentBucket);
        currentBucket = [];
      }
      currentBoundary += fourHourSec;
    }
    currentBucket.push(c);
  }
  // Last bucket (current forming 4H)
  if (currentBucket.length > 0) {
    buckets.push(currentBucket);
  }

  // Fallback: if time-based bucketing fails (e.g., seconds vs ms), use count-based
  if (buckets.length <= 1 && total >= candlesPerBucket * 2) {
    const fallbackBuckets: CandlestickData[][] = [];
    for (let i = 0; i < total; i += candlesPerBucket) {
      fallbackBuckets.push(candles.slice(i, i + candlesPerBucket));
    }
    return fallbackBuckets;
  }

  return buckets;
}

/** Detect if there's a tight accumulation range in the first portion of 5min candles */
function detectAccumulation(
  candles5min: CandlestickData[],
  fourHourRange: number,
): AccumulationZone {
  const empty: AccumulationZone = {
    high: 0, low: 0, midPrice: 0,
    rangeWidth: 0, rangePct: 0,
    candlesInRange: 0, detected: false, tightness: 0,
  };

  if (candles5min.length < 4) return empty;

  // Look at the first 25-40% of the 4H candle for accumulation
  const accumEnd = Math.min(candles5min.length, Math.max(4, Math.ceil(candles5min.length * 0.4)));
  const accumCandles = candles5min.slice(0, accumEnd);

  const high = Math.max(...accumCandles.map(c => c.high));
  const low = Math.min(...accumCandles.map(c => c.low));
  const rangeWidth = high - low;
  const midPrice = (high + low) / 2;
  const rangePct = fourHourRange > 0 ? (rangeWidth / fourHourRange) * 100 : 100;

  // Count candles that stay within the range (measuring overlap)
  let inRangeCount = 0;
  for (const c of accumCandles) {
    const candleRange = c.high - c.low;
    if (candleRange < rangeWidth * 0.6) inRangeCount++;
  }

  // Tightness: tighter range relative to 4H = better accumulation
  // Ideal: accumulation range < 30% of total 4H range
  const tightness = Math.max(0, Math.min(100,
    rangePct < 20 ? 100
    : rangePct < 30 ? 80
    : rangePct < 40 ? 60
    : rangePct < 50 ? 40
    : rangePct < 60 ? 20
    : 0
  ));

  const detected = rangePct < 50 && accumCandles.length >= 4 && tightness >= 40;

  return {
    high, low, midPrice,
    rangeWidth, rangePct,
    candlesInRange: inRangeCount,
    detected, tightness,
  };
}

/** Detect manipulation (sweep/stop hunt) of 4H levels on 5min */
function detectManipulation(
  candles5min: CandlestickData[],
  prevHigh: number,
  prevLow: number,
  accumZone: AccumulationZone,
): ManipulationEvent {
  const none: ManipulationEvent = {
    detected: false, type: 'none', direction: 'none',
    sweepPrice: 0, levelSwept: 0, recoveryPrice: 0,
    recoveryStrength: 0, candleIndex: -1, time: 0,
    wickSize: 0, isClean: false,
    description: 'No manipulation detected yet',
  };

  if (candles5min.length < 6) return none;

  // Look in the middle portion of 4H (candles 6 onwards) for manipulation
  const searchStart = Math.max(3, Math.floor(candles5min.length * 0.15));
  const searchEnd = Math.min(candles5min.length, Math.ceil(candles5min.length * 0.75));

  let bestManipulation: ManipulationEvent | null = null;
  let bestStrength = 0;

  for (let i = searchStart; i < searchEnd; i++) {
    const c = candles5min[i];
    const body = Math.abs(c.close - c.open);
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;

    // ── Sweep LOW (bullish manipulation) ──
    // Candle wicks below previous 4H low, but closes above it
    if (c.low < prevLow && c.close > prevLow) {
      const sweepDepth = prevLow - c.low;
      const recovery = c.close - c.low;
      const recoveryStrength = Math.min(100, (recovery / (c.high - c.low)) * 100);
      const isClean = lowerWick > body * 1.5 && c.close > prevLow;

      // Also check if it swept the accumulation low
      const sweptAccum = accumZone.detected && c.low < accumZone.low;

      const strength = recoveryStrength * 0.4 +
        (isClean ? 30 : 10) +
        (sweptAccum ? 20 : 0) +
        Math.min(20, (sweepDepth / (c.high - c.low)) * 40);

      if (strength > bestStrength) {
        bestStrength = strength;
        bestManipulation = {
          detected: true,
          type: 'sweep-low',
          direction: 'bullish',
          sweepPrice: c.low,
          levelSwept: prevLow,
          recoveryPrice: c.close,
          recoveryStrength,
          candleIndex: i,
          time: c.time as number,
          wickSize: lowerWick,
          isClean,
          description: `Bullish manipulation — swept 4H low (${prevLow.toFixed(1)}) with wick to ${c.low.toFixed(1)}, recovered to ${c.close.toFixed(1)}`,
        };
      }
    }

    // ── Sweep HIGH (bearish manipulation) ──
    if (c.high > prevHigh && c.close < prevHigh) {
      const sweepDepth = c.high - prevHigh;
      const recovery = c.high - c.close;
      const recoveryStrength = Math.min(100, (recovery / (c.high - c.low)) * 100);
      const isClean = upperWick > body * 1.5 && c.close < prevHigh;

      const sweptAccum = accumZone.detected && c.high > accumZone.high;

      const strength = recoveryStrength * 0.4 +
        (isClean ? 30 : 10) +
        (sweptAccum ? 20 : 0) +
        Math.min(20, (sweepDepth / (c.high - c.low)) * 40);

      if (strength > bestStrength) {
        bestStrength = strength;
        bestManipulation = {
          detected: true,
          type: 'sweep-high',
          direction: 'bearish',
          sweepPrice: c.high,
          levelSwept: prevHigh,
          recoveryPrice: c.close,
          recoveryStrength,
          candleIndex: i,
          time: c.time as number,
          wickSize: upperWick,
          isClean,
          description: `Bearish manipulation — swept 4H high (${prevHigh.toFixed(1)}) with wick to ${c.high.toFixed(1)}, recovered to ${c.close.toFixed(1)}`,
        };
      }
    }

    // ── Also check for sweeps near accumulation zone boundaries ──
    if (accumZone.detected) {
      // Sweep below accumulation range
      if (c.low < accumZone.low - (accumZone.rangeWidth * 0.3) && c.close > accumZone.low) {
        const sweepDepth = accumZone.low - c.low;
        const recoveryStrength = Math.min(100, ((c.close - c.low) / (c.high - c.low)) * 100);
        const isClean = lowerWick > body * 1.2;

        const strength = recoveryStrength * 0.3 + (isClean ? 25 : 10) + 15;

        if (strength > bestStrength && !bestManipulation) {
          bestStrength = strength;
          bestManipulation = {
            detected: true,
            type: 'sweep-low',
            direction: 'bullish',
            sweepPrice: c.low,
            levelSwept: accumZone.low,
            recoveryPrice: c.close,
            recoveryStrength,
            candleIndex: i,
            time: c.time as number,
            wickSize: lowerWick,
            isClean,
            description: `Bullish manipulation — swept accumulation low (${accumZone.low.toFixed(1)}) with wick to ${c.low.toFixed(1)}`,
          };
        }
      }

      // Sweep above accumulation range
      if (c.high > accumZone.high + (accumZone.rangeWidth * 0.3) && c.close < accumZone.high) {
        const sweepDepth = c.high - accumZone.high;
        const recoveryStrength = Math.min(100, ((c.high - c.close) / (c.high - c.low)) * 100);
        const isClean = upperWick > body * 1.2;

        const strength = recoveryStrength * 0.3 + (isClean ? 25 : 10) + 15;

        if (strength > bestStrength && !bestManipulation) {
          bestStrength = strength;
          bestManipulation = {
            detected: true,
            type: 'sweep-high',
            direction: 'bearish',
            sweepPrice: c.high,
            levelSwept: accumZone.high,
            recoveryPrice: c.close,
            recoveryStrength,
            candleIndex: i,
            time: c.time as number,
            wickSize: upperWick,
            isClean,
            description: `Bearish manipulation — swept accumulation high (${accumZone.high.toFixed(1)}) with wick to ${c.high.toFixed(1)}`,
          };
        }
      }
    }
  }

  return bestManipulation ?? none;
}

/** Detect 5min BOS/CHoCH after manipulation (simple version) */
function detect5minStructureShift(
  candles5min: CandlestickData[],
  afterIndex: number,
  direction: 'bullish' | 'bearish',
): { detected: boolean; price: number; index: number; type: 'BOS' | 'CHoCH' } {
  if (afterIndex < 2 || afterIndex >= candles5min.length - 1) {
    return { detected: false, price: 0, index: -1, type: 'BOS' };
  }

  // Look at candles AFTER the manipulation for structure shift
  const searchStart = afterIndex + 1;
  const searchEnd = Math.min(candles5min.length, afterIndex + 15);

  if (direction === 'bullish') {
    // Find the nearest swing high before manipulation, then see if price breaks it
    let swingHigh = 0;
    for (let j = Math.max(0, afterIndex - 5); j <= afterIndex; j++) {
      if (candles5min[j].high > swingHigh) swingHigh = candles5min[j].high;
    }
    // Exclude the manipulation candle's high itself
    const manipHigh = candles5min[afterIndex].high;
    // Use the second highest as the swing level to break
    let prevSwingHigh = 0;
    for (let j = Math.max(0, afterIndex - 8); j < afterIndex; j++) {
      if (candles5min[j].high > prevSwingHigh && candles5min[j].high < manipHigh) {
        prevSwingHigh = candles5min[j].high;
      }
    }
    if (prevSwingHigh === 0) prevSwingHigh = swingHigh * 0.999;

    for (let i = searchStart; i < searchEnd; i++) {
      if (candles5min[i].close > prevSwingHigh) {
        return { detected: true, price: candles5min[i].close, index: i, type: 'CHoCH' };
      }
    }
  } else {
    // Bearish: find swing low before manipulation, see if price breaks it
    let swingLow = Infinity;
    for (let j = Math.max(0, afterIndex - 5); j <= afterIndex; j++) {
      if (candles5min[j].low < swingLow) swingLow = candles5min[j].low;
    }
    const manipLow = candles5min[afterIndex].low;
    let prevSwingLow = Infinity;
    for (let j = Math.max(0, afterIndex - 8); j < afterIndex; j++) {
      if (candles5min[j].low < prevSwingLow && candles5min[j].low > manipLow) {
        prevSwingLow = candles5min[j].low;
      }
    }
    if (prevSwingLow === Infinity) prevSwingLow = swingLow * 1.001;

    for (let i = searchStart; i < searchEnd; i++) {
      if (candles5min[i].close < prevSwingLow) {
        return { detected: true, price: candles5min[i].close, index: i, type: 'CHoCH' };
      }
    }
  }

  return { detected: false, price: 0, index: -1, type: 'BOS' };
}

/** Detect distribution phase (sustained move after manipulation) */
function detectDistribution(
  candles5min: CandlestickData[],
  manipulation: ManipulationEvent,
  prevHigh: number,
  prevLow: number,
  prevMid: number,
): DistributionMove {
  const none: DistributionMove = {
    detected: false, direction: 'none',
    startPrice: 0, currentPrice: 0, targetPrice: 0,
    moveSize: 0, progressPct: 0,
    momentumConfirmed: false, structureConfirmed: false,
  };

  if (!manipulation.detected || candles5min.length < 3) return none;

  const afterIdx = manipulation.candleIndex;
  if (afterIdx < 0 || afterIdx >= candles5min.length - 1) return none;

  const postManipCandles = candles5min.slice(afterIdx + 1);
  if (postManipCandles.length < 2) return none;

  const startPrice = manipulation.recoveryPrice;
  const currentPrice = candles5min[candles5min.length - 1].close;
  const direction = manipulation.direction;

  // Target is opposite side of 4H candle
  const targetPrice = direction === 'bullish' ? prevHigh : prevLow;

  // How much of the target distance has been covered
  const totalDistance = Math.abs(targetPrice - startPrice);
  const covered = direction === 'bullish'
    ? currentPrice - startPrice
    : startPrice - currentPrice;
  const progressPct = totalDistance > 0 ? Math.max(0, Math.min(100, (covered / totalDistance) * 100)) : 0;

  // Check momentum: are most post-manipulation candles moving in the right direction?
  let momentumCount = 0;
  for (const c of postManipCandles) {
    if (direction === 'bullish' && c.close > c.open) momentumCount++;
    if (direction === 'bearish' && c.close < c.open) momentumCount++;
  }
  const momentumConfirmed = momentumCount > postManipCandles.length * 0.5;

  // Check structure shift
  const structShift = detect5minStructureShift(candles5min, afterIdx, direction === 'bullish' ? 'bullish' : 'bearish');
  const structureConfirmed = structShift.detected;

  const detected = covered > 0 && postManipCandles.length >= 2;

  return {
    detected,
    direction: direction === 'bullish' ? 'bullish' : direction === 'bearish' ? 'bearish' : 'none',
    startPrice,
    currentPrice,
    targetPrice,
    moveSize: Math.abs(covered),
    progressPct,
    momentumConfirmed,
    structureConfirmed,
  };
}

/** Detect current session quality for AMD */
function detectSessionWindow(): AMDSessionWindow {
  const now = new Date();
  const utcHour = now.getUTCHours();

  // London Open: 07:00-08:30 UTC
  if (utcHour >= 7 && utcHour < 9) {
    return {
      name: 'London Open',
      isActive: true,
      quality: 'premium',
      description: 'London open killzone — highest probability for manipulation',
    };
  }
  // NY Open: 12:00-14:00 UTC
  if (utcHour >= 12 && utcHour < 14) {
    return {
      name: 'New York Open',
      isActive: true,
      quality: 'premium',
      description: 'NY open killzone — second-highest probability for manipulation',
    };
  }
  // London Session: 08:30-11:30 UTC
  if (utcHour >= 9 && utcHour < 12) {
    return {
      name: 'London Session',
      isActive: true,
      quality: 'good',
      description: 'London active session — distribution phase often plays out here',
    };
  }
  // NY Session: 14:00-16:00 UTC
  if (utcHour >= 14 && utcHour < 16) {
    return {
      name: 'NY Session',
      isActive: true,
      quality: 'good',
      description: 'NY active session — distribution continuation',
    };
  }
  // London Close: 15:00-17:00 UTC
  if (utcHour >= 16 && utcHour < 17) {
    return {
      name: 'London Close',
      isActive: true,
      quality: 'fair',
      description: 'London close — possible final manipulation/distribution',
    };
  }
  // Asian Session: 00:00-06:00 UTC
  if (utcHour >= 0 && utcHour < 7) {
    return {
      name: 'Asian Session',
      isActive: true,
      quality: 'fair',
      description: 'Asian session — accumulation / range building (mark the range for later)',
    };
  }
  // Off-hours
  return {
    name: 'Off-Hours',
    isActive: false,
    quality: 'poor',
    description: 'Low-liquidity period — avoid new AMD entries',
  };
}

/** Generate entry signal based on AMD analysis */
function generateEntrySignal(
  candles5min: CandlestickData[],
  manipulation: ManipulationEvent,
  distribution: DistributionMove,
  roadmap: FourHourRoadmap,
  shadows: ShadowAnalysisResult,
  session: AMDSessionWindow,
): AMDEntrySignal {
  const noEntry: AMDEntrySignal = {
    active: false, direction: 'NONE',
    entry: 0, stopLoss: 0,
    takeProfit1: 0, takeProfit2: 0, takeProfit3: 0,
    riskReward1: 0, riskReward2: 0, riskReward3: 0,
    confidence: 0,
    trigger: 'No AMD entry signal',
    invalidation: '-',
  };

  if (!manipulation.detected) return noEntry;

  const currentPrice = candles5min[candles5min.length - 1].close;
  const atr5min = calc5minATR(candles5min);

  // Check for 5min structure shift after manipulation
  const structShift = detect5minStructureShift(
    candles5min,
    manipulation.candleIndex,
    manipulation.direction === 'bullish' ? 'bullish' : 'bearish',
  );

  // Need either structure shift or shadow confirmation
  const shadowConfirms = (
    (manipulation.direction === 'bullish' && shadows.bias === 'bullish') ||
    (manipulation.direction === 'bearish' && shadows.bias === 'bearish')
  );

  const hasConfirmation = structShift.detected || shadowConfirms;
  if (!hasConfirmation && !manipulation.isClean) return noEntry;

  if (manipulation.direction === 'bullish') {
    const entry = structShift.detected ? structShift.price : currentPrice;
    const stopLoss = manipulation.sweepPrice - atr5min * 0.3;
    const risk = entry - stopLoss;
    if (risk <= 0) return noEntry;

    const tp1 = roadmap.keyLevels.prevMid;
    const tp2 = roadmap.keyLevels.prevHigh;
    const tp3 = roadmap.keyLevels.prevHigh + roadmap.prevRange * 0.5; // extension

    let confidence = 30;
    if (structShift.detected) confidence += 25;
    if (manipulation.isClean) confidence += 15;
    if (shadowConfirms) confidence += 10;
    if (session.quality === 'premium') confidence += 15;
    else if (session.quality === 'good') confidence += 8;
    if (manipulation.recoveryStrength > 70) confidence += 10;
    if (distribution.momentumConfirmed) confidence += 10;
    confidence = Math.min(95, confidence);

    const trigger = structShift.detected
      ? `5min CHoCH bullish at ${structShift.price.toFixed(1)} after sweep of 4H low`
      : `Clean bullish sweep of 4H low with ${manipulation.isClean ? 'pin bar' : 'recovery'}`;

    return {
      active: true,
      direction: 'LONG',
      entry,
      stopLoss,
      takeProfit1: tp1,
      takeProfit2: tp2,
      takeProfit3: tp3,
      riskReward1: (tp1 - entry) / risk,
      riskReward2: (tp2 - entry) / risk,
      riskReward3: (tp3 - entry) / risk,
      confidence,
      trigger,
      invalidation: `Close below ${stopLoss.toFixed(1)} (below manipulation wick)`,
    };
  }

  if (manipulation.direction === 'bearish') {
    const entry = structShift.detected ? structShift.price : currentPrice;
    const stopLoss = manipulation.sweepPrice + atr5min * 0.3;
    const risk = stopLoss - entry;
    if (risk <= 0) return noEntry;

    const tp1 = roadmap.keyLevels.prevMid;
    const tp2 = roadmap.keyLevels.prevLow;
    const tp3 = roadmap.keyLevels.prevLow - roadmap.prevRange * 0.5;

    let confidence = 30;
    if (structShift.detected) confidence += 25;
    if (manipulation.isClean) confidence += 15;
    if (shadowConfirms) confidence += 10;
    if (session.quality === 'premium') confidence += 15;
    else if (session.quality === 'good') confidence += 8;
    if (manipulation.recoveryStrength > 70) confidence += 10;
    if (distribution.momentumConfirmed) confidence += 10;
    confidence = Math.min(95, confidence);

    const trigger = structShift.detected
      ? `5min CHoCH bearish at ${structShift.price.toFixed(1)} after sweep of 4H high`
      : `Clean bearish sweep of 4H high with ${manipulation.isClean ? 'pin bar' : 'recovery'}`;

    return {
      active: true,
      direction: 'SHORT',
      entry,
      stopLoss,
      takeProfit1: tp1,
      takeProfit2: tp2,
      takeProfit3: tp3,
      riskReward1: (entry - tp1) / risk,
      riskReward2: (entry - tp2) / risk,
      riskReward3: (entry - tp3) / risk,
      confidence,
      trigger,
      invalidation: `Close above ${stopLoss.toFixed(1)} (above manipulation wick)`,
    };
  }

  return noEntry;
}

function calc5minATR(candles: CandlestickData[], period: number = 14): number {
  if (candles.length < period + 1) return (candles[candles.length - 1]?.high ?? 0) - (candles[candles.length - 1]?.low ?? 0) || 1;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    sum += tr;
  }
  return (sum / period) || 1;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MASTER AMD ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

export function analyzeAMD(candles5min: CandlestickData[]): AMDAnalysisResult {
  const defaultResult: AMDAnalysisResult = {
    roadmap: {
      previous: buildHTFCandle([]),
      current: buildHTFCandle([]),
      keyLevels: { prevHigh: 0, prevLow: 0, prevMid: 0, prevOpen: 0, prevClose: 0, currentOpen: 0, currentHigh: 0, currentLow: 0 },
      prevRange: 0,
      isExpanded: false,
      bias4H: 'neutral',
    },
    phase: 'unknown',
    phaseProgress: 0,
    phaseTiming: 'Insufficient data',
    accumulation: { high: 0, low: 0, midPrice: 0, rangeWidth: 0, rangePct: 0, candlesInRange: 0, detected: false, tightness: 0 },
    manipulation: { detected: false, type: 'none', direction: 'none', sweepPrice: 0, levelSwept: 0, recoveryPrice: 0, recoveryStrength: 0, candleIndex: -1, time: 0, wickSize: 0, isClean: false, description: 'Insufficient data' },
    distribution: { detected: false, direction: 'none', startPrice: 0, currentPrice: 0, targetPrice: 0, moveSize: 0, progressPct: 0, momentumConfirmed: false, structureConfirmed: false },
    entry: { active: false, direction: 'NONE', entry: 0, stopLoss: 0, takeProfit1: 0, takeProfit2: 0, takeProfit3: 0, riskReward1: 0, riskReward2: 0, riskReward3: 0, confidence: 0, trigger: 'Insufficient data', invalidation: '-' },
    session: detectSessionWindow(),
    shadowConfirmation: { confirms: false, bias: 'neutral', stopHuntDetected: false, recentPattern: 'none' },
    score: 0,
    summary: 'Need at least 96 five-minute candles (2 × 4H) for AMD analysis',
  };

  // Need at least 2 complete 4H buckets worth of 5min candles
  if (candles5min.length < 96) return defaultResult;

  // ── Split into 4H buckets ──
  const buckets = split4HBuckets(candles5min);
  if (buckets.length < 2) return defaultResult;

  // Previous completed 4H candle = second-to-last bucket
  const prevBucket = buckets[buckets.length - 2];
  const currentBucket = buckets[buckets.length - 1];

  const prev4H = buildHTFCandle(prevBucket);
  const current4H = buildHTFCandle(currentBucket);

  // Average 4H range from all completed buckets
  const completedBuckets = buckets.slice(0, -1);
  const avg4HRange = completedBuckets.reduce((s, b) => {
    const h = buildHTFCandle(b);
    return s + h.range;
  }, 0) / completedBuckets.length;

  const roadmap: FourHourRoadmap = {
    previous: prev4H,
    current: current4H,
    keyLevels: {
      prevHigh: prev4H.high,
      prevLow: prev4H.low,
      prevMid: prev4H.midPoint,
      prevOpen: prev4H.open,
      prevClose: prev4H.close,
      currentOpen: current4H.open,
      currentHigh: current4H.high,
      currentLow: current4H.low,
    },
    prevRange: prev4H.range,
    isExpanded: prev4H.range > avg4HRange * 1.2,
    bias4H: prev4H.isBullish ? 'bullish' : prev4H.bodySize < prev4H.range * 0.1 ? 'neutral' : 'bearish',
  };

  // ── Phase Progress ──
  // How far are we into the current 4H candle?
  const expectedCandles = 48; // 4H / 5min
  const currentCount = currentBucket.length;
  const phaseProgress = Math.min(100, (currentCount / expectedCandles) * 100);

  // ── Accumulation Detection ──
  const accumulation = detectAccumulation(currentBucket, prev4H.range);

  // ── Manipulation Detection ──
  const manipulation = detectManipulation(
    currentBucket, prev4H.high, prev4H.low, accumulation,
  );

  // ── Shadow Analysis on current 5min data ──
  const shadows = analyzeShadows(candles5min, { lookback: 50, clusterLookback: 100 });
  const shadowConfirmation = {
    confirms: manipulation.detected && (
      (manipulation.direction === 'bullish' && shadows.bias === 'bullish') ||
      (manipulation.direction === 'bearish' && shadows.bias === 'bearish')
    ),
    bias: shadows.bias,
    stopHuntDetected: shadows.stopHunts.length > 0,
    recentPattern: shadows.patterns.length > 0 ? shadows.patterns[0].type : 'none',
  };

  // ── Distribution Detection ──
  const distribution = detectDistribution(
    currentBucket, manipulation,
    prev4H.high, prev4H.low, prev4H.midPoint,
  );

  // ── Session Window ──
  const session = detectSessionWindow();

  // ── Determine current AMD phase ──
  let phase: AMDPhase = 'unknown';
  if (distribution.detected && distribution.progressPct > 20) {
    phase = 'distribution';
  } else if (manipulation.detected) {
    phase = distribution.detected ? 'distribution' : 'manipulation';
  } else if (accumulation.detected) {
    phase = 'accumulation';
  } else if (phaseProgress < 30) {
    phase = 'accumulation'; // early in 4H = likely accumulation
  } else {
    phase = 'unknown';
  }

  // ── Phase timing description ──
  const candlesLeft = expectedCandles - currentCount;
  const minutesLeft = candlesLeft * 5;
  const phaseTiming =
    phase === 'accumulation' ? `Accumulation — ${currentCount}/${expectedCandles} candles (${minutesLeft}min left in 4H)`
    : phase === 'manipulation' ? `Manipulation detected at candle ${manipulation.candleIndex + 1}/${currentCount} — watch for 5min CHoCH`
    : phase === 'distribution' ? `Distribution — ${distribution.progressPct.toFixed(0)}% to target (${minutesLeft}min left in 4H)`
    : `Phase unclear — ${currentCount}/${expectedCandles} candles into current 4H`;

  // ── Entry Signal ──
  const entry = generateEntrySignal(
    currentBucket, manipulation, distribution, roadmap, shadows, session,
  );

  // ── Overall AMD Score ──
  let score = 0;
  if (accumulation.detected) score += accumulation.tightness * 0.15;
  if (manipulation.detected) score += 30 + manipulation.recoveryStrength * 0.2;
  if (distribution.detected) score += 10 + distribution.progressPct * 0.1;
  if (entry.active) score += entry.confidence * 0.2;
  if (session.quality === 'premium') score += 10;
  else if (session.quality === 'good') score += 5;
  if (shadowConfirmation.confirms) score += 10;
  score = Math.min(100, score);

  // ── Summary ──
  let summary = '';
  if (entry.active) {
    summary = `${entry.direction === 'LONG' ? '🟢' : '🔴'} AMD ${entry.direction} signal — ${entry.trigger} | Confidence: ${entry.confidence}% | R:R ${entry.riskReward2.toFixed(1)}`;
  } else if (phase === 'manipulation') {
    summary = `⚡ Manipulation detected — ${manipulation.description} | Waiting for 5min confirmation`;
  } else if (phase === 'accumulation') {
    summary = `📦 Accumulation phase — range ${accumulation.rangePct.toFixed(0)}% of 4H | Tightness: ${accumulation.tightness}% | Wait for sweep`;
  } else if (phase === 'distribution') {
    summary = `🚀 Distribution in progress — ${distribution.progressPct.toFixed(0)}% to target | Momentum: ${distribution.momentumConfirmed ? '✅' : '❌'}`;
  } else {
    summary = `👁 Watching — ${phaseProgress.toFixed(0)}% into 4H candle | ${session.name} (${session.quality})`;
  }

  return {
    roadmap,
    phase,
    phaseProgress,
    phaseTiming,
    accumulation,
    manipulation,
    distribution,
    entry,
    session,
    shadowConfirmation,
    score,
    summary,
  };
}

