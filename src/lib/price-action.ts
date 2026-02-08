import type { CandlestickData } from "lightweight-charts";

// ─── Types ──────────────────────────────────────────────────────────────────

export type SwingPoint = {
  index: number;
  time: number;
  price: number;
  type: 'high' | 'low';
};

export type MarketStructurePoint = {
  index: number;
  time: number;
  price: number;
  label: 'HH' | 'HL' | 'LH' | 'LL'; // Higher High, Higher Low, Lower High, Lower Low
};

export type StructureBreak = {
  index: number;
  time: number;
  price: number;
  type: 'BOS' | 'CHoCH'; // Break of Structure / Change of Character
  direction: 'bullish' | 'bearish';
  brokenLevel: number;
  strength: 'weak' | 'medium' | 'strong';
};

export type FairValueGap = {
  startIndex: number;
  endIndex: number;
  time: number;
  high: number; // Top of the gap
  low: number; // Bottom of the gap
  type: 'bullish' | 'bearish'; // Bullish FVG = gap up, Bearish FVG = gap down
  filled: boolean; // Whether price has returned to fill the gap
  fillPercentage: number; // 0-100, how much of the gap has been filled
  size: number; // Size of the gap in price
  midpoint: number;
};

export type LiquiditySweep = {
  index: number;
  time: number;
  price: number;
  sweptLevel: number;
  type: 'buy-side' | 'sell-side'; // Buy-side = swept highs, Sell-side = swept lows
  strength: 'weak' | 'medium' | 'strong';
  recovered: boolean; // Did price recover after the sweep?
};

export type EqualLevel = {
  prices: number[];
  avgPrice: number;
  count: number;
  type: 'equal-highs' | 'equal-lows';
  indices: number[];
  times: number[];
  liquidityPool: boolean; // True if this is a significant liquidity pool
};

export type Displacement = {
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  direction: 'bullish' | 'bearish';
  size: number; // Price movement
  sizePct: number; // Percentage movement
  candles: number; // Number of candles in the displacement
  strength: 'weak' | 'medium' | 'strong';
};

export type FibonacciLevel = {
  level: number; // 0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0
  price: number;
  label: string;
};

export type PriceActionSignal = {
  type: 'BUY' | 'SELL' | 'NEUTRAL';
  strength: 'weak' | 'medium' | 'strong';
  pattern: string;
  reason: string;
  price: number;
  time: number;
  confidence: number; // 0-100
};

export type PriceActionAnalysis = {
  swingPoints: SwingPoint[];
  marketStructure: MarketStructurePoint[];
  structureBreaks: StructureBreak[];
  fairValueGaps: FairValueGap[];
  liquiditySweeps: LiquiditySweep[];
  equalLevels: EqualLevel[];
  displacements: Displacement[];
  fibLevels: FibonacciLevel[];
  signals: PriceActionSignal[];
  trend: 'bullish' | 'bearish' | 'ranging';
  trendStrength: number; // 0-100
  marketPhase: 'accumulation' | 'markup' | 'distribution' | 'markdown' | 'unknown';
};

// ─── Swing Point Detection (Fractal-Based) ─────────────────────────────────

export function detectSwingPoints(
  candles: CandlestickData[],
  leftBars: number = 3,
  rightBars: number = 3
): SwingPoint[] {
  const swings: SwingPoint[] = [];
  if (candles.length < leftBars + rightBars + 1) return swings;

  for (let i = leftBars; i < candles.length - rightBars; i++) {
    const candle = candles[i];

    // Check for swing high
    let isSwingHigh = true;
    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j === i) continue;
      if (candles[j].high >= candle.high) {
        isSwingHigh = false;
        break;
      }
    }
    if (isSwingHigh) {
      swings.push({
        index: i,
        time: candle.time as number,
        price: candle.high,
        type: 'high',
      });
    }

    // Check for swing low
    let isSwingLow = true;
    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j === i) continue;
      if (candles[j].low <= candle.low) {
        isSwingLow = false;
        break;
      }
    }
    if (isSwingLow) {
      swings.push({
        index: i,
        time: candle.time as number,
        price: candle.low,
        type: 'low',
      });
    }
  }

  return swings.sort((a, b) => a.index - b.index);
}

// ─── Market Structure (HH, HL, LH, LL) ─────────────────────────────────────

