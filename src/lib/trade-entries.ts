import type { CandlestickData } from "lightweight-charts";
import type { PriceActionAnalysis } from "./price-action";
import type { CandlestickPattern } from "./candlestick-patterns";
import type { PatternAnalysis } from "./mirror-patterns";

// ─── Types ──────────────────────────────────────────────────────────────────

export type TradeEntry = {
  id: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  stopLoss: number;
  takeProfit1: number; // TP1 (conservative)
  takeProfit2: number; // TP2 (aggressive)
  riskReward: number;  // R:R ratio for TP1
  riskReward2: number; // R:R ratio for TP2
  riskPct: number;     // SL distance as % of entry
  confidence: number;  // 0-100
  confluences: string[];  // reasons supporting this entry
  pattern: string;     // primary pattern driving entry
  timeframe: string;
  timestamp: number;
  status: 'active' | 'triggered' | 'invalidated';
};

export type TradeSetup = {
  bestEntry: TradeEntry | null;
  alternativeEntries: TradeEntry[];
  bias: 'LONG' | 'SHORT' | 'NEUTRAL';
  biasStrength: number; // 0-100
  summary: string;
};

// ─── Entry Calculation Engine ───────────────────────────────────────────────

export function generateTradeEntries(
  candles: CandlestickData[],
  priceAction: PriceActionAnalysis,
  candlePatterns: CandlestickPattern[],
  mirrorAnalysis: PatternAnalysis | null,
  timeframe: string = '4h'
): TradeSetup {
  if (candles.length < 20) {
    return {
      bestEntry: null,
      alternativeEntries: [],
      bias: 'NEUTRAL',
      biasStrength: 0,
      summary: 'Not enough data for trade entries',
    };
  }

  const currentPrice = candles[candles.length - 1].close;
  const currentHigh = candles[candles.length - 1].high;
  const currentLow = candles[candles.length - 1].low;
  const currentTime = candles[candles.length - 1].time as number;

  // Calculate ATR for sizing SL/TP
  const atr = calculateATR(candles, 14);

  const entries: TradeEntry[] = [];
  let idCounter = 0;

  // ─── Strategy 1: CHoCH + FVG Entry ───────────────────────────────────────
  // When there's a Change of Character, look for an FVG to enter on retrace
  const recentCHoCH = priceAction.structureBreaks
    .filter(b => b.type === 'CHoCH' && b.index >= candles.length - 10);

  for (const choch of recentCHoCH) {
    const nearbyFVGs = priceAction.fairValueGaps
      .filter(g => !g.filled && Math.abs(g.endIndex - choch.index) < 15);

    if (choch.direction === 'bullish') {
      // Bullish CHoCH → look for bullish FVG below price to enter long
      const bullishFVG = nearbyFVGs.find(g => g.type === 'bullish' && g.midpoint < currentPrice);
      if (bullishFVG) {
        const entry = bullishFVG.midpoint;
        const sl = findBullishStopLoss(candles, priceAction, entry, atr);
        const tp1 = findBullishTP(candles, priceAction, entry, sl, 2);
        const tp2 = findBullishTP(candles, priceAction, entry, sl, 3);
        const risk = entry - sl;

        if (risk > 0 && tp1 > entry) {
          const confluences = ['CHoCH Bullish', `FVG entry at ${entry.toFixed(2)}`];
          addConfluences(confluences, 'LONG', candles, priceAction, candlePatterns, mirrorAnalysis, entry);

          entries.push({
            id: `entry-${++idCounter}`,
            direction: 'LONG',
            entry,
            stopLoss: sl,
            takeProfit1: tp1,
            takeProfit2: tp2,
            riskReward: (tp1 - entry) / risk,
            riskReward2: (tp2 - entry) / risk,
            riskPct: (risk / entry) * 100,
            confidence: calculateConfidence(confluences, priceAction, 'LONG'),
            confluences,
            pattern: 'CHoCH + FVG',
            timeframe,
            timestamp: currentTime,
            status: currentPrice <= entry ? 'active' : 'triggered',
          });
        }
      }
    } else {
      // Bearish CHoCH → look for bearish FVG above price to enter short
      const bearishFVG = nearbyFVGs.find(g => g.type === 'bearish' && g.midpoint > currentPrice);
      if (bearishFVG) {
        const entry = bearishFVG.midpoint;
        const sl = findBearishStopLoss(candles, priceAction, entry, atr);
        const tp1 = findBearishTP(candles, priceAction, entry, sl, 2);
        const tp2 = findBearishTP(candles, priceAction, entry, sl, 3);
        const risk = sl - entry;

        if (risk > 0 && tp1 < entry) {
          const confluences = ['CHoCH Bearish', `FVG entry at ${entry.toFixed(2)}`];
          addConfluences(confluences, 'SHORT', candles, priceAction, candlePatterns, mirrorAnalysis, entry);

          entries.push({
            id: `entry-${++idCounter}`,
            direction: 'SHORT',
            entry,
            stopLoss: sl,
            takeProfit1: tp1,
            takeProfit2: tp2,
            riskReward: (entry - tp1) / risk,
            riskReward2: (entry - tp2) / risk,
            riskPct: (risk / entry) * 100,
            confidence: calculateConfidence(confluences, priceAction, 'SHORT'),
            confluences,
            pattern: 'CHoCH + FVG',
            timeframe,
            timestamp: currentTime,
            status: currentPrice >= entry ? 'active' : 'triggered',
          });
        }
      }
    }
  }

  // ─── Strategy 2: BOS + Order Block Entry ─────────────────────────────────
  const recentBOS = priceAction.structureBreaks
    .filter(b => b.type === 'BOS' && b.index >= candles.length - 10);

  for (const bos of recentBOS) {
    if (bos.direction === 'bullish') {
      // After bullish BOS, enter long at nearest unfilled bullish FVG or swing low
      const entryLevel = findRetraceEntry(candles, priceAction, 'LONG', currentPrice, atr);
      if (entryLevel) {
        const sl = findBullishStopLoss(candles, priceAction, entryLevel, atr);
        const tp1 = findBullishTP(candles, priceAction, entryLevel, sl, 2);
        const tp2 = findBullishTP(candles, priceAction, entryLevel, sl, 3);
        const risk = entryLevel - sl;

        if (risk > 0 && tp1 > entryLevel) {
          const confluences = ['BOS Bullish', `Retrace entry at ${entryLevel.toFixed(2)}`];
          addConfluences(confluences, 'LONG', candles, priceAction, candlePatterns, mirrorAnalysis, entryLevel);

          entries.push({
            id: `entry-${++idCounter}`,
            direction: 'LONG',
            entry: entryLevel,
            stopLoss: sl,
            takeProfit1: tp1,
            takeProfit2: tp2,
            riskReward: (tp1 - entryLevel) / risk,
            riskReward2: (tp2 - entryLevel) / risk,
            riskPct: (risk / entryLevel) * 100,
            confidence: calculateConfidence(confluences, priceAction, 'LONG'),
            confluences,
            pattern: 'BOS + Retrace',
            timeframe,
            timestamp: currentTime,
            status: currentPrice <= entryLevel ? 'active' : 'triggered',
          });
        }
      }
    } else {
      const entryLevel = findRetraceEntry(candles, priceAction, 'SHORT', currentPrice, atr);
      if (entryLevel) {
        const sl = findBearishStopLoss(candles, priceAction, entryLevel, atr);
        const tp1 = findBearishTP(candles, priceAction, entryLevel, sl, 2);
        const tp2 = findBearishTP(candles, priceAction, entryLevel, sl, 3);
        const risk = sl - entryLevel;

        if (risk > 0 && tp1 < entryLevel) {
          const confluences = ['BOS Bearish', `Retrace entry at ${entryLevel.toFixed(2)}`];
          addConfluences(confluences, 'SHORT', candles, priceAction, candlePatterns, mirrorAnalysis, entryLevel);

          entries.push({
            id: `entry-${++idCounter}`,
            direction: 'SHORT',
            entry: entryLevel,
            stopLoss: sl,
            takeProfit1: tp1,
            takeProfit2: tp2,
            riskReward: (entryLevel - tp1) / risk,
            riskReward2: (entryLevel - tp2) / risk,
            riskPct: (risk / entryLevel) * 100,
            confidence: calculateConfidence(confluences, priceAction, 'SHORT'),
            confluences,
            pattern: 'BOS + Retrace',
            timeframe,
            timestamp: currentTime,
            status: currentPrice >= entryLevel ? 'active' : 'triggered',
          });
        }
      }
    }
  }

  // ─── Strategy 3: Liquidity Sweep Reversal ────────────────────────────────
  const recentSweeps = priceAction.liquiditySweeps
    .filter(s => s.index >= candles.length - 5 && s.recovered);

  for (const sweep of recentSweeps) {
    if (sweep.type === 'sell-side') {
      // Sell-side sweep + recovery → LONG
      const entry = currentPrice; // Market entry after confirmed recovery
      const sl = sweep.price - atr * 0.5; // Below the sweep low
      const tp1 = findBullishTP(candles, priceAction, entry, sl, 2);
      const tp2 = findBullishTP(candles, priceAction, entry, sl, 3);
      const risk = entry - sl;

      if (risk > 0) {
        const confluences = ['Sell-side liquidity swept', 'Price recovered above sweep'];
        addConfluences(confluences, 'LONG', candles, priceAction, candlePatterns, mirrorAnalysis, entry);

        entries.push({
          id: `entry-${++idCounter}`,
          direction: 'LONG',
          entry,
          stopLoss: sl,
          takeProfit1: tp1,
          takeProfit2: tp2,
          riskReward: (tp1 - entry) / risk,
          riskReward2: (tp2 - entry) / risk,
          riskPct: (risk / entry) * 100,
          confidence: calculateConfidence(confluences, priceAction, 'LONG'),
          confluences,
          pattern: 'Liquidity Sweep',
          timeframe,
          timestamp: currentTime,
          status: 'triggered',
        });
      }
    } else {
      // Buy-side sweep + recovery → SHORT
      const entry = currentPrice;
      const sl = sweep.price + atr * 0.5;
      const tp1 = findBearishTP(candles, priceAction, entry, sl, 2);
      const tp2 = findBearishTP(candles, priceAction, entry, sl, 3);
      const risk = sl - entry;

      if (risk > 0) {
        const confluences = ['Buy-side liquidity swept', 'Price rejected above sweep'];
        addConfluences(confluences, 'SHORT', candles, priceAction, candlePatterns, mirrorAnalysis, entry);

        entries.push({
          id: `entry-${++idCounter}`,
          direction: 'SHORT',
          entry,
          stopLoss: sl,
          takeProfit1: tp1,
          takeProfit2: tp2,
          riskReward: (entry - tp1) / risk,
          riskReward2: (entry - tp2) / risk,
          riskPct: (risk / entry) * 100,
          confidence: calculateConfidence(confluences, priceAction, 'SHORT'),
          confluences,
          pattern: 'Liquidity Sweep',
          timeframe,
          timestamp: currentTime,
          status: 'triggered',
        });
      }
    }
  }

  // ─── Strategy 4: Candlestick Pattern + Structure ─────────────────────────
  const recentPats = candlePatterns
    .filter(p => p.index >= candles.length - 5 && p.strength !== 'weak');

  for (const pat of recentPats) {
    if (pat.type === 'bullish' && priceAction.trend !== 'bearish') {
      const entry = currentPrice;
      const sl = findBullishStopLoss(candles, priceAction, entry, atr);
      const tp1 = findBullishTP(candles, priceAction, entry, sl, 2);
      const tp2 = findBullishTP(candles, priceAction, entry, sl, 3);
      const risk = entry - sl;

      if (risk > 0 && tp1 > entry) {
        const confluences = [`${pat.name} pattern`, pat.description];
        addConfluences(confluences, 'LONG', candles, priceAction, candlePatterns, mirrorAnalysis, entry);

        entries.push({
          id: `entry-${++idCounter}`,
          direction: 'LONG',
          entry,
          stopLoss: sl,
          takeProfit1: tp1,
          takeProfit2: tp2,
          riskReward: (tp1 - entry) / risk,
          riskReward2: (tp2 - entry) / risk,
          riskPct: (risk / entry) * 100,
          confidence: calculateConfidence(confluences, priceAction, 'LONG'),
          confluences,
          pattern: pat.name,
          timeframe,
          timestamp: currentTime,
          status: 'triggered',
        });
      }
    } else if (pat.type === 'bearish' && priceAction.trend !== 'bullish') {
      const entry = currentPrice;
      const sl = findBearishStopLoss(candles, priceAction, entry, atr);
      const tp1 = findBearishTP(candles, priceAction, entry, sl, 2);
      const tp2 = findBearishTP(candles, priceAction, entry, sl, 3);
      const risk = sl - entry;

      if (risk > 0 && tp1 < entry) {
        const confluences = [`${pat.name} pattern`, pat.description];
        addConfluences(confluences, 'SHORT', candles, priceAction, candlePatterns, mirrorAnalysis, entry);

        entries.push({
          id: `entry-${++idCounter}`,
          direction: 'SHORT',
          entry,
          stopLoss: sl,
          takeProfit1: tp1,
          takeProfit2: tp2,
          riskReward: (entry - tp1) / risk,
          riskReward2: (entry - tp2) / risk,
          riskPct: (risk / entry) * 100,
          confidence: calculateConfidence(confluences, priceAction, 'SHORT'),
          confluences,
          pattern: pat.name,
          timeframe,
          timestamp: currentTime,
          status: 'triggered',
        });
      }
    }
  }

  // ─── Strategy 5: Displacement + FVG (Market entry on momentum) ───────────
  const recentDisplacements = priceAction.displacements
    .filter(d => d.endIndex >= candles.length - 5 && d.strength !== 'weak');

  for (const disp of recentDisplacements) {
    // After a strong displacement, look for FVG created by it
    const dispFVGs = priceAction.fairValueGaps
      .filter(g => !g.filled && g.startIndex >= disp.startIndex && g.endIndex <= disp.endIndex + 2);

    if (disp.direction === 'bullish' && dispFVGs.length > 0) {
      const fvg = dispFVGs[0];
      const entry = fvg.midpoint;
      const sl = fvg.low - atr * 0.3;
      const tp1 = findBullishTP(candles, priceAction, entry, sl, 2.5);
      const tp2 = findBullishTP(candles, priceAction, entry, sl, 4);
      const risk = entry - sl;

      if (risk > 0 && tp1 > entry && entry < currentPrice) {
        const confluences = [`Bullish displacement ${disp.sizePct.toFixed(1)}%`, `FVG at ${entry.toFixed(2)}`];
        addConfluences(confluences, 'LONG', candles, priceAction, candlePatterns, mirrorAnalysis, entry);

        entries.push({
          id: `entry-${++idCounter}`,
          direction: 'LONG',
          entry,
          stopLoss: sl,
          takeProfit1: tp1,
          takeProfit2: tp2,
          riskReward: (tp1 - entry) / risk,
          riskReward2: (tp2 - entry) / risk,
          riskPct: (risk / entry) * 100,
          confidence: calculateConfidence(confluences, priceAction, 'LONG'),
          confluences,
          pattern: 'Displacement + FVG',
          timeframe,
          timestamp: currentTime,
          status: currentPrice <= entry ? 'active' : 'triggered',
        });
      }
    } else if (disp.direction === 'bearish' && dispFVGs.length > 0) {
      const fvg = dispFVGs[0];
      const entry = fvg.midpoint;
      const sl = fvg.high + atr * 0.3;
      const tp1 = findBearishTP(candles, priceAction, entry, sl, 2.5);
      const tp2 = findBearishTP(candles, priceAction, entry, sl, 4);
      const risk = sl - entry;

      if (risk > 0 && tp1 < entry && entry > currentPrice) {
        const confluences = [`Bearish displacement ${disp.sizePct.toFixed(1)}%`, `FVG at ${entry.toFixed(2)}`];
        addConfluences(confluences, 'SHORT', candles, priceAction, candlePatterns, mirrorAnalysis, entry);

        entries.push({
          id: `entry-${++idCounter}`,
          direction: 'SHORT',
          entry,
          stopLoss: sl,
          takeProfit1: tp1,
          takeProfit2: tp2,
          riskReward: (entry - tp1) / risk,
          riskReward2: (entry - tp2) / risk,
          riskPct: (risk / entry) * 100,
          confidence: calculateConfidence(confluences, priceAction, 'SHORT'),
          confluences,
          pattern: 'Displacement + FVG',
          timeframe,
          timestamp: currentTime,
          status: currentPrice >= entry ? 'active' : 'triggered',
        });
      }
    }
  }

  // ─── Fallback Strategy: Trend-following with Fibonacci ───────────────────
  if (entries.length === 0 && priceAction.fibLevels.length > 0 && priceAction.trend !== 'ranging') {
    const fib618 = priceAction.fibLevels.find(f => f.level === 0.618);
    const fib500 = priceAction.fibLevels.find(f => f.level === 0.5);
    const fib382 = priceAction.fibLevels.find(f => f.level === 0.382);

    if (priceAction.trend === 'bullish' && fib618 && fib500) {
      // In bullish trend, look to buy at 0.618 fib
      const entry = fib618.price;
      const sl = entry - atr * 1.5;
      const tp1 = fib382 ? fib382.price : entry + (entry - sl) * 2;
      const tp2 = candles.reduce((max, c) => Math.max(max, c.high), 0); // Recent high
      const risk = entry - sl;

      if (risk > 0 && entry < currentPrice) {
        const confluences = ['Bullish trend', 'Fib 0.618 retrace entry'];
        if (fib500 && Math.abs(currentPrice - fib500.price) / currentPrice < 0.01) {
          confluences.push('Near Fib 0.5 level');
        }
        addConfluences(confluences, 'LONG', candles, priceAction, candlePatterns, mirrorAnalysis, entry);

        entries.push({
          id: `entry-${++idCounter}`,
          direction: 'LONG',
          entry,
          stopLoss: sl,
          takeProfit1: tp1,
          takeProfit2: tp2,
          riskReward: (tp1 - entry) / risk,
          riskReward2: (tp2 - entry) / risk,
          riskPct: (risk / entry) * 100,
          confidence: calculateConfidence(confluences, priceAction, 'LONG'),
          confluences,
          pattern: 'Fib Retrace',
          timeframe,
          timestamp: currentTime,
          status: currentPrice <= entry ? 'active' : 'triggered',
        });
      }
    } else if (priceAction.trend === 'bearish' && fib618 && fib500) {
      const entry = fib618.price;
      const sl = entry + atr * 1.5;
      const tp1 = fib382 ? fib382.price : entry - (sl - entry) * 2;
      const tp2 = candles.reduce((min, c) => Math.min(min, c.low), Infinity);
      const risk = sl - entry;

      if (risk > 0 && entry > currentPrice) {
        const confluences = ['Bearish trend', 'Fib 0.618 retrace entry'];
        addConfluences(confluences, 'SHORT', candles, priceAction, candlePatterns, mirrorAnalysis, entry);

        entries.push({
          id: `entry-${++idCounter}`,
          direction: 'SHORT',
          entry,
          stopLoss: sl,
          takeProfit1: tp1,
          takeProfit2: tp2,
          riskReward: (entry - tp1) / risk,
          riskReward2: (entry - tp2) / risk,
          riskPct: (risk / entry) * 100,
          confidence: calculateConfidence(confluences, priceAction, 'SHORT'),
          confluences,
          pattern: 'Fib Retrace',
          timeframe,
          timestamp: currentTime,
          status: currentPrice >= entry ? 'active' : 'triggered',
        });
      }
    }
  }

  // ─── Sort by confidence and select best ──────────────────────────────────
  entries.sort((a, b) => b.confidence - a.confidence);

  // Filter out entries with R:R < 1.5
  const validEntries = entries.filter(e => e.riskReward >= 1.5);

  const bestEntry = validEntries[0] || null;
  const alternativeEntries = validEntries.slice(1, 3);

  // Overall bias
  const longEntries = validEntries.filter(e => e.direction === 'LONG');
  const shortEntries = validEntries.filter(e => e.direction === 'SHORT');
  const longScore = longEntries.reduce((s, e) => s + e.confidence, 0);
  const shortScore = shortEntries.reduce((s, e) => s + e.confidence, 0);
  const totalScore = longScore + shortScore;

  const bias: 'LONG' | 'SHORT' | 'NEUTRAL' =
    totalScore === 0 ? 'NEUTRAL' :
    longScore > shortScore * 1.3 ? 'LONG' :
    shortScore > longScore * 1.3 ? 'SHORT' : 'NEUTRAL';

  const biasStrength = totalScore === 0 ? 0 :
    Math.round(Math.abs(longScore - shortScore) / totalScore * 100);

  // Build summary
  let summary = '';
  if (bestEntry) {
    const dir = bestEntry.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
    summary = `${dir} @ ${bestEntry.entry.toFixed(2)} | SL: ${bestEntry.stopLoss.toFixed(2)} | TP: ${bestEntry.takeProfit1.toFixed(2)} | R:R ${bestEntry.riskReward.toFixed(1)} | ${bestEntry.confidence}% conf`;
  } else {
    summary = '⏸ No high-confidence entry found — wait for setup';
  }

  return {
    bestEntry,
    alternativeEntries,
    bias,
    biasStrength,
    summary,
  };
}

