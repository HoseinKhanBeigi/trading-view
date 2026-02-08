import type { CandlestickData } from "lightweight-charts";

// ─── Types ──────────────────────────────────────────────────────────────────

export type CandlestickPattern = {
  name: string;
  type: 'bullish' | 'bearish' | 'neutral';
  strength: 'weak' | 'medium' | 'strong';
  index: number; // Index of the last candle in the pattern
  time: number;
  price: number;
  description: string;
  candles: number; // How many candles make up this pattern
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function bodySize(c: CandlestickData): number {
  return Math.abs(c.close - c.open);
}

function totalRange(c: CandlestickData): number {
  return c.high - c.low;
}

function upperWick(c: CandlestickData): number {
  return c.high - Math.max(c.open, c.close);
}

function lowerWick(c: CandlestickData): number {
  return Math.min(c.open, c.close) - c.low;
}

function isBullish(c: CandlestickData): boolean {
  return c.close > c.open;
}

function isBearish(c: CandlestickData): boolean {
  return c.close < c.open;
}

function isDoji(c: CandlestickData, threshold: number = 0.1): boolean {
  const body = bodySize(c);
  const range = totalRange(c);
  return range > 0 && body / range < threshold;
}

function avgBodySize(candles: CandlestickData[]): number {
  if (candles.length === 0) return 0;
  return candles.reduce((s, c) => s + bodySize(c), 0) / candles.length;
}

// ─── Single Candle Patterns ─────────────────────────────────────────────────

function detectHammer(candles: CandlestickData[], i: number, avg: number): CandlestickPattern | null {
  const c = candles[i];
  const body = bodySize(c);
  const lw = lowerWick(c);
  const uw = upperWick(c);
  const range = totalRange(c);

  // Hammer: small body at top, long lower wick (2x+ body), small upper wick
  if (body > 0 && lw >= body * 2 && uw < body * 0.5 && range > avg * 0.5) {
    // Must appear after downtrend (check previous 5 candles)
    const prev = candles.slice(Math.max(0, i - 5), i);
    const isAfterDown = prev.length >= 3 && prev[prev.length - 1].close < prev[0].close;
    if (isAfterDown) {
      return {
        name: 'Hammer',
        type: 'bullish',
        strength: lw > body * 3 ? 'strong' : 'medium',
        index: i,
        time: c.time as number,
        price: c.close,
        description: 'Hammer: bullish reversal signal after downtrend',
        candles: 1,
      };
    }
  }
  return null;
}

function detectInvertedHammer(candles: CandlestickData[], i: number, avg: number): CandlestickPattern | null {
  const c = candles[i];
  const body = bodySize(c);
  const lw = lowerWick(c);
  const uw = upperWick(c);
  const range = totalRange(c);

  if (body > 0 && uw >= body * 2 && lw < body * 0.5 && range > avg * 0.5) {
    const prev = candles.slice(Math.max(0, i - 5), i);
    const isAfterDown = prev.length >= 3 && prev[prev.length - 1].close < prev[0].close;
    if (isAfterDown) {
      return {
        name: 'Inverted Hammer',
        type: 'bullish',
        strength: uw > body * 3 ? 'strong' : 'medium',
        index: i,
        time: c.time as number,
        price: c.close,
        description: 'Inverted Hammer: potential bullish reversal after downtrend',
        candles: 1,
      };
    }
  }
  return null;
}

function detectShootingStar(candles: CandlestickData[], i: number, avg: number): CandlestickPattern | null {
  const c = candles[i];
  const body = bodySize(c);
  const lw = lowerWick(c);
  const uw = upperWick(c);
  const range = totalRange(c);

  if (body > 0 && uw >= body * 2 && lw < body * 0.5 && range > avg * 0.5) {
    const prev = candles.slice(Math.max(0, i - 5), i);
    const isAfterUp = prev.length >= 3 && prev[prev.length - 1].close > prev[0].close;
    if (isAfterUp) {
      return {
        name: 'Shooting Star',
        type: 'bearish',
        strength: uw > body * 3 ? 'strong' : 'medium',
        index: i,
        time: c.time as number,
        price: c.close,
        description: 'Shooting Star: bearish reversal signal after uptrend',
        candles: 1,
      };
    }
  }
  return null;
}

function detectHangingMan(candles: CandlestickData[], i: number, avg: number): CandlestickPattern | null {
  const c = candles[i];
  const body = bodySize(c);
  const lw = lowerWick(c);
  const uw = upperWick(c);
  const range = totalRange(c);

  if (body > 0 && lw >= body * 2 && uw < body * 0.5 && range > avg * 0.5) {
    const prev = candles.slice(Math.max(0, i - 5), i);
    const isAfterUp = prev.length >= 3 && prev[prev.length - 1].close > prev[0].close;
    if (isAfterUp) {
      return {
        name: 'Hanging Man',
        type: 'bearish',
        strength: 'medium',
        index: i,
        time: c.time as number,
        price: c.close,
        description: 'Hanging Man: bearish reversal signal after uptrend',
        candles: 1,
      };
    }
  }
  return null;
}

function detectDoji(candles: CandlestickData[], i: number, avg: number): CandlestickPattern | null {
  const c = candles[i];
  if (isDoji(c) && totalRange(c) > avg * 0.3) {
    const uw = upperWick(c);
    const lw = lowerWick(c);
    const range = totalRange(c);
    
    let name = 'Doji';
    if (lw > range * 0.6) name = 'Dragonfly Doji';
    else if (uw > range * 0.6) name = 'Gravestone Doji';
    else if (uw > range * 0.3 && lw > range * 0.3) name = 'Long-Legged Doji';

    return {
      name,
      type: 'neutral',
      strength: 'medium',
      index: i,
      time: c.time as number,
      price: c.close,
      description: `${name}: indecision, potential reversal`,
      candles: 1,
    };
  }
  return null;
}

function detectMarubozu(candles: CandlestickData[], i: number, avg: number): CandlestickPattern | null {
  const c = candles[i];
  const body = bodySize(c);
  const range = totalRange(c);
  const uw = upperWick(c);
  const lw = lowerWick(c);

  // Marubozu: body is nearly the entire range (minimal wicks) and large candle
  if (body > avg * 1.5 && range > 0 && (uw + lw) / range < 0.15) {
    return {
      name: isBullish(c) ? 'Bullish Marubozu' : 'Bearish Marubozu',
      type: isBullish(c) ? 'bullish' : 'bearish',
      strength: 'strong',
      index: i,
      time: c.time as number,
      price: c.close,
      description: `${isBullish(c) ? 'Bullish' : 'Bearish'} Marubozu: strong momentum, no wicks`,
      candles: 1,
    };
  }
  return null;
}

// ─── Two-Candle Patterns ────────────────────────────────────────────────────

function detectEngulfing(candles: CandlestickData[], i: number, avg: number): CandlestickPattern | null {
  if (i < 1) return null;
  const prev = candles[i - 1];
  const curr = candles[i];
  const prevBody = bodySize(prev);
  const currBody = bodySize(curr);

  // Bullish engulfing: bearish candle followed by larger bullish candle that engulfs it
  if (isBearish(prev) && isBullish(curr) &&
      curr.open <= prev.close && curr.close >= prev.open &&
      currBody > prevBody * 1.1) {
    const prevCandles = candles.slice(Math.max(0, i - 6), i);
    const isAfterDown = prevCandles.length >= 3 && prevCandles[prevCandles.length - 1].close < prevCandles[0].close;
    if (isAfterDown) {
      return {
        name: 'Bullish Engulfing',
        type: 'bullish',
        strength: currBody > avg * 1.5 ? 'strong' : 'medium',
        index: i,
        time: curr.time as number,
        price: curr.close,
        description: 'Bullish Engulfing: strong reversal pattern',
        candles: 2,
      };
    }
  }

  // Bearish engulfing: bullish candle followed by larger bearish candle that engulfs it
  if (isBullish(prev) && isBearish(curr) &&
      curr.open >= prev.close && curr.close <= prev.open &&
      currBody > prevBody * 1.1) {
    const prevCandles = candles.slice(Math.max(0, i - 6), i);
    const isAfterUp = prevCandles.length >= 3 && prevCandles[prevCandles.length - 1].close > prevCandles[0].close;
    if (isAfterUp) {
      return {
        name: 'Bearish Engulfing',
        type: 'bearish',
        strength: currBody > avg * 1.5 ? 'strong' : 'medium',
        index: i,
        time: curr.time as number,
        price: curr.close,
        description: 'Bearish Engulfing: strong reversal pattern',
        candles: 2,
      };
    }
  }
  return null;
}

function detectTweezer(candles: CandlestickData[], i: number, avg: number): CandlestickPattern | null {
  if (i < 1) return null;
  const prev = candles[i - 1];
  const curr = candles[i];
  const tolerance = avg * 0.1;

  // Tweezer Bottom: two candles with approximately equal lows, first bearish second bullish
  if (isBearish(prev) && isBullish(curr) && Math.abs(prev.low - curr.low) < tolerance) {
    return {
      name: 'Tweezer Bottom',
      type: 'bullish',
      strength: 'medium',
      index: i,
      time: curr.time as number,
      price: curr.close,
      description: 'Tweezer Bottom: equal lows — bullish reversal',
      candles: 2,
    };
  }

  // Tweezer Top: two candles with approximately equal highs, first bullish second bearish
  if (isBullish(prev) && isBearish(curr) && Math.abs(prev.high - curr.high) < tolerance) {
    return {
      name: 'Tweezer Top',
      type: 'bearish',
      strength: 'medium',
      index: i,
      time: curr.time as number,
      price: curr.close,
      description: 'Tweezer Top: equal highs — bearish reversal',
      candles: 2,
    };
  }
  return null;
}

function detectPiercing(candles: CandlestickData[], i: number): CandlestickPattern | null {
  if (i < 1) return null;
  const prev = candles[i - 1];
  const curr = candles[i];
  const prevMid = (prev.open + prev.close) / 2;

  // Piercing Line: bearish candle followed by bullish candle opening below prior close, closing above midpoint
  if (isBearish(prev) && isBullish(curr) &&
      curr.open < prev.close && curr.close > prevMid && curr.close < prev.open) {
    return {
      name: 'Piercing Line',
      type: 'bullish',
      strength: 'medium',
      index: i,
      time: curr.time as number,
      price: curr.close,
      description: 'Piercing Line: bullish reversal, closes above prior midpoint',
      candles: 2,
    };
  }

  // Dark Cloud Cover: bullish candle followed by bearish candle opening above prior close, closing below midpoint
  if (isBullish(prev) && isBearish(curr) &&
      curr.open > prev.close && curr.close < prevMid && curr.close > prev.open) {
    return {
      name: 'Dark Cloud Cover',
      type: 'bearish',
      strength: 'medium',
      index: i,
      time: curr.time as number,
      price: curr.close,
      description: 'Dark Cloud Cover: bearish reversal, closes below prior midpoint',
      candles: 2,
    };
  }
  return null;
}

// ─── Three-Candle Patterns ──────────────────────────────────────────────────

function detectMorningStar(candles: CandlestickData[], i: number, avg: number): CandlestickPattern | null {
  if (i < 2) return null;
  const c1 = candles[i - 2];
  const c2 = candles[i - 1]; // Star candle
  const c3 = candles[i];

  // Morning Star: large bearish, small body (star), large bullish
  if (isBearish(c1) && isBullish(c3) &&
      bodySize(c1) > avg * 0.8 &&
      bodySize(c2) < avg * 0.5 &&
      bodySize(c3) > avg * 0.8 &&
      c3.close > (c1.open + c1.close) / 2) {
    return {
      name: 'Morning Star',
      type: 'bullish',
      strength: 'strong',
      index: i,
      time: c3.time as number,
      price: c3.close,
      description: 'Morning Star: strong bullish reversal (3-candle pattern)',
      candles: 3,
    };
  }
  return null;
}

function detectEveningStar(candles: CandlestickData[], i: number, avg: number): CandlestickPattern | null {
  if (i < 2) return null;
  const c1 = candles[i - 2];
  const c2 = candles[i - 1];
  const c3 = candles[i];

  // Evening Star: large bullish, small body (star), large bearish
  if (isBullish(c1) && isBearish(c3) &&
      bodySize(c1) > avg * 0.8 &&
      bodySize(c2) < avg * 0.5 &&
      bodySize(c3) > avg * 0.8 &&
      c3.close < (c1.open + c1.close) / 2) {
    return {
      name: 'Evening Star',
      type: 'bearish',
      strength: 'strong',
      index: i,
      time: c3.time as number,
      price: c3.close,
      description: 'Evening Star: strong bearish reversal (3-candle pattern)',
      candles: 3,
    };
  }
  return null;
}

function detectThreeSoldiers(candles: CandlestickData[], i: number, avg: number): CandlestickPattern | null {
  if (i < 2) return null;
  const c1 = candles[i - 2];
  const c2 = candles[i - 1];
  const c3 = candles[i];

  // Three White Soldiers: three consecutive bullish candles, each closing higher
  if (isBullish(c1) && isBullish(c2) && isBullish(c3) &&
      c2.close > c1.close && c3.close > c2.close &&
      c2.open > c1.open && c3.open > c2.open &&
      bodySize(c1) > avg * 0.5 && bodySize(c2) > avg * 0.5 && bodySize(c3) > avg * 0.5) {
    return {
      name: 'Three White Soldiers',
      type: 'bullish',
      strength: 'strong',
      index: i,
      time: c3.time as number,
      price: c3.close,
      description: 'Three White Soldiers: strong bullish continuation',
      candles: 3,
    };
  }

  // Three Black Crows: three consecutive bearish candles, each closing lower
  if (isBearish(c1) && isBearish(c2) && isBearish(c3) &&
      c2.close < c1.close && c3.close < c2.close &&
      c2.open < c1.open && c3.open < c2.open &&
      bodySize(c1) > avg * 0.5 && bodySize(c2) > avg * 0.5 && bodySize(c3) > avg * 0.5) {
    return {
      name: 'Three Black Crows',
      type: 'bearish',
      strength: 'strong',
      index: i,
      time: c3.time as number,
      price: c3.close,
      description: 'Three Black Crows: strong bearish continuation',
      candles: 3,
    };
  }
  return null;
}

function detectThreeInsideUpDown(candles: CandlestickData[], i: number, avg: number): CandlestickPattern | null {
  if (i < 2) return null;
  const c1 = candles[i - 2];
  const c2 = candles[i - 1];
  const c3 = candles[i];

  // Three Inside Up: large bearish, bullish harami (inside), bullish close above c1 open
  if (isBearish(c1) && isBullish(c2) && isBullish(c3) &&
      bodySize(c1) > avg &&
      c2.close < c1.open && c2.open > c1.close && // c2 inside c1
      c3.close > c1.open) {
    return {
      name: 'Three Inside Up',
      type: 'bullish',
      strength: 'strong',
      index: i,
      time: c3.time as number,
      price: c3.close,
      description: 'Three Inside Up: confirmed bullish reversal',
      candles: 3,
    };
  }

  // Three Inside Down: large bullish, bearish harami (inside), bearish close below c1 open
  if (isBullish(c1) && isBearish(c2) && isBearish(c3) &&
      bodySize(c1) > avg &&
      c2.close > c1.open && c2.open < c1.close && // c2 inside c1
      c3.close < c1.open) {
    return {
      name: 'Three Inside Down',
      type: 'bearish',
      strength: 'strong',
      index: i,
      time: c3.time as number,
      price: c3.close,
      description: 'Three Inside Down: confirmed bearish reversal',
      candles: 3,
    };
  }
  return null;
}

// ─── Pin Bar (Advanced) ─────────────────────────────────────────────────────

function detectPinBar(candles: CandlestickData[], i: number, avg: number): CandlestickPattern | null {
  const c = candles[i];
  const body = bodySize(c);
  const range = totalRange(c);
  const uw = upperWick(c);
  const lw = lowerWick(c);

  if (range < avg * 0.3) return null; // Too small

  // Bullish pin bar: very long lower wick, body at top third
  if (lw > range * 0.6 && body < range * 0.3 && uw < range * 0.2) {
    return {
      name: 'Bullish Pin Bar',
      type: 'bullish',
      strength: lw > range * 0.7 ? 'strong' : 'medium',
      index: i,
      time: c.time as number,
      price: c.close,
      description: 'Bullish Pin Bar: strong rejection of lower prices',
      candles: 1,
    };
  }

  // Bearish pin bar: very long upper wick, body at bottom third
  if (uw > range * 0.6 && body < range * 0.3 && lw < range * 0.2) {
    return {
      name: 'Bearish Pin Bar',
      type: 'bearish',
      strength: uw > range * 0.7 ? 'strong' : 'medium',
      index: i,
      time: c.time as number,
      price: c.close,
      description: 'Bearish Pin Bar: strong rejection of higher prices',
      candles: 1,
    };
  }
  return null;
}

// ─── Inside Bar ─────────────────────────────────────────────────────────────

function detectInsideBar(candles: CandlestickData[], i: number): CandlestickPattern | null {
  if (i < 1) return null;
  const prev = candles[i - 1];
  const curr = candles[i];

  // Inside bar: current candle's range is entirely within previous candle's range
  if (curr.high <= prev.high && curr.low >= prev.low) {
    return {
      name: 'Inside Bar',
      type: 'neutral',
      strength: 'medium',
      index: i,
      time: curr.time as number,
      price: curr.close,
      description: 'Inside Bar: consolidation, expect breakout',
      candles: 2,
    };
  }
  return null;
}

// ─── Outside Bar (Engulfing Range) ──────────────────────────────────────────

function detectOutsideBar(candles: CandlestickData[], i: number): CandlestickPattern | null {
  if (i < 1) return null;
  const prev = candles[i - 1];
  const curr = candles[i];

  // Outside bar: current range fully engulfs previous range
  if (curr.high > prev.high && curr.low < prev.low) {
    return {
      name: 'Outside Bar',
      type: isBullish(curr) ? 'bullish' : 'bearish',
      strength: 'medium',
      index: i,
      time: curr.time as number,
      price: curr.close,
      description: `Outside Bar: ${isBullish(curr) ? 'bullish' : 'bearish'} expansion, strong momentum`,
      candles: 2,
    };
  }
  return null;
}

// ─── Master Detection Function ──────────────────────────────────────────────

export function detectAllCandlestickPatterns(
  candles: CandlestickData[],
  lookback: number = 50 // How many recent candles to analyze
): CandlestickPattern[] {
  const patterns: CandlestickPattern[] = [];
  if (candles.length < 5) return patterns;

  const startIdx = Math.max(0, candles.length - lookback);
  const contextCandles = candles.slice(Math.max(0, startIdx - 10)); // Include some context
  const avg = avgBodySize(contextCandles);

  for (let i = Math.max(2, startIdx); i < candles.length; i++) {
    // Single candle patterns
    const hammer = detectHammer(candles, i, avg);
    if (hammer) patterns.push(hammer);

    const invHammer = detectInvertedHammer(candles, i, avg);
    if (invHammer) patterns.push(invHammer);

    const shootingStar = detectShootingStar(candles, i, avg);
    if (shootingStar) patterns.push(shootingStar);

    const hangingMan = detectHangingMan(candles, i, avg);
    if (hangingMan) patterns.push(hangingMan);

    const doji = detectDoji(candles, i, avg);
    if (doji) patterns.push(doji);

    const marubozu = detectMarubozu(candles, i, avg);
    if (marubozu) patterns.push(marubozu);

    const pinBar = detectPinBar(candles, i, avg);
    if (pinBar) patterns.push(pinBar);

    // Two candle patterns
    const engulfing = detectEngulfing(candles, i, avg);
    if (engulfing) patterns.push(engulfing);

    const tweezer = detectTweezer(candles, i, avg);
    if (tweezer) patterns.push(tweezer);

    const piercing = detectPiercing(candles, i);
    if (piercing) patterns.push(piercing);

    const insideBar = detectInsideBar(candles, i);
    if (insideBar) patterns.push(insideBar);

    const outsideBar = detectOutsideBar(candles, i);
    if (outsideBar) patterns.push(outsideBar);

    // Three candle patterns
    const morningStar = detectMorningStar(candles, i, avg);
    if (morningStar) patterns.push(morningStar);

    const eveningStar = detectEveningStar(candles, i, avg);
    if (eveningStar) patterns.push(eveningStar);

    const soldiers = detectThreeSoldiers(candles, i, avg);
    if (soldiers) patterns.push(soldiers);

    const insideUpDown = detectThreeInsideUpDown(candles, i, avg);
    if (insideUpDown) patterns.push(insideUpDown);
  }

  return patterns;
}

/**
 * Get only the most recent patterns (useful for display)
 */
export function getRecentPatterns(
  patterns: CandlestickPattern[],
  maxPatterns: number = 10
): CandlestickPattern[] {
  return patterns
    .sort((a, b) => b.index - a.index) // Most recent first
    .slice(0, maxPatterns);
}