export function analyzeMarketStructure(swingPoints: SwingPoint[]): MarketStructurePoint[] {
  const structure: MarketStructurePoint[] = [];
  if (swingPoints.length < 2) return structure;

  const highs = swingPoints.filter(s => s.type === 'high');
  const lows = swingPoints.filter(s => s.type === 'low');

  // Label highs
  for (let i = 1; i < highs.length; i++) {
    const prev = highs[i - 1];
    const curr = highs[i];
    structure.push({
      index: curr.index,
      time: curr.time,
      price: curr.price,
      label: curr.price > prev.price ? 'HH' : 'LH',
    });
  }

  // Label lows
  for (let i = 1; i < lows.length; i++) {
    const prev = lows[i - 1];
    const curr = lows[i];
    structure.push({
      index: curr.index,
      time: curr.time,
      price: curr.price,
      label: curr.price > prev.price ? 'HL' : 'LL',
    });
  }

  return structure.sort((a, b) => a.index - b.index);
}

// ─── Break of Structure (BOS) & Change of Character (CHoCH) ────────────────

export function detectStructureBreaks(
  candles: CandlestickData[],
  swingPoints: SwingPoint[],
  marketStructure: MarketStructurePoint[]
): StructureBreak[] {
  const breaks: StructureBreak[] = [];
  if (swingPoints.length < 4) return breaks;

  const highs = swingPoints.filter(s => s.type === 'high').sort((a, b) => a.index - b.index);
  const lows = swingPoints.filter(s => s.type === 'low').sort((a, b) => a.index - b.index);

  // Determine the prevailing trend from structure
  const recentStructure = marketStructure.slice(-6);
  const hhCount = recentStructure.filter(s => s.label === 'HH' || s.label === 'HL').length;
  const llCount = recentStructure.filter(s => s.label === 'LL' || s.label === 'LH').length;
  const prevailingTrend: 'bullish' | 'bearish' | 'neutral' =
    hhCount > llCount ? 'bullish' : llCount > hhCount ? 'bearish' : 'neutral';

  // Check for bullish BOS: price breaks above a previous swing high
  for (let i = 1; i < highs.length; i++) {
    const prevHigh = highs[i - 1];
    // Look for candles after the previous high that close above it
    for (let j = prevHigh.index + 1; j < candles.length && j < prevHigh.index + 20; j++) {
      if (candles[j].close > prevHigh.price) {
        const isCHoCH = prevailingTrend === 'bearish'; // CHoCH if breaking against prevailing trend
        const bodySize = Math.abs(candles[j].close - candles[j].open);
        const avgBody = candles.slice(Math.max(0, j - 10), j)
          .reduce((s, c) => s + Math.abs(c.close - c.open), 0) / 10;
        const strength: 'weak' | 'medium' | 'strong' =
          bodySize > avgBody * 2 ? 'strong' : bodySize > avgBody * 1.3 ? 'medium' : 'weak';

        breaks.push({
          index: j,
          time: candles[j].time as number,
          price: candles[j].close,
          type: isCHoCH ? 'CHoCH' : 'BOS',
          direction: 'bullish',
          brokenLevel: prevHigh.price,
          strength,
        });
        break; // Only first break per swing
      }
    }
  }

  // Check for bearish BOS: price breaks below a previous swing low
  for (let i = 1; i < lows.length; i++) {
    const prevLow = lows[i - 1];
    for (let j = prevLow.index + 1; j < candles.length && j < prevLow.index + 20; j++) {
      if (candles[j].close < prevLow.price) {
        const isCHoCH = prevailingTrend === 'bullish';
        const bodySize = Math.abs(candles[j].close - candles[j].open);
        const avgBody = candles.slice(Math.max(0, j - 10), j)
          .reduce((s, c) => s + Math.abs(c.close - c.open), 0) / 10;
        const strength: 'weak' | 'medium' | 'strong' =
          bodySize > avgBody * 2 ? 'strong' : bodySize > avgBody * 1.3 ? 'medium' : 'weak';

        breaks.push({
          index: j,
          time: candles[j].time as number,
          price: candles[j].close,
          type: isCHoCH ? 'CHoCH' : 'BOS',
          direction: 'bearish',
          brokenLevel: prevLow.price,
          strength,
        });
        break;
      }
    }
  }

  // Remove duplicates (same index)
  const seen = new Set<number>();
  return breaks
    .filter(b => {
      if (seen.has(b.index)) return false;
      seen.add(b.index);
      return true;
    })
    .sort((a, b) => a.index - b.index);
}