// ─── Helper Functions ───────────────────────────────────────────────────────

function calculateATR(candles: CandlestickData[], period: number): number {
  if (candles.length < period + 1) return 0;
  let atrSum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1]?.close ?? candles[i].open;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    atrSum += tr;
  }
  return atrSum / period;
}

function findBullishStopLoss(
  candles: CandlestickData[],
  pa: PriceActionAnalysis,
  entry: number,
  atr: number
): number {
  // Look for swing low below entry
  const swingLows = pa.swingPoints
    .filter(s => s.type === 'low' && s.price < entry)
    .sort((a, b) => b.price - a.price); // Highest low below entry (tightest SL)

  if (swingLows.length > 0) {
    // Place SL just below the nearest swing low
    return swingLows[0].price - atr * 0.2;
  }

  // Fallback: recent candle lows
  const recentLows = candles.slice(-10).map(c => c.low);
  const lowestRecent = Math.min(...recentLows);
  return lowestRecent - atr * 0.2;
}

function findBearishStopLoss(
  candles: CandlestickData[],
  pa: PriceActionAnalysis,
  entry: number,
  atr: number
): number {
  // Look for swing high above entry
  const swingHighs = pa.swingPoints
    .filter(s => s.type === 'high' && s.price > entry)
    .sort((a, b) => a.price - b.price); // Lowest high above entry (tightest SL)

  if (swingHighs.length > 0) {
    return swingHighs[0].price + atr * 0.2;
  }

  const recentHighs = candles.slice(-10).map(c => c.high);
  const highestRecent = Math.max(...recentHighs);
  return highestRecent + atr * 0.2;
}

