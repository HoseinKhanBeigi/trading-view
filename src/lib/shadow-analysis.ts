import type { CandlestickData } from "lightweight-charts";

// ═══════════════════════════════════════════════════════════════════════════════
// SHADOW / WICK ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
//
// Analyzes candle shadows (wicks) for:
//  1. Per-candle shadow metrics (upper/lower wick %, body %, ratios)
//  2. Shadow-based patterns (rejection candles, absorption wicks, stop hunts)
//  3. Shadow cluster zones (where wicks accumulate = hidden S/R)
//  4. Institutional wick signals (fake-outs, stop hunts, manipulation)
//  5. Overall shadow bias score (-100 to +100)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Types ───────────────────────────────────────────────────────────────────

export type ShadowMetrics = {
  upperWick: number;            // absolute size
  lowerWick: number;
  body: number;
  totalRange: number;
  upperWickPct: number;         // % of total range
  lowerWickPct: number;
  bodyPct: number;
  shadowRatio: number;          // total wick / body (higher = more rejection)
  upperToLowerRatio: number;    // upper wick / lower wick
  isBullish: boolean;
  dominantShadow: 'upper' | 'lower' | 'balanced';
};

export type ShadowPatternType =
  | 'bullish-pin-bar'           // long lower wick, small body at top
  | 'bearish-pin-bar'           // long upper wick, small body at bottom
  | 'bullish-rejection'         // strong lower wick rejection (not pin bar strict)
  | 'bearish-rejection'         // strong upper wick rejection
  | 'doji-indecision'           // near-equal wicks, tiny body
  | 'dragonfly'                 // long lower wick, no upper wick
  | 'gravestone'                // long upper wick, no lower wick
  | 'absorption-wick'           // large wick absorbed by next candle's body
  | 'stop-hunt-long'            // wick below support, close above
  | 'stop-hunt-short'           // wick above resistance, close below
  | 'hammer'                    // hammer after downtrend
  | 'shooting-star'             // shooting star after uptrend
  | 'engulfing-wick'            // wick fully engulfs previous candle
  | 'twin-wick-rejection'       // two consecutive candles with same-side long wicks
  | 'wick-reversal';            // price reversal signaled by wick cluster

export type ShadowPattern = {
  type: ShadowPatternType;
  direction: 'bullish' | 'bearish' | 'neutral';
  strength: number;             // 0-100
  index: number;                // candle index
  time: number;
  price: number;                // price of the wick tip
  rejectionPrice: number;       // the price level being rejected
  wickSize: number;             // size of the significant wick
  wickPct: number;              // wick as % of ATR
  description: string;
};

export type ShadowClusterZone = {
  priceHigh: number;
  priceLow: number;
  midPrice: number;
  wickCount: number;            // how many wicks touched this zone
  type: 'support' | 'resistance';
  strength: number;             // 0-100
  avgRejectionForce: number;    // average wick size at this zone
  lastTouch: number;            // timestamp
  freshness: number;            // 0-100 (100 = just formed)
};

export type StopHuntEvent = {
  index: number;
  time: number;
  type: 'long' | 'short';      // long stop hunt = wick below, short = wick above
  wickLow: number;              // the extreme of the hunt wick
  wickHigh: number;
  recoveryPrice: number;        // where price closed after the hunt
  levelHunted: number;          // the S/R level that was hunted
  strength: number;             // 0-100
  recovered: boolean;           // did price recover past the hunted level?
  description: string;
};

export type ShadowAnalysisResult = {
  // Per-candle metrics for recent candles
  recentMetrics: (ShadowMetrics & { index: number; time: number })[];
  // Detected shadow patterns
  patterns: ShadowPattern[];
  // Shadow cluster zones (hidden S/R from wick accumulation)
  clusterZones: ShadowClusterZone[];
  // Stop hunt events
  stopHunts: StopHuntEvent[];
  // Aggregate stats
  avgUpperWickPct: number;      // average upper wick % over lookback
  avgLowerWickPct: number;
  avgShadowRatio: number;
  wickDominance: 'upper' | 'lower' | 'balanced'; // which side has more wicks
  // Bias score
  score: number;                // -100 (bearish rejection) to +100 (bullish rejection)
  bias: 'bullish' | 'bearish' | 'neutral';
  summary: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcUpperWick(c: CandlestickData): number {
  return c.high - Math.max(c.open, c.close);
}

function calcLowerWick(c: CandlestickData): number {
  return Math.min(c.open, c.close) - c.low;
}

function calcBody(c: CandlestickData): number {
  return Math.abs(c.close - c.open);
}

function calcRange(c: CandlestickData): number {
  return c.high - c.low;
}

function calcATR(candles: CandlestickData[], period: number = 14): number {
  if (candles.length < period + 1) return calcRange(candles[candles.length - 1]) || 0.0001;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    sum += tr;
  }
  return sum / period || 0.0001;
}