// ─── Fair Value Gap (FVG) Detection ─────────────────────────────────────────

export function detectFairValueGaps(
  candles: CandlestickData[],
  minGapPct: number = 0.05 // Minimum gap size as % of price
): FairValueGap[] {
  const gaps: FairValueGap[] = [];
  if (candles.length < 3) return gaps;

  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2]; // First candle
    const c2 = candles[i - 1]; // Middle candle (the gap candle)
    const c3 = candles[i];     // Third candle

    // Bullish FVG: Gap up — candle 3's low is above candle 1's high
    if (c3.low > c1.high) {
      const gapSize = c3.low - c1.high;
      const gapPct = (gapSize / c2.close) * 100;
      if (gapPct >= minGapPct) {
        // Check if gap has been filled by subsequent candles
        let filled = false;
        let lowestRetrace = c3.low;
        for (let j = i + 1; j < candles.length; j++) {
          if (candles[j].low <= c1.high) {
            filled = true;
            lowestRetrace = c1.high;
            break;
          }
          lowestRetrace = Math.min(lowestRetrace, candles[j].low);
        }
        const fillPercentage = filled ? 100 : Math.min(100, ((c3.low - lowestRetrace) / gapSize) * 100);

        gaps.push({
          startIndex: i - 2,
          endIndex: i,
          time: c2.time as number,
          high: c3.low,
          low: c1.high,
          type: 'bullish',
          filled,
          fillPercentage,
          size: gapSize,
          midpoint: (c3.low + c1.high) / 2,
        });
      }
    }

    // Bearish FVG: Gap down — candle 3's high is below candle 1's low
    if (c3.high < c1.low) {
      const gapSize = c1.low - c3.high;
      const gapPct = (gapSize / c2.close) * 100;
      if (gapPct >= minGapPct) {
        let filled = false;
        let highestRetrace = c3.high;
        for (let j = i + 1; j < candles.length; j++) {
          if (candles[j].high >= c1.low) {
            filled = true;
            highestRetrace = c1.low;
            break;
          }
          highestRetrace = Math.max(highestRetrace, candles[j].high);
        }
        const fillPercentage = filled ? 100 : Math.min(100, ((highestRetrace - c3.high) / gapSize) * 100);

        gaps.push({
          startIndex: i - 2,
          endIndex: i,
          time: c2.time as number,
          high: c1.low,
          low: c3.high,
          type: 'bearish',
          filled,
          fillPercentage,
          size: gapSize,
          midpoint: (c1.low + c3.high) / 2,
        });
      }
    }
  }

  return gaps;
}

// ─── Liquidity Sweep Detection ──────────────────────────────────────────────

export function detectLiquiditySweeps(
  candles: CandlestickData[],
  swingPoints: SwingPoint[],
  wickThresholdPct: number = 0.1 // Minimum wick size as % of price to qualify
): LiquiditySweep[] {
  const sweeps: LiquiditySweep[] = [];
  if (candles.length < 10 || swingPoints.length < 2) return sweeps;

  // Buy-side sweep: price wicks ABOVE a previous swing high, then closes below it
  const swingHighs = swingPoints.filter(s => s.type === 'high');
  for (const sh of swingHighs) {
    for (let j = sh.index + 2; j < candles.length; j++) {
      const c = candles[j];
      if (c.high > sh.price && c.close < sh.price) {
        const wickSize = c.high - Math.max(c.open, c.close);
        const wickPct = (wickSize / c.close) * 100;
        if (wickPct >= wickThresholdPct) {
          // Check recovery: did price stay below after sweep?
          const recovered = j + 1 < candles.length && candles[j + 1].close > c.close;
          const bodySize = Math.abs(c.close - c.open);
          const strength: 'weak' | 'medium' | 'strong' =
            wickSize > bodySize * 2 ? 'strong' : wickSize > bodySize ? 'medium' : 'weak';

          sweeps.push({
            index: j,
            time: c.time as number,
            price: c.high,
            sweptLevel: sh.price,
            type: 'buy-side',
            strength,
            recovered,
          });
          break; // One sweep per swing high
        }
      }
    }
  }

  // Sell-side sweep: price wicks BELOW a previous swing low, then closes above it
  const swingLows = swingPoints.filter(s => s.type === 'low');
  for (const sl of swingLows) {
    for (let j = sl.index + 2; j < candles.length; j++) {
      const c = candles[j];
      if (c.low < sl.price && c.close > sl.price) {
        const wickSize = Math.min(c.open, c.close) - c.low;
        const wickPct = (wickSize / c.close) * 100;
        if (wickPct >= wickThresholdPct) {
          const recovered = j + 1 < candles.length && candles[j + 1].close < c.close;
          const bodySize = Math.abs(c.close - c.open);
          const strength: 'weak' | 'medium' | 'strong' =
            wickSize > bodySize * 2 ? 'strong' : wickSize > bodySize ? 'medium' : 'weak';

          sweeps.push({
            index: j,
            time: c.time as number,
            price: c.low,
            sweptLevel: sl.price,
            type: 'sell-side',
            strength,
            recovered,
          });
          break;
        }
      }
    }
  }

  return sweeps.sort((a, b) => a.index - b.index);
}