function findBullishTP(
  candles: CandlestickData[],
  pa: PriceActionAnalysis,
  entry: number,
  sl: number,
  minRR: number
): number {
  const risk = entry - sl;
  const minTP = entry + risk * minRR;

  // Check swing highs above entry for TP target
  const swingHighs = pa.swingPoints
    .filter(s => s.type === 'high' && s.price > entry)
    .sort((a, b) => a.price - b.price);

  // Use nearest swing high that gives at least minRR
  for (const sh of swingHighs) {
    if (sh.price >= minTP) return sh.price;
  }

  // Check equal highs (liquidity targets)
  for (const eq of pa.equalLevels) {
    if (eq.type === 'equal-highs' && eq.avgPrice >= minTP) {
      return eq.avgPrice;
    }
  }

  // Fallback: use R:R multiplier
  return minTP;
}

function findBearishTP(
  candles: CandlestickData[],
  pa: PriceActionAnalysis,
  entry: number,
  sl: number,
  minRR: number
): number {
  const risk = sl - entry;
  const minTP = entry - risk * minRR;

  const swingLows = pa.swingPoints
    .filter(s => s.type === 'low' && s.price < entry)
    .sort((a, b) => b.price - a.price);

  for (const sl2 of swingLows) {
    if (sl2.price <= minTP) return sl2.price;
  }

  for (const eq of pa.equalLevels) {
    if (eq.type === 'equal-lows' && eq.avgPrice <= minTP) {
      return eq.avgPrice;
    }
  }

  return minTP;
}