// ─── Per-candle Shadow Metrics ───────────────────────────────────────────────

export function calcShadowMetrics(c: CandlestickData): ShadowMetrics {
  const uw = calcUpperWick(c);
  const lw = calcLowerWick(c);
  const body = calcBody(c);
  const range = calcRange(c) || 0.0001;

  const upperWickPct = (uw / range) * 100;
  const lowerWickPct = (lw / range) * 100;
  const bodyPct = (body / range) * 100;
  const shadowRatio = body > 0 ? (uw + lw) / body : (uw + lw) > 0 ? 999 : 0;
  const upperToLowerRatio = lw > 0 ? uw / lw : uw > 0 ? 999 : 1;

  let dominantShadow: 'upper' | 'lower' | 'balanced' = 'balanced';
  if (uw > lw * 1.5) dominantShadow = 'upper';
  else if (lw > uw * 1.5) dominantShadow = 'lower';

  return {
    upperWick: uw,
    lowerWick: lw,
    body,
    totalRange: range,
    upperWickPct,
    lowerWickPct,
    bodyPct,
    shadowRatio,
    upperToLowerRatio,
    isBullish: c.close >= c.open,
    dominantShadow,
  };
}

// ─── Shadow Pattern Detection ────────────────────────────────────────────────

function detectShadowPatterns(
  candles: CandlestickData[],
  lookback: number,
  atr: number,
): ShadowPattern[] {
  const patterns: ShadowPattern[] = [];
  const startIdx = Math.max(2, candles.length - lookback);

  for (let i = startIdx; i < candles.length; i++) {
    const c = candles[i];
    const m = calcShadowMetrics(c);
    const time = c.time as number;
    const wickThreshold = atr * 0.5; // significant wick = at least 50% of ATR

    // ── Bullish Pin Bar ──
    // Long lower wick (>60% of range), small body at top, small upper wick
    if (m.lowerWickPct > 60 && m.bodyPct < 30 && m.upperWickPct < 15 && m.lowerWick > wickThreshold) {
      const strength = Math.min(100, (m.lowerWickPct / 80) * 50 + (m.lowerWick / atr) * 30);
      patterns.push({
        type: 'bullish-pin-bar',
        direction: 'bullish',
        strength,
        index: i, time,
        price: c.low,
        rejectionPrice: c.low,
        wickSize: m.lowerWick,
        wickPct: (m.lowerWick / atr) * 100,
        description: `Bullish pin bar — ${m.lowerWickPct.toFixed(0)}% lower wick rejects ${c.low.toFixed(2)}`,
      });
    }

    // ── Bearish Pin Bar ──
    if (m.upperWickPct > 60 && m.bodyPct < 30 && m.lowerWickPct < 15 && m.upperWick > wickThreshold) {
      const strength = Math.min(100, (m.upperWickPct / 80) * 50 + (m.upperWick / atr) * 30);
      patterns.push({
        type: 'bearish-pin-bar',
        direction: 'bearish',
        strength,
        index: i, time,
        price: c.high,
        rejectionPrice: c.high,
        wickSize: m.upperWick,
        wickPct: (m.upperWick / atr) * 100,
        description: `Bearish pin bar — ${m.upperWickPct.toFixed(0)}% upper wick rejects ${c.high.toFixed(2)}`,
      });
    }

    // ── Bullish Rejection (less strict than pin bar) ──
    if (m.lowerWickPct > 45 && m.lowerWick > wickThreshold && m.lowerWick > m.upperWick * 2) {
      // Only add if not already a pin bar
      if (!(m.lowerWickPct > 60 && m.bodyPct < 30 && m.upperWickPct < 15)) {
        const strength = Math.min(85, (m.lowerWickPct / 70) * 40 + (m.lowerWick / atr) * 25);
        patterns.push({
          type: 'bullish-rejection',
          direction: 'bullish',
          strength,
          index: i, time,
          price: c.low,
          rejectionPrice: c.low,
          wickSize: m.lowerWick,
          wickPct: (m.lowerWick / atr) * 100,
          description: `Bullish rejection — lower wick ${m.lowerWickPct.toFixed(0)}% of range`,
        });
      }
    }

    // ── Bearish Rejection ──
    if (m.upperWickPct > 45 && m.upperWick > wickThreshold && m.upperWick > m.lowerWick * 2) {
      if (!(m.upperWickPct > 60 && m.bodyPct < 30 && m.lowerWickPct < 15)) {
        const strength = Math.min(85, (m.upperWickPct / 70) * 40 + (m.upperWick / atr) * 25);
        patterns.push({
          type: 'bearish-rejection',
          direction: 'bearish',
          strength,
          index: i, time,
          price: c.high,
          rejectionPrice: c.high,
          wickSize: m.upperWick,
          wickPct: (m.upperWick / atr) * 100,
          description: `Bearish rejection — upper wick ${m.upperWickPct.toFixed(0)}% of range`,
        });
      }
    }

    // ── Dragonfly (long lower wick, no upper wick, tiny body) ──
    if (m.lowerWickPct > 70 && m.upperWickPct < 5 && m.bodyPct < 15 && m.lowerWick > wickThreshold) {
      patterns.push({
        type: 'dragonfly',
        direction: 'bullish',
        strength: Math.min(95, 60 + (m.lowerWick / atr) * 20),
        index: i, time,
        price: c.low,
        rejectionPrice: c.low,
        wickSize: m.lowerWick,
        wickPct: (m.lowerWick / atr) * 100,
        description: `Dragonfly — pure lower wick rejection at ${c.low.toFixed(2)}`,
      });
    }

    // ── Gravestone (long upper wick, no lower wick, tiny body) ──
    if (m.upperWickPct > 70 && m.lowerWickPct < 5 && m.bodyPct < 15 && m.upperWick > wickThreshold) {
      patterns.push({
        type: 'gravestone',
        direction: 'bearish',
        strength: Math.min(95, 60 + (m.upperWick / atr) * 20),
        index: i, time,
        price: c.high,
        rejectionPrice: c.high,
        wickSize: m.upperWick,
        wickPct: (m.upperWick / atr) * 100,
        description: `Gravestone — pure upper wick rejection at ${c.high.toFixed(2)}`,
      });
    }

    // ── Doji Indecision (near-equal wicks, tiny body) ──
    if (m.bodyPct < 10 && m.upperWickPct > 30 && m.lowerWickPct > 30 && m.totalRange > atr * 0.3) {
      patterns.push({
        type: 'doji-indecision',
        direction: 'neutral',
        strength: Math.min(70, 40 + (m.totalRange / atr) * 20),
        index: i, time,
        price: (c.high + c.low) / 2,
        rejectionPrice: (c.high + c.low) / 2,
        wickSize: Math.max(m.upperWick, m.lowerWick),
        wickPct: (Math.max(m.upperWick, m.lowerWick) / atr) * 100,
        description: `Doji — equal rejection both sides, indecision at ${((c.high + c.low) / 2).toFixed(2)}`,
      });
    }

    // ── Hammer (long lower wick after downtrend) ──
    if (i >= 5 && m.lowerWick > m.body * 2 && m.upperWick < m.body * 0.5 && m.lowerWick > wickThreshold) {
      const prev5 = candles.slice(i - 5, i);
      const isDowntrend = prev5.length >= 3 && prev5[prev5.length - 1].close < prev5[0].close;
      if (isDowntrend) {
        patterns.push({
          type: 'hammer',
          direction: 'bullish',
          strength: Math.min(90, 50 + (m.lowerWick / atr) * 25),
          index: i, time,
          price: c.low,
          rejectionPrice: c.low,
          wickSize: m.lowerWick,
          wickPct: (m.lowerWick / atr) * 100,
          description: `Hammer — lower wick ${(m.lowerWick / m.body).toFixed(1)}x body after downtrend`,
        });
      }
    }

    // ── Shooting Star (long upper wick after uptrend) ──
    if (i >= 5 && m.upperWick > m.body * 2 && m.lowerWick < m.body * 0.5 && m.upperWick > wickThreshold) {
      const prev5 = candles.slice(i - 5, i);
      const isUptrend = prev5.length >= 3 && prev5[prev5.length - 1].close > prev5[0].close;
      if (isUptrend) {
        patterns.push({
          type: 'shooting-star',
          direction: 'bearish',
          strength: Math.min(90, 50 + (m.upperWick / atr) * 25),
          index: i, time,
          price: c.high,
          rejectionPrice: c.high,
          wickSize: m.upperWick,
          wickPct: (m.upperWick / atr) * 100,
          description: `Shooting star — upper wick ${(m.upperWick / m.body).toFixed(1)}x body after uptrend`,
        });
      }
    }

    // ── Engulfing Wick (wick fully covers previous candle's range) ──
    if (i >= 1) {
      const prev = candles[i - 1];
      const prevRange = calcRange(prev);
      // Lower wick engulfs previous candle downward
      if (c.low < prev.low && m.lowerWick > prevRange && m.isBullish) {
        patterns.push({
          type: 'engulfing-wick',
          direction: 'bullish',
          strength: Math.min(85, 45 + (m.lowerWick / prevRange) * 20),
          index: i, time,
          price: c.low,
          rejectionPrice: c.low,
          wickSize: m.lowerWick,
          wickPct: (m.lowerWick / atr) * 100,
          description: `Bullish engulfing wick — lower wick swallowed previous candle's range`,
        });
      }
      // Upper wick engulfs previous candle upward
      if (c.high > prev.high && m.upperWick > prevRange && !m.isBullish) {
        patterns.push({
          type: 'engulfing-wick',
          direction: 'bearish',
          strength: Math.min(85, 45 + (m.upperWick / prevRange) * 20),
          index: i, time,
          price: c.high,
          rejectionPrice: c.high,
          wickSize: m.upperWick,
          wickPct: (m.upperWick / atr) * 100,
          description: `Bearish engulfing wick — upper wick swallowed previous candle's range`,
        });
      }
    }

    // ── Twin Wick Rejection (2 consecutive candles with same-side long wicks) ──
    if (i >= 1) {
      const prev = candles[i - 1];
      const pm = calcShadowMetrics(prev);
      // Twin lower wicks
      if (m.lowerWickPct > 40 && pm.lowerWickPct > 40 && m.lowerWick > wickThreshold * 0.7 && pm.lowerWick > wickThreshold * 0.7) {
        const avgWickPrice = (c.low + prev.low) / 2;
        patterns.push({
          type: 'twin-wick-rejection',
          direction: 'bullish',
          strength: Math.min(90, 55 + ((m.lowerWickPct + pm.lowerWickPct) / 160) * 30),
          index: i, time,
          price: avgWickPrice,
          rejectionPrice: avgWickPrice,
          wickSize: (m.lowerWick + pm.lowerWick) / 2,
          wickPct: ((m.lowerWick + pm.lowerWick) / 2 / atr) * 100,
          description: `Twin lower wick rejection near ${avgWickPrice.toFixed(2)} — strong support`,
        });
      }
      // Twin upper wicks
      if (m.upperWickPct > 40 && pm.upperWickPct > 40 && m.upperWick > wickThreshold * 0.7 && pm.upperWick > wickThreshold * 0.7) {
        const avgWickPrice = (c.high + prev.high) / 2;
        patterns.push({
          type: 'twin-wick-rejection',
          direction: 'bearish',
          strength: Math.min(90, 55 + ((m.upperWickPct + pm.upperWickPct) / 160) * 30),
          index: i, time,
          price: avgWickPrice,
          rejectionPrice: avgWickPrice,
          wickSize: (m.upperWick + pm.upperWick) / 2,
          wickPct: ((m.upperWick + pm.upperWick) / 2 / atr) * 100,
          description: `Twin upper wick rejection near ${avgWickPrice.toFixed(2)} — strong resistance`,
        });
      }
    }

    // ── Absorption Wick (large wick absorbed by next candle's body) ──
    if (i >= 1) {
      const prev = candles[i - 1];
      const pm = calcShadowMetrics(prev);
      // Previous had big lower wick, current candle's body covers it
      if (pm.lowerWick > wickThreshold && m.isBullish && c.close > prev.low + pm.lowerWick * 0.8) {
        patterns.push({
          type: 'absorption-wick',
          direction: 'bullish',
          strength: Math.min(80, 40 + (pm.lowerWick / atr) * 25),
          index: i, time,
          price: prev.low,
          rejectionPrice: prev.low,
          wickSize: pm.lowerWick,
          wickPct: (pm.lowerWick / atr) * 100,
          description: `Bullish absorption — current body absorbed previous lower wick`,
        });
      }
      // Previous had big upper wick, current candle's body covers it
      if (pm.upperWick > wickThreshold && !m.isBullish && c.close < prev.high - pm.upperWick * 0.8) {
        patterns.push({
          type: 'absorption-wick',
          direction: 'bearish',
          strength: Math.min(80, 40 + (pm.upperWick / atr) * 25),
          index: i, time,
          price: prev.high,
          rejectionPrice: prev.high,
          wickSize: pm.upperWick,
          wickPct: (pm.upperWick / atr) * 100,
          description: `Bearish absorption — current body absorbed previous upper wick`,
        });
      }
    }
  }

  // Sort patterns by recency (newest first) then strength
  patterns.sort((a, b) => b.index - a.index || b.strength - a.strength);
  return patterns;
}