// ─── Equal Highs/Lows Detection (Liquidity Pools) ──────────────────────────

export function detectEqualLevels(
  candles: CandlestickData[],
  swingPoints: SwingPoint[],
  tolerancePct: number = 0.15 // How close prices need to be (% of price)
): EqualLevel[] {
  const levels: EqualLevel[] = [];

  const highs = swingPoints.filter(s => s.type === 'high');
  const lows = swingPoints.filter(s => s.type === 'low');

  // Find equal highs
  const highGroups = groupNearbyPrices(highs, tolerancePct);
  for (const group of highGroups) {
    if (group.length >= 2) {
      const avgPrice = group.reduce((s, p) => s + p.price, 0) / group.length;
      levels.push({
        prices: group.map(p => p.price),
        avgPrice,
        count: group.length,
        type: 'equal-highs',
        indices: group.map(p => p.index),
        times: group.map(p => p.time),
        liquidityPool: group.length >= 3, // 3+ touches = significant pool
      });
    }
  }

  // Find equal lows
  const lowGroups = groupNearbyPrices(lows, tolerancePct);
  for (const group of lowGroups) {
    if (group.length >= 2) {
      const avgPrice = group.reduce((s, p) => s + p.price, 0) / group.length;
      levels.push({
        prices: group.map(p => p.price),
        avgPrice,
        count: group.length,
        type: 'equal-lows',
        indices: group.map(p => p.index),
        times: group.map(p => p.time),
        liquidityPool: group.length >= 3,
      });
    }
  }

  return levels;
}

function groupNearbyPrices(points: SwingPoint[], tolerancePct: number): SwingPoint[][] {
  const groups: SwingPoint[][] = [];
  const used = new Set<number>();

  for (let i = 0; i < points.length; i++) {
    if (used.has(i)) continue;
    const group: SwingPoint[] = [points[i]];
    used.add(i);

    for (let j = i + 1; j < points.length; j++) {
      if (used.has(j)) continue;
      const diff = Math.abs(points[i].price - points[j].price) / points[i].price * 100;
      if (diff <= tolerancePct) {
        group.push(points[j]);
        used.add(j);
      }
    }
    groups.push(group);
  }
  return groups;
}

// ─── Displacement Detection (Strong Momentum Moves) ────────────────────────

