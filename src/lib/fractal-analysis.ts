import type { CandlestickData } from "lightweight-charts";

// ═══════════════════════════════════════════════════════════════════════════════
// FRACTAL ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
//
//  1. Williams Fractals (5-bar, 7-bar, 9-bar)
//  2. Fractal Levels — S/R from fractal highs/lows
//  3. Fractal Clusters — multiple fractals at same price = hidden S/R
//  4. Fractal Breakout Signals
//  5. Fractal Dimension (Hurst Exponent) — trend vs chop filter
//  6. Williams Alligator — Jaw/Teeth/Lips + fractal trade filter
//  7. Fractal Bands / Channels
//  8. Multi-TF fractal overlay
//  9. Self-similarity score
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Types ───────────────────────────────────────────────────────────────────

export type FractalPoint = {
  index: number;
  time: number;
  price: number;
  type: 'high' | 'low';
  order: number;               // fractal order (2=5bar, 3=7bar, 4=9bar)
  strength: number;            // 0-100 (higher order + larger range = stronger)
  broken: boolean;             // has price closed beyond this fractal?
  brokenAt?: number;           // index where it was broken
  isActive: boolean;           // still unbroken / relevant
  distanceFromPrice: number;   // absolute distance from current price
  distancePct: number;         // distance as % of price
};

export type FractalLevel = {
  price: number;
  type: 'support' | 'resistance';
  strength: number;            // 0-100
  touchCount: number;          // how many fractals at this level
  fractals: FractalPoint[];    // the fractal points that make up this level
  isCluster: boolean;          // 3+ fractals = cluster
  lastTouch: number;           // timestamp of most recent fractal
  freshness: number;           // 0-100
};

export type FractalBreakout = {
  index: number;
  time: number;
  price: number;
  direction: 'bullish' | 'bearish';
  brokenLevel: number;         // the fractal level that was broken
  levelStrength: number;       // strength of the broken level
  breakStrength: number;       // 0-100 (body close beyond, volume, etc.)
  type: 'breakout' | 'retest'; // initial break or retest of broken level
  description: string;
};

export type AlligatorState = {
  jaw: number;                 // 13-period SMMA, shifted 8 bars (blue)
  teeth: number;               // 8-period SMMA, shifted 5 bars (red)
  lips: number;                // 5-period SMMA, shifted 3 bars (green)
  state: 'sleeping' | 'awakening' | 'eating-bull' | 'eating-bear' | 'sated';
  mouthWidth: number;          // distance between jaw and lips (normalized)
  direction: 'bullish' | 'bearish' | 'neutral';
  description: string;
};

export type FractalDimension = {
  value: number;               // 1.0-2.0 (1=trending, 1.5=random, 2=mean-revert)
  hurstExponent: number;       // H: >0.5=trending, 0.5=random, <0.5=mean-revert
  regime: 'trending' | 'random' | 'mean-reverting';
  tradingAdvice: 'trend-follow' | 'mean-revert' | 'stay-out';
  confidence: number;          // 0-100
};

export type FractalBand = {
  upperBand: number[];         // fractal high envelope
  lowerBand: number[];         // fractal low envelope
  midBand: number[];           // midpoint
  currentUpper: number;
  currentLower: number;
  currentMid: number;
  bandwidth: number;           // upper - lower
  bandwidthPct: number;        // bandwidth as % of price
  pricePosition: number;       // 0-100 (0=at lower, 100=at upper)
};

export type SelfSimilarity = {
  score: number;               // 0-100 (how similar patterns are across TFs)
  patternMatch: string;        // description of matching pattern
  timeframes: { tf: string; trend: 'up' | 'down' | 'flat'; fractalBias: 'bullish' | 'bearish' | 'neutral' }[];
  alignment: 'aligned' | 'divergent' | 'mixed';
};