// ─── Shadow Cluster Zone Detection ───────────────────────────────────────────
// Find price levels where many wicks accumulate → hidden S/R

function detectShadowClusterZones(
  candles: CandlestickData[],
  lookback: number,
  atr: number,
): ShadowClusterZone[] {
  const startIdx = Math.max(0, candles.length - lookback);
  const recentCandles = candles.slice(startIdx);
  if (recentCandles.length < 10) return [];

  const binSize = atr * 0.3; // cluster width = 30% of ATR
  if (binSize <= 0) return [];

  // Collect all significant wick tips
  type WickPoint = { price: number; side: 'upper' | 'lower'; force: number; time: number; idx: number };
  const wickPoints: WickPoint[] = [];
  const wickThreshold = atr * 0.25;

  for (let i = 0; i < recentCandles.length; i++) {
    const c = recentCandles[i];
    const uw = calcUpperWick(c);
    const lw = calcLowerWick(c);

    if (uw > wickThreshold) {
      wickPoints.push({
        price: c.high,
        side: 'upper',
        force: uw,
        time: c.time as number,
        idx: startIdx + i,
      });
    }
    if (lw > wickThreshold) {
      wickPoints.push({
        price: c.low,
        side: 'lower',
        force: lw,
        time: c.time as number,
        idx: startIdx + i,
      });
    }
  }

  if (wickPoints.length < 2) return [];

  // Build price bins and count wick accumulation
  const priceMin = Math.min(...wickPoints.map(w => w.price));
  const priceMax = Math.max(...wickPoints.map(w => w.price));
  const numBins = Math.ceil((priceMax - priceMin) / binSize) + 1;

  type Bin = { low: number; high: number; mid: number; wicks: WickPoint[] };
  const bins: Bin[] = [];
  for (let b = 0; b < numBins; b++) {
    const low = priceMin + b * binSize;
    bins.push({ low, high: low + binSize, mid: low + binSize / 2, wicks: [] });
  }

  // Assign wick points to bins
  for (const wp of wickPoints) {
    const binIdx = Math.min(numBins - 1, Math.floor((wp.price - priceMin) / binSize));
    if (binIdx >= 0 && binIdx < bins.length) {
      bins[binIdx].wicks.push(wp);
    }
  }

  // Filter bins with at least 3 wick touches → cluster zone
  const zones: ShadowClusterZone[] = [];
  const minTouches = 3;
  const currentPrice = candles[candles.length - 1].close;
  const totalCandles = recentCandles.length;

  for (const bin of bins) {
    if (bin.wicks.length < minTouches) continue;

    const upperWicks = bin.wicks.filter(w => w.side === 'upper');
    const lowerWicks = bin.wicks.filter(w => w.side === 'lower');

    // Zone type: mostly upper wicks = resistance, mostly lower = support
    const type: 'support' | 'resistance' =
      lowerWicks.length > upperWicks.length ? 'support' : 'resistance';

    const avgForce = bin.wicks.reduce((s, w) => s + w.force, 0) / bin.wicks.length;
    const lastTouch = Math.max(...bin.wicks.map(w => w.time));
    const mostRecentIdx = Math.max(...bin.wicks.map(w => w.idx));
    const freshness = Math.min(100, ((mostRecentIdx - startIdx) / totalCandles) * 100);

    // Strength: more wicks + bigger wicks + more recent = stronger
    const countScore = Math.min(40, bin.wicks.length * 10);
    const forceScore = Math.min(30, (avgForce / atr) * 30);
    const freshnessScore = freshness * 0.3;
    const strength = Math.min(100, countScore + forceScore + freshnessScore);

    zones.push({
      priceHigh: bin.high,
      priceLow: bin.low,
      midPrice: bin.mid,
      wickCount: bin.wicks.length,
      type,
      strength,
      avgRejectionForce: avgForce,
      lastTouch,
      freshness,
    });
  }

  // Sort by distance to current price (nearest first)
  zones.sort((a, b) => Math.abs(a.midPrice - currentPrice) - Math.abs(b.midPrice - currentPrice));
  return zones.slice(0, 12); // max 12 zones
}