export function detectDisplacements(
  candles: CandlestickData[],
  minMovePct: number = 0.5, // Minimum move size as % of price
  maxCandles: number = 3    // Maximum candles for a displacement
): Displacement[] {
  const displacements: Displacement[] = [];
  if (candles.length < maxCandles + 1) return displacements;

  for (let i = 0; i < candles.length - 1; i++) {
    for (let len = 1; len <= maxCandles && i + len < candles.length; len++) {
      const startCandle = candles[i];
      const endCandle = candles[i + len];
      const move = endCandle.close - startCandle.open;
      const movePct = Math.abs(move) / startCandle.open * 100;

      if (movePct >= minMovePct) {
        // Check that all intermediate candles are in the same direction
        let allSameDir = true;
        const dir = move > 0 ? 'bullish' : 'bearish';
        for (let j = i; j <= i + len; j++) {
          if (dir === 'bullish' && candles[j].close < candles[j].open) {
            // Allow one counter candle if it's small
            const body = Math.abs(candles[j].close - candles[j].open);
            const avgBody = candles.slice(Math.max(0, j - 5), j)
              .reduce((s, c) => s + Math.abs(c.close - c.open), 0) / 5;
            if (body > avgBody * 0.5) { allSameDir = false; break; }
          }
          if (dir === 'bearish' && candles[j].close > candles[j].open) {
            const body = Math.abs(candles[j].close - candles[j].open);
            const avgBody = candles.slice(Math.max(0, j - 5), j)
              .reduce((s, c) => s + Math.abs(c.close - c.open), 0) / 5;
            if (body > avgBody * 0.5) { allSameDir = false; break; }
          }
        }

        if (allSameDir) {
          const strength: 'weak' | 'medium' | 'strong' =
            movePct > 2 ? 'strong' : movePct > 1 ? 'medium' : 'weak';

          displacements.push({
            startIndex: i,
            endIndex: i + len,
            startTime: startCandle.time as number,
            endTime: endCandle.time as number,
            direction: dir,
            size: Math.abs(move),
            sizePct: movePct,
            candles: len + 1,
            strength,
          });
        }
      }
    }
  }

  // Remove overlapping displacements (keep strongest)
  const filtered: Displacement[] = [];
  const usedIndices = new Set<number>();
  displacements
    .sort((a, b) => b.sizePct - a.sizePct) // Strongest first
    .forEach(d => {
      let overlaps = false;
      for (let i = d.startIndex; i <= d.endIndex; i++) {
        if (usedIndices.has(i)) { overlaps = true; break; }
      }
      if (!overlaps) {
        filtered.push(d);
        for (let i = d.startIndex; i <= d.endIndex; i++) usedIndices.add(i);
      }
    });

  return filtered.sort((a, b) => a.startIndex - b.startIndex);
}

// ─── Fibonacci Auto-Levels ──────────────────────────────────────────────────

export function calculateFibonacciLevels(swingPoints: SwingPoint[]): FibonacciLevel[] {
  if (swingPoints.length < 2) return [];

  // Find the most recent significant swing high and low
  const recentHighs = swingPoints.filter(s => s.type === 'high').slice(-3);
  const recentLows = swingPoints.filter(s => s.type === 'low').slice(-3);

  if (recentHighs.length === 0 || recentLows.length === 0) return [];

  // Use the most recent swing high and the most recent swing low
  const lastHigh = recentHighs[recentHighs.length - 1];
  const lastLow = recentLows[recentLows.length - 1];

  const isUpswing = lastLow.index < lastHigh.index; // Low came first = upswing
  const high = lastHigh.price;
  const low = lastLow.price;
  const range = high - low;

  const fibRatios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
  const fibLabels = ['0%', '23.6%', '38.2%', '50%', '61.8%', '78.6%', '100%'];

  return fibRatios.map((ratio, i) => ({
    level: ratio,
    price: isUpswing
      ? high - range * ratio  // Retracement from high
      : low + range * ratio,  // Retracement from low
    label: fibLabels[i],
  }));
}

// ─── Trend & Market Phase Detection ─────────────────────────────────────────

function detectTrend(
  marketStructure: MarketStructurePoint[]
): { trend: 'bullish' | 'bearish' | 'ranging'; strength: number } {
  if (marketStructure.length < 4) return { trend: 'ranging', strength: 0 };

  const recent = marketStructure.slice(-8);
  let bullishPoints = 0;
  let bearishPoints = 0;

  for (const s of recent) {
    if (s.label === 'HH') bullishPoints += 2;
    if (s.label === 'HL') bullishPoints += 1;
    if (s.label === 'LL') bearishPoints += 2;
    if (s.label === 'LH') bearishPoints += 1;
  }

  const total = bullishPoints + bearishPoints;
  if (total === 0) return { trend: 'ranging', strength: 0 };

  const bullishPct = (bullishPoints / total) * 100;
  const bearishPct = (bearishPoints / total) * 100;

  if (bullishPct > 65) return { trend: 'bullish', strength: bullishPct };
  if (bearishPct > 65) return { trend: 'bearish', strength: bearishPct };
  return { trend: 'ranging', strength: Math.max(bullishPct, bearishPct) };
}