export type FractalAnalysisResult = {
  // All detected fractals
  fractals: FractalPoint[];
  activeFractals: FractalPoint[];   // unbroken fractals only
  // Fractal S/R levels
  levels: FractalLevel[];
  nearestSupport: FractalLevel | null;
  nearestResistance: FractalLevel | null;
  // Breakout signals
  breakouts: FractalBreakout[];
  // Alligator
  alligator: AlligatorState;
  // Fractal Dimension
  dimension: FractalDimension;
  // Fractal Bands
  bands: FractalBand;
  // Self-similarity
  selfSimilarity: SelfSimilarity;
  // Aggregate
  score: number;               // -100 to +100
  bias: 'bullish' | 'bearish' | 'neutral';
  summary: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Smoothed Moving Average (SMMA / RMA) */
function smma(data: number[], period: number): number[] {
  const result: number[] = new Array(data.length).fill(NaN);
  if (data.length < period) return result;

  // First value = SMA
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  result[period - 1] = sum / period;

  // Subsequent values
  for (let i = period; i < data.length; i++) {
    result[i] = (result[i - 1] * (period - 1) + data[i]) / period;
  }
  return result;
}

/** Simple Moving Average */
function sma(data: number[], period: number): number[] {
  const result: number[] = new Array(data.length).fill(NaN);
  if (data.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  result[period - 1] = sum / period;
  for (let i = period; i < data.length; i++) {
    sum += data[i] - data[i - period];
    result[i] = sum / period;
  }
  return result;
}

function calcATR(candles: CandlestickData[], period: number = 14): number {
  if (candles.length < period + 1) return (candles[candles.length - 1]?.high ?? 0) - (candles[candles.length - 1]?.low ?? 0) || 0.0001;
  let s = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    s += tr;
  }
  return (s / period) || 0.0001;
}

// ─── Williams Fractals Detection ─────────────────────────────────────────────

function detectWilliamsFractals(
  candles: CandlestickData[],
  currentPrice: number,
  lookback: number,
): FractalPoint[] {
  const fractals: FractalPoint[] = [];
  const startIdx = Math.max(0, candles.length - lookback);

  // Detect fractals at multiple orders (2=5bar, 3=7bar, 4=9bar)
  for (const order of [2, 3, 4]) {
    const barsEachSide = order;
    for (let i = Math.max(startIdx, barsEachSide); i < candles.length - barsEachSide; i++) {
      const c = candles[i];

      // Fractal High: middle bar has highest high
      let isFractalHigh = true;
      for (let j = i - barsEachSide; j <= i + barsEachSide; j++) {
        if (j === i) continue;
        if (candles[j].high >= c.high) { isFractalHigh = false; break; }
      }

      if (isFractalHigh) {
        // Check if this fractal has been broken
        let broken = false;
        let brokenAt: number | undefined;
        for (let k = i + barsEachSide + 1; k < candles.length; k++) {
          if (candles[k].close > c.high) {
            broken = true;
            brokenAt = k;
            break;
          }
        }

        const dist = Math.abs(c.high - currentPrice);
        const distPct = (dist / currentPrice) * 100;
        // Strength: higher order fractals are stronger
        const rangeContext = candles.slice(Math.max(0, i - 10), i + 1);
        const avgRange = rangeContext.reduce((s, cc) => s + (cc.high - cc.low), 0) / rangeContext.length;
        const prominence = avgRange > 0 ? (c.high - Math.min(...candles.slice(i - barsEachSide, i + barsEachSide + 1).map(cc => cc.low))) / avgRange : 0;
        const strength = Math.min(100, order * 15 + Math.min(40, prominence * 10) + (broken ? 0 : 20));

        fractals.push({
          index: i,
          time: c.time as number,
          price: c.high,
          type: 'high',
          order,
          strength,
          broken,
          brokenAt,
          isActive: !broken,
          distanceFromPrice: dist,
          distancePct: distPct,
        });
      }

      // Fractal Low: middle bar has lowest low
      let isFractalLow = true;
      for (let j = i - barsEachSide; j <= i + barsEachSide; j++) {
        if (j === i) continue;
        if (candles[j].low <= c.low) { isFractalLow = false; break; }
      }

      if (isFractalLow) {
        let broken = false;
        let brokenAt: number | undefined;
        for (let k = i + barsEachSide + 1; k < candles.length; k++) {
          if (candles[k].close < c.low) {
            broken = true;
            brokenAt = k;
            break;
          }
        }

        const dist = Math.abs(c.low - currentPrice);
        const distPct = (dist / currentPrice) * 100;
        const rangeContext = candles.slice(Math.max(0, i - 10), i + 1);
        const avgRange = rangeContext.reduce((s, cc) => s + (cc.high - cc.low), 0) / rangeContext.length;
        const prominence = avgRange > 0 ? (Math.max(...candles.slice(i - barsEachSide, i + barsEachSide + 1).map(cc => cc.high)) - c.low) / avgRange : 0;
        const strength = Math.min(100, order * 15 + Math.min(40, prominence * 10) + (broken ? 0 : 20));

        fractals.push({
          index: i,
          time: c.time as number,
          price: c.low,
          type: 'low',
          order,
          strength,
          broken,
          brokenAt,
          isActive: !broken,
          distanceFromPrice: dist,
          distancePct: distPct,
        });
      }
    }
  }

  // Deduplicate: keep higher-order fractal if same index appears at multiple orders
  const uniqueMap = new Map<string, FractalPoint>();
  for (const f of fractals) {
    const key = `${f.index}-${f.type}`;
    const existing = uniqueMap.get(key);
    if (!existing || f.order > existing.order) {
      uniqueMap.set(key, f);
    }
  }

  return Array.from(uniqueMap.values()).sort((a, b) => a.index - b.index);
}

// ─── Fractal Levels (S/R from fractal clusters) ─────────────────────────────

function buildFractalLevels(
  fractals: FractalPoint[],
  currentPrice: number,
  atr: number,
): FractalLevel[] {
  const levels: FractalLevel[] = [];
  const tolerance = atr * 0.4; // price zone width

  // Group fractals by price proximity
  const used = new Set<number>();

  for (let i = 0; i < fractals.length; i++) {
    if (used.has(i)) continue;
    const group: FractalPoint[] = [fractals[i]];
    used.add(i);

    for (let j = i + 1; j < fractals.length; j++) {
      if (used.has(j)) continue;
      if (Math.abs(fractals[i].price - fractals[j].price) <= tolerance) {
        group.push(fractals[j]);
        used.add(j);
      }
    }

    if (group.length < 1) continue;

    const avgPrice = group.reduce((s, f) => s + f.price, 0) / group.length;
    const type: 'support' | 'resistance' = avgPrice < currentPrice ? 'support' : 'resistance';
    const lastTouch = Math.max(...group.map(f => f.time));
    const mostRecentIdx = Math.max(...group.map(f => f.index));
    const totalFractals = fractals.length;
    const freshness = totalFractals > 0 ? Math.min(100, (mostRecentIdx / (fractals[fractals.length - 1]?.index || 1)) * 100) : 0;

    // Strength: more fractals + higher order + active = stronger
    const avgStrength = group.reduce((s, f) => s + f.strength, 0) / group.length;
    const countBonus = Math.min(30, group.length * 10);
    const activeBonus = group.some(f => f.isActive) ? 15 : 0;
    const strength = Math.min(100, avgStrength * 0.5 + countBonus + activeBonus + freshness * 0.1);

    levels.push({
      price: avgPrice,
      type,
      strength,
      touchCount: group.length,
      fractals: group,
      isCluster: group.length >= 3,
      lastTouch,
      freshness,
    });
  }

  // Sort by distance to current price
  levels.sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice));
  return levels.slice(0, 20); // max 20 levels
}