// ─── Stop Hunt Detection ─────────────────────────────────────────────────────
// Detects wicks that pierce key levels and snap back (institutional manipulation)

function detectStopHunts(
  candles: CandlestickData[],
  lookback: number,
  atr: number,
): StopHuntEvent[] {
  const events: StopHuntEvent[] = [];
  const startIdx = Math.max(10, candles.length - lookback);

  for (let i = startIdx; i < candles.length; i++) {
    const c = candles[i];
    const m = calcShadowMetrics(c);
    const time = c.time as number;

    // Need significant wicks for stop hunt
    if (m.lowerWick < atr * 0.5 && m.upperWick < atr * 0.5) continue;

    // Look at recent swing lows/highs as "levels" to hunt
    const lookbackSwing = 20;
    const swingStart = Math.max(0, i - lookbackSwing);
    const prevCandles = candles.slice(swingStart, i);

    // ── Long Stop Hunt ──
    // Wick below recent swing lows, but close above
    if (m.lowerWick > atr * 0.5) {
      const recentLows = prevCandles.map(pc => pc.low);
      const recentSwingLow = Math.min(...recentLows);
      const secondLowest = recentLows.filter(l => l > recentSwingLow).sort()[0] ?? recentSwingLow;

      // Price wicked below the level but closed above it
      if (c.low < recentSwingLow && c.close > secondLowest) {
        const strength = Math.min(100, 40 + (m.lowerWick / atr) * 30 + (m.isBullish ? 20 : 0));
        events.push({
          index: i, time,
          type: 'long',
          wickLow: c.low,
          wickHigh: c.high,
          recoveryPrice: c.close,
          levelHunted: recentSwingLow,
          strength,
          recovered: c.close > recentSwingLow,
          description: `Long stop hunt — wicked ${(recentSwingLow - c.low).toFixed(2)} below ${recentSwingLow.toFixed(2)}, recovered to ${c.close.toFixed(2)}`,
        });
      }
    }

    // ── Short Stop Hunt ──
    if (m.upperWick > atr * 0.5) {
      const recentHighs = prevCandles.map(pc => pc.high);
      const recentSwingHigh = Math.max(...recentHighs);
      const secondHighest = recentHighs.filter(h => h < recentSwingHigh).sort().reverse()[0] ?? recentSwingHigh;

      if (c.high > recentSwingHigh && c.close < secondHighest) {
        const strength = Math.min(100, 40 + (m.upperWick / atr) * 30 + (!m.isBullish ? 20 : 0));
        events.push({
          index: i, time,
          type: 'short',
          wickLow: c.low,
          wickHigh: c.high,
          recoveryPrice: c.close,
          levelHunted: recentSwingHigh,
          strength,
          recovered: c.close < recentSwingHigh,
          description: `Short stop hunt — wicked ${(c.high - recentSwingHigh).toFixed(2)} above ${recentSwingHigh.toFixed(2)}, recovered to ${c.close.toFixed(2)}`,
        });
      }
    }
  }

  // Keep only recent events, sorted by recency
  events.sort((a, b) => b.index - a.index);
  return events.slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MASTER SHADOW ANALYSIS FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

export function analyzeShadows(
  candles: CandlestickData[],
  options: {
    lookback?: number;           // how many candles to analyze
    clusterLookback?: number;    // lookback for cluster zone detection
  } = {},
): ShadowAnalysisResult {
  const lookback = options.lookback ?? 50;
  const clusterLookback = options.clusterLookback ?? 100;

  const defaultResult: ShadowAnalysisResult = {
    recentMetrics: [],
    patterns: [],
    clusterZones: [],
    stopHunts: [],
    avgUpperWickPct: 0,
    avgLowerWickPct: 0,
    avgShadowRatio: 0,
    wickDominance: 'balanced',
    score: 0,
    bias: 'neutral',
    summary: 'Insufficient data for shadow analysis',
  };

  if (candles.length < 15) return defaultResult;

  const atr = calcATR(candles, 14);

  // ── Recent candle metrics ──
  const metricsStart = Math.max(0, candles.length - lookback);
  const recentMetrics = candles.slice(metricsStart).map((c, idx) => ({
    ...calcShadowMetrics(c),
    index: metricsStart + idx,
    time: c.time as number,
  }));

  // ── Aggregate stats ──
  const avgUpperWickPct = recentMetrics.reduce((s, m) => s + m.upperWickPct, 0) / recentMetrics.length;
  const avgLowerWickPct = recentMetrics.reduce((s, m) => s + m.lowerWickPct, 0) / recentMetrics.length;
  const avgShadowRatio = recentMetrics.reduce((s, m) => s + m.shadowRatio, 0) / recentMetrics.length;
  const wickDominance: 'upper' | 'lower' | 'balanced' =
    avgUpperWickPct > avgLowerWickPct * 1.3 ? 'upper'
    : avgLowerWickPct > avgUpperWickPct * 1.3 ? 'lower'
    : 'balanced';

  // ── Detect patterns ──
  const patterns = detectShadowPatterns(candles, lookback, atr);

  // ── Detect cluster zones ──
  const clusterZones = detectShadowClusterZones(candles, clusterLookback, atr);

  // ── Detect stop hunts ──
  const stopHunts = detectStopHunts(candles, lookback, atr);

  // ── Compute bias score ──
  let score = 0;

  // Recent patterns bias
  const recentPatterns = patterns.slice(0, 10); // top 10 most recent
  for (const p of recentPatterns) {
    const weight = p.direction === 'bullish' ? 1 : p.direction === 'bearish' ? -1 : 0;
    score += weight * (p.strength / 100) * 10;
  }

  // Wick dominance bias (lots of lower wicks = bullish rejection)
  if (wickDominance === 'lower') score += 10;
  else if (wickDominance === 'upper') score -= 10;

  // Recent stop hunts (recovered stop hunts are reversal signals)
  for (const sh of stopHunts.slice(0, 3)) {
    if (sh.recovered) {
      score += sh.type === 'long' ? 15 : -15;
    }
  }

  // Last 5 candles emphasis (more recent = more weight)
  const last5 = recentMetrics.slice(-5);
  for (const m of last5) {
    if (m.lowerWickPct > 50 && m.lowerWick > atr * 0.3) score += 3;
    if (m.upperWickPct > 50 && m.upperWick > atr * 0.3) score -= 3;
  }

  score = Math.max(-100, Math.min(100, score));
  const bias: 'bullish' | 'bearish' | 'neutral' =
    score > 15 ? 'bullish' : score < -15 ? 'bearish' : 'neutral';

  // ── Summary ──
  const bullishPatterns = patterns.filter(p => p.direction === 'bullish').length;
  const bearishPatterns = patterns.filter(p => p.direction === 'bearish').length;
  const recentStopHunt = stopHunts.length > 0 ? stopHunts[0] : null;

  let summary = '';
  if (recentStopHunt && recentStopHunt.recovered) {
    summary = `${recentStopHunt.type === 'long' ? '🟢' : '🔴'} Stop hunt detected at ${recentStopHunt.levelHunted.toFixed(1)} — ${recentStopHunt.type === 'long' ? 'bullish' : 'bearish'} reversal likely`;
  } else if (bullishPatterns > bearishPatterns * 1.5) {
    summary = `🟢 Bullish shadow bias — ${bullishPatterns} bullish vs ${bearishPatterns} bearish wick patterns`;
  } else if (bearishPatterns > bullishPatterns * 1.5) {
    summary = `🔴 Bearish shadow bias — ${bearishPatterns} bearish vs ${bullishPatterns} bullish wick patterns`;
  } else if (patterns.length > 0) {
    const latest = patterns[0];
    summary = `${latest.direction === 'bullish' ? '🟢' : latest.direction === 'bearish' ? '🔴' : '⚪'} Latest: ${latest.type} at ${latest.price.toFixed(1)} (${latest.strength.toFixed(0)}%)`;
  } else {
    summary = '⚪ No significant shadow patterns detected';
  }

  return {
    recentMetrics,
    patterns,
    clusterZones,
    stopHunts,
    avgUpperWickPct,
    avgLowerWickPct,
    avgShadowRatio,
    wickDominance,
    score,
    bias,
    summary,
  };
}