function detectMarketPhase(
  candles: CandlestickData[],
  trend: 'bullish' | 'bearish' | 'ranging',
  displacements: Displacement[]
): 'accumulation' | 'markup' | 'distribution' | 'markdown' | 'unknown' {
  if (candles.length < 20) return 'unknown';

  const recent = candles.slice(-20);
  const rangeHigh = Math.max(...recent.map(c => c.high));
  const rangeLow = Math.min(...recent.map(c => c.low));
  const rangeSize = (rangeHigh - rangeLow) / rangeLow * 100;

  const recentDisplacements = displacements.filter(d => d.endIndex >= candles.length - 20);
  const hasBullishDisplacement = recentDisplacements.some(d => d.direction === 'bullish' && d.strength !== 'weak');
  const hasBearishDisplacement = recentDisplacements.some(d => d.direction === 'bearish' && d.strength !== 'weak');

  // Tight range with no strong displacements = accumulation or distribution
  if (rangeSize < 3 && !hasBullishDisplacement && !hasBearishDisplacement) {
    if (trend === 'bearish') return 'accumulation';
    if (trend === 'bullish') return 'distribution';
    return 'accumulation'; // Default for ranging
  }

  // Strong moves in trend direction
  if (trend === 'bullish' && hasBullishDisplacement) return 'markup';
  if (trend === 'bearish' && hasBearishDisplacement) return 'markdown';

  // Opposite displacement to trend = phase change
  if (trend === 'bullish' && hasBearishDisplacement) return 'distribution';
  if (trend === 'bearish' && hasBullishDisplacement) return 'accumulation';

  return 'unknown';
}

// ─── Signal Generation ──────────────────────────────────────────────────────

function generateSignals(
  candles: CandlestickData[],
  structureBreaks: StructureBreak[],
  fairValueGaps: FairValueGap[],
  liquiditySweeps: LiquiditySweep[],
  equalLevels: EqualLevel[],
  displacements: Displacement[],
  trend: 'bullish' | 'bearish' | 'ranging'
): PriceActionSignal[] {
  const signals: PriceActionSignal[] = [];
  if (candles.length < 5) return signals;

  const currentPrice = candles[candles.length - 1].close;
  const currentTime = candles[candles.length - 1].time as number;

  // Signal 1: Recent CHoCH (Change of Character) — strongest signal
  const recentCHoCH = structureBreaks
    .filter(b => b.type === 'CHoCH' && b.index >= candles.length - 5);
  for (const choch of recentCHoCH) {
    signals.push({
      type: choch.direction === 'bullish' ? 'BUY' : 'SELL',
      strength: 'strong',
      pattern: `CHoCH ${choch.direction}`,
      reason: `Change of Character: ${choch.direction} break at ${choch.brokenLevel.toFixed(2)}`,
      price: choch.price,
      time: choch.time,
      confidence: 80,
    });
  }

  // Signal 2: BOS in trend direction
  const recentBOS = structureBreaks
    .filter(b => b.type === 'BOS' && b.index >= candles.length - 5);
  for (const bos of recentBOS) {
    const withTrend = (bos.direction === 'bullish' && trend === 'bullish') ||
                      (bos.direction === 'bearish' && trend === 'bearish');
    signals.push({
      type: bos.direction === 'bullish' ? 'BUY' : 'SELL',
      strength: withTrend ? 'strong' : 'medium',
      pattern: `BOS ${bos.direction}`,
      reason: `Break of Structure ${withTrend ? '(with trend)' : '(counter-trend)'} at ${bos.brokenLevel.toFixed(2)}`,
      price: bos.price,
      time: bos.time,
      confidence: withTrend ? 75 : 55,
    });
  }

  // Signal 3: Unfilled FVGs near current price (potential magnets)
  const unfilledFVGs = fairValueGaps.filter(g => !g.filled);
  for (const fvg of unfilledFVGs) {
    const distanceToPricePct = Math.abs(currentPrice - fvg.midpoint) / currentPrice * 100;
    if (distanceToPricePct < 2) { // Within 2% of current price
      const isBelowPrice = fvg.midpoint < currentPrice;
      signals.push({
        type: isBelowPrice ? 'SELL' : 'BUY', // Price tends to fill gaps
        strength: fvg.size / currentPrice * 100 > 0.5 ? 'medium' : 'weak',
        pattern: `FVG ${fvg.type} unfilled`,
        reason: `Unfilled ${fvg.type} FVG at ${fvg.midpoint.toFixed(2)} (${distanceToPricePct.toFixed(1)}% away)`,
        price: fvg.midpoint,
        time: fvg.time,
        confidence: 60,
      });
    }
  }

  // Signal 4: Liquidity sweeps that recovered (reversal signal)
  const recentSweeps = liquiditySweeps
    .filter(s => s.index >= candles.length - 5 && s.recovered);
  for (const sweep of recentSweeps) {
    signals.push({
      type: sweep.type === 'sell-side' ? 'BUY' : 'SELL',
      strength: sweep.strength,
      pattern: `Liquidity Sweep ${sweep.type}`,
      reason: `${sweep.type} liquidity swept at ${sweep.sweptLevel.toFixed(2)}, price recovered`,
      price: sweep.price,
      time: sweep.time,
      confidence: 70,
    });
  }

  // Signal 5: Price approaching equal levels (liquidity pools)
  for (const level of equalLevels) {
    const distance = Math.abs(currentPrice - level.avgPrice) / currentPrice * 100;
    if (distance < 1 && level.liquidityPool) {
      const isAbove = level.avgPrice > currentPrice;
      signals.push({
        type: isAbove ? 'NEUTRAL' : 'NEUTRAL',
        strength: 'medium',
        pattern: `${level.type} (x${level.count})`,
        reason: `${level.type} liquidity pool at ${level.avgPrice.toFixed(2)} (${level.count} touches)`,
        price: level.avgPrice,
        time: currentTime,
        confidence: 55,
      });
    }
  }

  // Signal 6: Displacement in recent candles
  const recentDisplacements = displacements
    .filter(d => d.endIndex >= candles.length - 5);
  for (const disp of recentDisplacements) {
    signals.push({
      type: disp.direction === 'bullish' ? 'BUY' : 'SELL',
      strength: disp.strength,
      pattern: `Displacement ${disp.direction}`,
      reason: `${disp.direction} displacement: ${disp.sizePct.toFixed(2)}% in ${disp.candles} candles`,
      price: candles[disp.endIndex].close,
      time: candles[disp.endIndex].time as number,
      confidence: disp.strength === 'strong' ? 75 : disp.strength === 'medium' ? 60 : 45,
    });
  }

  // Only keep the most relevant signals (top 8 by confidence)
  return signals
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);
}