// ─── Fractal Breakout Detection ──────────────────────────────────────────────

function detectFractalBreakouts(
  candles: CandlestickData[],
  fractals: FractalPoint[],
  levels: FractalLevel[],
  lookback: number,
): FractalBreakout[] {
  const breakouts: FractalBreakout[] = [];
  const startIdx = Math.max(0, candles.length - lookback);

  // Check for recent breakouts of fractal levels
  for (const level of levels) {
    for (let i = Math.max(startIdx, 1); i < candles.length; i++) {
      const c = candles[i];
      const prev = candles[i - 1];

      // Bullish breakout: close above resistance level (was below before)
      if (level.type === 'resistance' && prev.close <= level.price && c.close > level.price) {
        const bodySize = Math.abs(c.close - c.open);
        const avgBody = candles.slice(Math.max(0, i - 10), i).reduce((s, cc) => s + Math.abs(cc.close - cc.open), 0) / 10;
        const breakStrength = Math.min(100, 30 + (bodySize / (avgBody || 1)) * 25 + level.strength * 0.3);

        breakouts.push({
          index: i,
          time: c.time as number,
          price: c.close,
          direction: 'bullish',
          brokenLevel: level.price,
          levelStrength: level.strength,
          breakStrength,
          type: 'breakout',
          description: `Bullish fractal breakout above ${level.price.toFixed(1)} (${level.touchCount} touches, strength ${level.strength.toFixed(0)}%)`,
        });
        break; // one breakout per level
      }

      // Bearish breakout: close below support level
      if (level.type === 'support' && prev.close >= level.price && c.close < level.price) {
        const bodySize = Math.abs(c.close - c.open);
        const avgBody = candles.slice(Math.max(0, i - 10), i).reduce((s, cc) => s + Math.abs(cc.close - cc.open), 0) / 10;
        const breakStrength = Math.min(100, 30 + (bodySize / (avgBody || 1)) * 25 + level.strength * 0.3);

        breakouts.push({
          index: i,
          time: c.time as number,
          price: c.close,
          direction: 'bearish',
          brokenLevel: level.price,
          levelStrength: level.strength,
          breakStrength,
          type: 'breakout',
          description: `Bearish fractal breakout below ${level.price.toFixed(1)} (${level.touchCount} touches, strength ${level.strength.toFixed(0)}%)`,
        });
        break;
      }
    }
  }

  breakouts.sort((a, b) => b.index - a.index);
  return breakouts.slice(0, 10);
}