function findRetraceEntry(
  candles: CandlestickData[],
  pa: PriceActionAnalysis,
  direction: 'LONG' | 'SHORT',
  currentPrice: number,
  atr: number
): number | null {
  if (direction === 'LONG') {
    // Look for unfilled bullish FVG below price
    const bullFVG = pa.fairValueGaps
      .filter(g => !g.filled && g.type === 'bullish' && g.midpoint < currentPrice)
      .sort((a, b) => b.midpoint - a.midpoint); // Nearest to price first

    if (bullFVG.length > 0) return bullFVG[0].midpoint;

    // Look for 0.5/0.618 Fib
    const fib = pa.fibLevels.find(f => f.level === 0.618 && f.price < currentPrice);
    if (fib) return fib.price;

    // Look for recent swing low as support to enter near
    const swingLow = pa.swingPoints
      .filter(s => s.type === 'low' && s.price < currentPrice)
      .sort((a, b) => b.price - a.price);
    if (swingLow.length > 0) return swingLow[0].price + atr * 0.2;
  } else {
    const bearFVG = pa.fairValueGaps
      .filter(g => !g.filled && g.type === 'bearish' && g.midpoint > currentPrice)
      .sort((a, b) => a.midpoint - b.midpoint);

    if (bearFVG.length > 0) return bearFVG[0].midpoint;

    const fib = pa.fibLevels.find(f => f.level === 0.618 && f.price > currentPrice);
    if (fib) return fib.price;

    const swingHigh = pa.swingPoints
      .filter(s => s.type === 'high' && s.price > currentPrice)
      .sort((a, b) => a.price - b.price);
    if (swingHigh.length > 0) return swingHigh[0].price - atr * 0.2;
  }

  return null;
}