// ─── Master Analysis Function ───────────────────────────────────────────────

export function analyzePriceAction(
  candles: CandlestickData[],
  options: {
    swingLeftBars?: number;
    swingRightBars?: number;
    fvgMinGapPct?: number;
    equalLevelTolerance?: number;
    displacementMinPct?: number;
  } = {}
): PriceActionAnalysis {
  const {
    swingLeftBars = 3,
    swingRightBars = 3,
    fvgMinGapPct = 0.05,
    equalLevelTolerance = 0.15,
    displacementMinPct = 0.5,
  } = options;

  if (candles.length < 15) {
    return {
      swingPoints: [],
      marketStructure: [],
      structureBreaks: [],
      fairValueGaps: [],
      liquiditySweeps: [],
      equalLevels: [],
      displacements: [],
      fibLevels: [],
      signals: [],
      trend: 'ranging',
      trendStrength: 0,
      marketPhase: 'unknown',
    };
  }

  // 1. Detect swing points
  const swingPoints = detectSwingPoints(candles, swingLeftBars, swingRightBars);

  // 2. Analyze market structure
  const marketStructure = analyzeMarketStructure(swingPoints);

  // 3. Detect structure breaks (BOS/CHoCH)
  const structureBreaks = detectStructureBreaks(candles, swingPoints, marketStructure);

  // 4. Detect Fair Value Gaps
  const fairValueGaps = detectFairValueGaps(candles, fvgMinGapPct);

  // 5. Detect Liquidity Sweeps
  const liquiditySweeps = detectLiquiditySweeps(candles, swingPoints);

  // 6. Detect Equal Levels
  const equalLevels = detectEqualLevels(candles, swingPoints, equalLevelTolerance);

  // 7. Detect Displacements
  const displacements = detectDisplacements(candles, displacementMinPct);

  // 8. Calculate Fibonacci Levels
  const fibLevels = calculateFibonacciLevels(swingPoints);

  // 9. Determine trend and market phase
  const { trend, strength: trendStrength } = detectTrend(marketStructure);
  const marketPhase = detectMarketPhase(candles, trend, displacements);

  // 10. Generate signals
  const signals = generateSignals(
    candles, structureBreaks, fairValueGaps, liquiditySweeps,
    equalLevels, displacements, trend
  );

  return {
    swingPoints,
    marketStructure,
    structureBreaks,
    fairValueGaps,
    liquiditySweeps,
    equalLevels,
    displacements,
    fibLevels,
    signals,
    trend,
    trendStrength,
    marketPhase,
  };
}