// ─── Williams Alligator ──────────────────────────────────────────────────────

function calculateAlligator(candles: CandlestickData[]): AlligatorState {
  const defaultState: AlligatorState = {
    jaw: 0, teeth: 0, lips: 0,
    state: 'sleeping', mouthWidth: 0,
    direction: 'neutral',
    description: 'Insufficient data for Alligator',
  };

  if (candles.length < 21) return defaultState;

  // Median price = (high + low) / 2
  const medianPrices = candles.map(c => (c.high + c.low) / 2);

  // Jaw = 13-period SMMA, shifted 8 bars forward
  const jawRaw = smma(medianPrices, 13);
  // Teeth = 8-period SMMA, shifted 5 bars forward
  const teethRaw = smma(medianPrices, 8);
  // Lips = 5-period SMMA, shifted 3 bars forward
  const lipsRaw = smma(medianPrices, 5);

  // Apply shifts (we read from earlier indices to simulate forward shift)
  const jawIdx = candles.length - 1 - 8;
  const teethIdx = candles.length - 1 - 5;
  const lipsIdx = candles.length - 1 - 3;

  const jaw = jawIdx >= 0 && !isNaN(jawRaw[jawIdx]) ? jawRaw[jawIdx] : medianPrices[candles.length - 1];
  const teeth = teethIdx >= 0 && !isNaN(teethRaw[teethIdx]) ? teethRaw[teethIdx] : medianPrices[candles.length - 1];
  const lips = lipsIdx >= 0 && !isNaN(lipsRaw[lipsIdx]) ? lipsRaw[lipsIdx] : medianPrices[candles.length - 1];

  const currentPrice = candles[candles.length - 1].close;
  const atr = calcATR(candles, 14);

  // Mouth width (normalized by ATR)
  const mouthWidth = atr > 0 ? Math.abs(lips - jaw) / atr : 0;

  // Determine direction
  const lipsAboveTeeth = lips > teeth;
  const teethAboveJaw = teeth > jaw;
  const allBull = lipsAboveTeeth && teethAboveJaw; // Lips > Teeth > Jaw
  const allBear = !lipsAboveTeeth && !teethAboveJaw; // Jaw > Teeth > Lips

  const direction: 'bullish' | 'bearish' | 'neutral' =
    allBull ? 'bullish' : allBear ? 'bearish' : 'neutral';

  // Determine state
  let state: AlligatorState['state'];
  let description: string;

  if (mouthWidth < 0.3) {
    state = 'sleeping';
    description = 'Alligator sleeping — lines intertwined, market ranging. Wait for awakening.';
  } else if (mouthWidth < 0.8) {
    if (allBull || allBear) {
      state = 'awakening';
      description = `Alligator awakening ${direction} — mouth opening, prepare for trend.`;
    } else {
      state = 'sleeping';
      description = 'Alligator lines tangled — no clear trend, avoid trading.';
    }
  } else if (mouthWidth >= 0.8) {
    if (allBull) {
      state = 'eating-bull';
      description = 'Alligator eating BULLISH 🐊🟢 — strong uptrend, trade long with fractals above Teeth.';
    } else if (allBear) {
      state = 'eating-bear';
      description = 'Alligator eating BEARISH 🐊🔴 — strong downtrend, trade short with fractals below Teeth.';
    } else {
      state = 'sated';
      description = 'Alligator sated — trend may be exhausting, tighten stops.';
    }
  } else {
    state = 'sleeping';
    description = 'Alligator neutral — wait for clear signal.';
  }

  // Check for sated: mouth was wide but now narrowing
  if (state === 'eating-bull' || state === 'eating-bear') {
    // Compare current mouth width with 5 bars ago
    const prevJawIdx = Math.max(0, jawIdx - 5);
    const prevLipsIdx = Math.max(0, lipsIdx - 5);
    const prevJaw = prevJawIdx >= 0 && !isNaN(jawRaw[prevJawIdx]) ? jawRaw[prevJawIdx] : jaw;
    const prevLips = prevLipsIdx >= 0 && !isNaN(lipsRaw[prevLipsIdx]) ? lipsRaw[prevLipsIdx] : lips;
    const prevWidth = atr > 0 ? Math.abs(prevLips - prevJaw) / atr : mouthWidth;

    if (prevWidth > mouthWidth * 1.3) {
      state = 'sated';
      description = 'Alligator sated — mouth narrowing, trend exhaustion possible. Protect profits.';
    }
  }

  return { jaw, teeth, lips, state, mouthWidth, direction, description };
}