function addConfluences(
  confluences: string[],
  direction: 'LONG' | 'SHORT',
  candles: CandlestickData[],
  pa: PriceActionAnalysis,
  candlePatterns: CandlestickPattern[],
  mirrorAnalysis: PatternAnalysis | null,
  entryPrice: number
) {
  // Check trend alignment
  if (direction === 'LONG' && pa.trend === 'bullish') confluences.push('With trend (bullish)');
  if (direction === 'SHORT' && pa.trend === 'bearish') confluences.push('With trend (bearish)');

  // Check market phase
  if (direction === 'LONG' && (pa.marketPhase === 'accumulation' || pa.marketPhase === 'markup'))
    confluences.push(`Phase: ${pa.marketPhase}`);
  if (direction === 'SHORT' && (pa.marketPhase === 'distribution' || pa.marketPhase === 'markdown'))
    confluences.push(`Phase: ${pa.marketPhase}`);

  // Check nearby candlestick patterns
  const recentBullPat = candlePatterns.find(p =>
    p.type === (direction === 'LONG' ? 'bullish' : 'bearish') &&
    p.index >= candles.length - 5 &&
    p.strength !== 'weak'
  );
  if (recentBullPat) confluences.push(`${recentBullPat.name} candle confirmation`);

  // Check mirror analysis
  if (mirrorAnalysis) {
    const mirrorSig = mirrorAnalysis.signals.find(s =>
      (direction === 'LONG' && s.type === 'BUY') ||
      (direction === 'SHORT' && s.type === 'SELL')
    );
    if (mirrorSig) confluences.push(`Mirror: ${mirrorSig.pattern}`);
  }

  // Check displacement
  const recentDisp = pa.displacements.find(d =>
    d.endIndex >= candles.length - 10 &&
    d.direction === (direction === 'LONG' ? 'bullish' : 'bearish') &&
    d.strength !== 'weak'
  );
  if (recentDisp) confluences.push(`${recentDisp.direction} displacement (${recentDisp.sizePct.toFixed(1)}%)`);

  // Check FVG alignment
  const nearbyFVG = pa.fairValueGaps.find(g =>
    !g.filled &&
    Math.abs(g.midpoint - entryPrice) / entryPrice < 0.005 &&
    g.type === (direction === 'LONG' ? 'bullish' : 'bearish')
  );
  if (nearbyFVG) confluences.push('Entry at FVG midpoint');

  // Check Fib alignment
  const nearFib = pa.fibLevels.find(f =>
    [0.382, 0.5, 0.618].includes(f.level) &&
    Math.abs(f.price - entryPrice) / entryPrice < 0.003
  );
  if (nearFib) confluences.push(`At Fib ${nearFib.label}`);
}

function calculateConfidence(
  confluences: string[],
  pa: PriceActionAnalysis,
  direction: 'LONG' | 'SHORT'
): number {
  let score = 30; // Base

  // Each confluence adds points
  score += Math.min(confluences.length * 8, 40);

  // Trend alignment bonus
  if ((direction === 'LONG' && pa.trend === 'bullish') ||
      (direction === 'SHORT' && pa.trend === 'bearish')) {
    score += 15;
  }

  // Against trend penalty
  if ((direction === 'LONG' && pa.trend === 'bearish') ||
      (direction === 'SHORT' && pa.trend === 'bullish')) {
    score -= 20;
  }

  // Market phase bonus
  if (direction === 'LONG' && (pa.marketPhase === 'accumulation' || pa.marketPhase === 'markup'))
    score += 10;
  if (direction === 'SHORT' && (pa.marketPhase === 'distribution' || pa.marketPhase === 'markdown'))
    score += 10;

  return Math.max(0, Math.min(100, score));
}