// ─── Fractal Dimension (Hurst Exponent via R/S Analysis) ─────────────────────

function calculateFractalDimension(candles: CandlestickData[]): FractalDimension {
  const defaultDim: FractalDimension = {
    value: 1.5, hurstExponent: 0.5,
    regime: 'random', tradingAdvice: 'stay-out', confidence: 0,
  };

  if (candles.length < 50) return defaultDim;

  const closes = candles.map(c => c.close);
  const returns = closes.slice(1).map((c, i) => Math.log(c / closes[i]));

  if (returns.length < 30) return defaultDim;

  // Rescaled Range (R/S) analysis for Hurst Exponent
  const segments = [8, 16, 32];
  const logN: number[] = [];
  const logRS: number[] = [];

  for (const n of segments) {
    if (returns.length < n) continue;

    const numSegments = Math.floor(returns.length / n);
    if (numSegments < 1) continue;

    let totalRS = 0;
    let validSegments = 0;

    for (let seg = 0; seg < numSegments; seg++) {
      const slice = returns.slice(seg * n, (seg + 1) * n);
      const mean = slice.reduce((s, v) => s + v, 0) / n;

      // Cumulative deviations
      const cumDev: number[] = [];
      let cumSum = 0;
      for (const v of slice) {
        cumSum += v - mean;
        cumDev.push(cumSum);
      }

      const R = Math.max(...cumDev) - Math.min(...cumDev);
      const S = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / n);

      if (S > 0) {
        totalRS += R / S;
        validSegments++;
      }
    }

    if (validSegments > 0) {
      logN.push(Math.log(n));
      logRS.push(Math.log(totalRS / validSegments));
    }
  }

  if (logN.length < 2) return defaultDim;

  // Linear regression to find Hurst exponent (slope of log(R/S) vs log(n))
  const n = logN.length;
  const sumX = logN.reduce((s, v) => s + v, 0);
  const sumY = logRS.reduce((s, v) => s + v, 0);
  const sumXY = logN.reduce((s, v, i) => s + v * logRS[i], 0);
  const sumX2 = logN.reduce((s, v) => s + v * v, 0);

  const denom = n * sumX2 - sumX * sumX;
  const hurstExponent = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0.5;
  const H = Math.max(0.01, Math.min(0.99, hurstExponent));

  // Fractal Dimension = 2 - H
  const fractalDim = 2 - H;

  // Determine regime
  let regime: FractalDimension['regime'];
  let tradingAdvice: FractalDimension['tradingAdvice'];

  if (H > 0.6) {
    regime = 'trending';
    tradingAdvice = 'trend-follow';
  } else if (H < 0.4) {
    regime = 'mean-reverting';
    tradingAdvice = 'mean-revert';
  } else {
    regime = 'random';
    tradingAdvice = 'stay-out';
  }

  // Confidence: how far from 0.5 (random) → higher confidence
  const confidence = Math.min(100, Math.abs(H - 0.5) * 200);

  return { value: fractalDim, hurstExponent: H, regime, tradingAdvice, confidence };
}

// ─── Fractal Bands (envelope of fractal highs/lows) ──────────────────────────

function calculateFractalBands(
  candles: CandlestickData[],
  fractals: FractalPoint[],
): FractalBand {
  const empty: FractalBand = {
    upperBand: [], lowerBand: [], midBand: [],
    currentUpper: 0, currentLower: 0, currentMid: 0,
    bandwidth: 0, bandwidthPct: 0, pricePosition: 50,
  };

  if (candles.length < 10 || fractals.length < 4) return empty;

  const fractalHighs = fractals.filter(f => f.type === 'high').sort((a, b) => a.index - b.index);
  const fractalLows = fractals.filter(f => f.type === 'low').sort((a, b) => a.index - b.index);

  if (fractalHighs.length < 2 || fractalLows.length < 2) return empty;

  // Interpolate fractal highs and lows across all candle indices
  const upperBand: number[] = new Array(candles.length).fill(NaN);
  const lowerBand: number[] = new Array(candles.length).fill(NaN);
  const midBand: number[] = new Array(candles.length).fill(NaN);

  // Fill in fractal high values at their indices
  for (const fh of fractalHighs) {
    if (fh.index < candles.length) upperBand[fh.index] = fh.price;
  }
  for (const fl of fractalLows) {
    if (fl.index < candles.length) lowerBand[fl.index] = fl.price;
  }

  // Forward-fill (carry last known fractal value forward)
  let lastUpper = fractalHighs[0].price;
  let lastLower = fractalLows[0].price;
  for (let i = 0; i < candles.length; i++) {
    if (!isNaN(upperBand[i])) lastUpper = upperBand[i];
    else upperBand[i] = lastUpper;

    if (!isNaN(lowerBand[i])) lastLower = lowerBand[i];
    else lowerBand[i] = lastLower;

    midBand[i] = (upperBand[i] + lowerBand[i]) / 2;
  }

  const currentUpper = upperBand[candles.length - 1];
  const currentLower = lowerBand[candles.length - 1];
  const currentMid = midBand[candles.length - 1];
  const currentPrice = candles[candles.length - 1].close;
  const bandwidth = currentUpper - currentLower;
  const bandwidthPct = currentPrice > 0 ? (bandwidth / currentPrice) * 100 : 0;
  const pricePosition = bandwidth > 0
    ? Math.max(0, Math.min(100, ((currentPrice - currentLower) / bandwidth) * 100))
    : 50;

  return {
    upperBand, lowerBand, midBand,
    currentUpper, currentLower, currentMid,
    bandwidth, bandwidthPct, pricePosition,
  };
}

// ─── Self-Similarity (multi-TF fractal pattern comparison) ───────────────────

function analyzeSelfSimilarity(candles: CandlestickData[]): SelfSimilarity {
  const defaultSS: SelfSimilarity = {
    score: 0, patternMatch: 'Insufficient data',
    timeframes: [], alignment: 'mixed',
  };

  if (candles.length < 60) return defaultSS;

  // Analyze fractal bias at different "zoom levels" by sampling
  const timeframes: SelfSimilarity['timeframes'] = [];

  // Raw (1x) — last 20 candles
  const bias1 = fractalBias(candles.slice(-20));
  timeframes.push({ tf: '1x (recent)', ...bias1 });

  // 5x — resample by 5
  const candles5 = resample(candles, 5);
  if (candles5.length >= 10) {
    const bias5 = fractalBias(candles5.slice(-10));
    timeframes.push({ tf: '5x (medium)', ...bias5 });
  }

  // 15x — resample by 15
  const candles15 = resample(candles, 15);
  if (candles15.length >= 8) {
    const bias15 = fractalBias(candles15.slice(-8));
    timeframes.push({ tf: '15x (higher)', ...bias15 });
  }

  // 60x — resample by 60
  const candles60 = resample(candles, 60);
  if (candles60.length >= 5) {
    const bias60 = fractalBias(candles60.slice(-5));
    timeframes.push({ tf: '60x (macro)', ...bias60 });
  }

  // Check alignment
  const bullCount = timeframes.filter(t => t.fractalBias === 'bullish').length;
  const bearCount = timeframes.filter(t => t.fractalBias === 'bearish').length;
  const total = timeframes.length;

  const alignment: SelfSimilarity['alignment'] =
    bullCount >= total * 0.75 ? 'aligned'
    : bearCount >= total * 0.75 ? 'aligned'
    : (bullCount === 0 || bearCount === 0) ? 'aligned'
    : 'mixed';

  // Similarity score
  const maxBias = Math.max(bullCount, bearCount);
  const score = total > 0 ? Math.round((maxBias / total) * 100) : 0;

  const dominantDirection = bullCount > bearCount ? 'bullish' : bearCount > bullCount ? 'bearish' : 'neutral';
  const patternMatch = alignment === 'aligned'
    ? `All timeframes show ${dominantDirection} fractal bias — high self-similarity`
    : `Mixed fractal bias across timeframes — ${bullCount} bullish, ${bearCount} bearish`;

  return { score, patternMatch, timeframes, alignment };
}

function resample(candles: CandlestickData[], factor: number): CandlestickData[] {
  if (factor <= 1 || candles.length < factor) return candles;
  const result: CandlestickData[] = [];
  for (let i = 0; i <= candles.length - factor; i += factor) {
    const slice = candles.slice(i, i + factor);
    result.push({
      open: slice[0].open,
      high: Math.max(...slice.map(c => c.high)),
      low: Math.min(...slice.map(c => c.low)),
      close: slice[slice.length - 1].close,
      time: slice[slice.length - 1].time,
    });
  }
  return result;
}

function fractalBias(candles: CandlestickData[]): { trend: 'up' | 'down' | 'flat'; fractalBias: 'bullish' | 'bearish' | 'neutral' } {
  if (candles.length < 5) return { trend: 'flat', fractalBias: 'neutral' };

  // Simple trend: compare first vs last close
  const first = candles[0].close;
  const last = candles[candles.length - 1].close;
  const changePct = ((last - first) / first) * 100;

  const trend: 'up' | 'down' | 'flat' =
    changePct > 0.2 ? 'up' : changePct < -0.2 ? 'down' : 'flat';

  // Fractal bias: are recent fractal highs/lows making higher or lower swings?
  let higherHighs = 0;
  let lowerLows = 0;
  for (let i = 2; i < candles.length; i++) {
    if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i - 2].high) higherHighs++;
    if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i - 2].low) lowerLows++;
  }

  const fracBias: 'bullish' | 'bearish' | 'neutral' =
    higherHighs > lowerLows * 1.3 ? 'bullish'
    : lowerLows > higherHighs * 1.3 ? 'bearish'
    : 'neutral';

  return { trend, fractalBias: fracBias };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MASTER FRACTAL ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

export function analyzeFractals(
  candles: CandlestickData[],
  options: {
    lookback?: number;
  } = {},
): FractalAnalysisResult {
  const lookback = options.lookback ?? 100;

  const defaultResult: FractalAnalysisResult = {
    fractals: [], activeFractals: [],
    levels: [], nearestSupport: null, nearestResistance: null,
    breakouts: [],
    alligator: { jaw: 0, teeth: 0, lips: 0, state: 'sleeping', mouthWidth: 0, direction: 'neutral', description: 'Insufficient data' },
    dimension: { value: 1.5, hurstExponent: 0.5, regime: 'random', tradingAdvice: 'stay-out', confidence: 0 },
    bands: { upperBand: [], lowerBand: [], midBand: [], currentUpper: 0, currentLower: 0, currentMid: 0, bandwidth: 0, bandwidthPct: 0, pricePosition: 50 },
    selfSimilarity: { score: 0, patternMatch: 'Insufficient data', timeframes: [], alignment: 'mixed' },
    score: 0, bias: 'neutral',
    summary: 'Insufficient data for fractal analysis',
  };

  if (candles.length < 20) return defaultResult;

  const currentPrice = candles[candles.length - 1].close;
  const atr = calcATR(candles, 14);

  // 1. Detect Williams Fractals
  const fractals = detectWilliamsFractals(candles, currentPrice, lookback);
  const activeFractals = fractals.filter(f => f.isActive);

  // 2. Build fractal S/R levels
  const levels = buildFractalLevels(fractals, currentPrice, atr);
  const nearestSupport = levels.find(l => l.type === 'support') ?? null;
  const nearestResistance = levels.find(l => l.type === 'resistance') ?? null;

  // 3. Detect breakouts
  const breakouts = detectFractalBreakouts(candles, fractals, levels, Math.min(lookback, 30));

  // 4. Williams Alligator
  const alligator = calculateAlligator(candles);

  // 5. Fractal Dimension
  const dimension = calculateFractalDimension(candles);

  // 6. Fractal Bands
  const bands = calculateFractalBands(candles, fractals);

  // 7. Self-similarity
  const selfSimilarity = analyzeSelfSimilarity(candles);

  // ── Compute bias score ──
  let score = 0;

  // Alligator direction
  if (alligator.state === 'eating-bull') score += 25;
  else if (alligator.state === 'eating-bear') score -= 25;
  else if (alligator.state === 'awakening' && alligator.direction === 'bullish') score += 12;
  else if (alligator.state === 'awakening' && alligator.direction === 'bearish') score -= 12;

  // Fractal breakouts
  for (const bo of breakouts.slice(0, 3)) {
    score += bo.direction === 'bullish' ? 15 : -15;
  }

  // Active fractal proximity bias
  const nearHighFractals = activeFractals.filter(f => f.type === 'high' && f.distancePct < 1);
  const nearLowFractals = activeFractals.filter(f => f.type === 'low' && f.distancePct < 1);
  if (nearLowFractals.length > nearHighFractals.length) score += 10; // support nearby = bullish
  if (nearHighFractals.length > nearLowFractals.length) score -= 10; // resistance nearby = bearish

  // Band position
  if (bands.pricePosition < 20) score += 8;  // near lower band = mean-revert bullish
  if (bands.pricePosition > 80) score -= 8;  // near upper band = mean-revert bearish

  // Fractal dimension: boost signal in trending regime
  if (dimension.regime === 'trending') {
    score *= 1.2;
  } else if (dimension.regime === 'random') {
    score *= 0.5;
  }

  // Self-similarity boost
  if (selfSimilarity.alignment === 'aligned') score *= 1.15;

  score = Math.max(-100, Math.min(100, score));

  const bias: 'bullish' | 'bearish' | 'neutral' =
    score > 15 ? 'bullish' : score < -15 ? 'bearish' : 'neutral';

  // ── Summary ──
  const parts: string[] = [];
  if (alligator.state !== 'sleeping') {
    parts.push(`🐊 ${alligator.state.replace('-', ' ')} ${alligator.direction}`);
  }
  if (dimension.regime !== 'random') {
    parts.push(`FD: ${dimension.regime} (H=${dimension.hurstExponent.toFixed(2)})`);
  }
  if (breakouts.length > 0) {
    parts.push(`${breakouts[0].direction === 'bullish' ? '🟢' : '🔴'} Breakout ${breakouts[0].direction}`);
  }
  if (selfSimilarity.alignment === 'aligned') {
    parts.push(`✅ Aligned across TFs`);
  }
  const summary = parts.length > 0 ? parts.join(' | ') : `📐 ${activeFractals.length} active fractals, ${levels.length} levels`;

  return {
    fractals, activeFractals,
    levels, nearestSupport, nearestResistance,
    breakouts,
    alligator,
    dimension,
    bands,
    selfSimilarity,
    score, bias,
    summary,
  };
}

