import type { CandlestickData } from "lightweight-charts";

export type PatternSignal = {
  type: 'BUY' | 'SELL' | 'NEUTRAL';
  strength: 'weak' | 'medium' | 'strong';
  reason: string;
  time: number;
  price: number;
  mirrorPrice: number;
  pattern: string;
};

export type PatternAnalysis = {
  signals: PatternSignal[];
  symmetry: number; // 0-1, how symmetric the moves are
  mirrorExtreme: boolean; // true if mirror shows extreme move
  divergence: number; // positive = bullish divergence, negative = bearish
  trend: 'bullish' | 'bearish' | 'neutral';
};

/**
 * Analyze patterns between real price and mirrored price
 */
export function analyzeMirrorPatterns(
  candles: CandlestickData[],
  mirrorValues: number[]
): PatternAnalysis {
  if (candles.length < 10 || mirrorValues.length < 10) {
    return {
      signals: [],
      symmetry: 0.5,
      mirrorExtreme: false,
      divergence: 0,
      trend: 'neutral',
    };
  }

  const signals: PatternSignal[] = [];
  const closes = candles.map(c => c.close);
  const times = candles.map(c => c.time as number);
  const baseOpen = candles[0].open;

  // Calculate symmetry score (how balanced up vs down moves are)
  let upMoves = 0;
  let downMoves = 0;
  let totalMove = 0;
  for (let i = 1; i < closes.length; i++) {
    const move = Math.abs(closes[i] - closes[i - 1]);
    totalMove += move;
    if (closes[i] > closes[i - 1]) upMoves += move;
    else downMoves += move;
  }
  const symmetry = totalMove > 0 
    ? 1 - Math.abs(upMoves - downMoves) / totalMove 
    : 0.5;

  // Detect mirror extremes (when mirror shows very steep moves)
  const mirrorMoves = mirrorValues.slice(-20).map((v, i, arr) => 
    i > 0 ? Math.abs(v - arr[i - 1]) : 0
  );
  const avgMirrorMove = mirrorMoves.reduce((a, b) => a + b, 0) / (mirrorMoves.length - 1);
  const recentMirrorMove = mirrorMoves[mirrorMoves.length - 1];
  const mirrorExtreme = recentMirrorMove > avgMirrorMove * 2;

  // Calculate divergence (price vs mirror direction)
  const recentPriceChange = closes[closes.length - 1] - closes[Math.max(0, closes.length - 10)];
  const recentMirrorChange = mirrorValues[mirrorValues.length - 1] - mirrorValues[Math.max(0, mirrorValues.length - 10)];
  const divergence = recentPriceChange > 0 && recentMirrorChange < 0 
    ? 1 
    : recentPriceChange < 0 && recentMirrorChange > 0 
    ? -1 
    : 0;

  // Determine trend
  const priceChange = closes[closes.length - 1] - closes[0];
  const trend: 'bullish' | 'bearish' | 'neutral' = 
    priceChange > baseOpen * 0.01 ? 'bullish' :
    priceChange < -baseOpen * 0.01 ? 'bearish' :
    'neutral';

  // Pattern 1: Mirror shows extreme bullish move while price is consolidating
  if (mirrorExtreme && recentMirrorChange > 0 && Math.abs(recentPriceChange) < baseOpen * 0.005) {
    signals.push({
      type: 'BUY',
      strength: 'medium',
      reason: 'Mirror shows extreme bullish move, price consolidating',
      time: times[times.length - 1],
      price: closes[closes.length - 1],
      mirrorPrice: mirrorValues[mirrorValues.length - 1],
      pattern: 'Mirror Extreme Bullish',
    });
  }

  // Pattern 2: Mirror shows extreme bearish move while price is consolidating
  if (mirrorExtreme && recentMirrorChange < 0 && Math.abs(recentPriceChange) < baseOpen * 0.005) {
    signals.push({
      type: 'SELL',
      strength: 'medium',
      reason: 'Mirror shows extreme bearish move, price consolidating',
      time: times[times.length - 1],
      price: closes[closes.length - 1],
      mirrorPrice: mirrorValues[mirrorValues.length - 1],
      pattern: 'Mirror Extreme Bearish',
    });
  }

  // Pattern 3: Bullish divergence (price making lower lows, mirror making higher lows)
  if (closes.length >= 20) {
    const priceLow1 = Math.min(...closes.slice(-20, -10));
    const priceLow2 = Math.min(...closes.slice(-10));
    const mirrorLow1 = Math.min(...mirrorValues.slice(-20, -10));
    const mirrorLow2 = Math.min(...mirrorValues.slice(-10));
    
    if (priceLow2 < priceLow1 && mirrorLow2 > mirrorLow1) {
      signals.push({
        type: 'BUY',
        strength: 'strong',
        reason: 'Bullish divergence: price lower lows, mirror higher lows',
        time: times[times.length - 1],
        price: closes[closes.length - 1],
        mirrorPrice: mirrorValues[mirrorValues.length - 1],
        pattern: 'Bullish Divergence',
      });
    }

    // Pattern 4: Bearish divergence (price making higher highs, mirror making lower highs)
    const priceHigh1 = Math.max(...closes.slice(-20, -10));
    const priceHigh2 = Math.max(...closes.slice(-10));
    const mirrorHigh1 = Math.max(...mirrorValues.slice(-20, -10));
    const mirrorHigh2 = Math.max(...mirrorValues.slice(-10));
    
    if (priceHigh2 > priceHigh1 && mirrorHigh2 < mirrorHigh1) {
      signals.push({
        type: 'SELL',
        strength: 'strong',
        reason: 'Bearish divergence: price higher highs, mirror lower highs',
        time: times[times.length - 1],
        price: closes[closes.length - 1],
        mirrorPrice: mirrorValues[mirrorValues.length - 1],
        pattern: 'Bearish Divergence',
      });
    }
  }

  // Pattern 5: Symmetry break (sudden asymmetric move)
  if (closes.length >= 30) {
    const recentSymmetry = calculateLocalSymmetry(closes.slice(-10));
    const previousSymmetry = calculateLocalSymmetry(closes.slice(-30, -10));
    
    if (previousSymmetry > 0.7 && recentSymmetry < 0.4) {
      const direction = closes[closes.length - 1] > closes[closes.length - 10] ? 'BUY' : 'SELL';
      signals.push({
        type: direction,
        strength: 'medium',
        reason: 'Symmetry break: sudden asymmetric move detected',
        time: times[times.length - 1],
        price: closes[closes.length - 1],
        mirrorPrice: mirrorValues[mirrorValues.length - 1],
        pattern: 'Symmetry Break',
      });
    }
  }

  // Pattern 6: Price near mirror convergence (price and mirror getting close)
  const currentPrice = closes[closes.length - 1];
  const currentMirror = mirrorValues[mirrorValues.length - 1];
  const distance = Math.abs(currentPrice - currentMirror);
  const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length;
  const convergenceThreshold = avgPrice * 0.01; // 1% of average price

  if (distance < convergenceThreshold && closes.length >= 20) {
    const priceTrend = closes[closes.length - 1] - closes[closes.length - 20];
    const mirrorTrend = mirrorValues[mirrorValues.length - 1] - mirrorValues[mirrorValues.length - 20];
    
    if (priceTrend > 0 && mirrorTrend < 0) {
      signals.push({
        type: 'BUY',
        strength: 'weak',
        reason: 'Price and mirror converging, price rising',
        time: times[times.length - 1],
        price: currentPrice,
        mirrorPrice: currentMirror,
        pattern: 'Convergence Bullish',
      });
    } else if (priceTrend < 0 && mirrorTrend > 0) {
      signals.push({
        type: 'SELL',
        strength: 'weak',
        reason: 'Price and mirror converging, price falling',
        time: times[times.length - 1],
        price: currentPrice,
        mirrorPrice: currentMirror,
        pattern: 'Convergence Bearish',
      });
    }
  }

  // Pattern 7: Mirror reversal at extremes
  if (mirrorValues.length >= 10) {
    const mirrorMax = Math.max(...mirrorValues);
    const mirrorMin = Math.min(...mirrorValues);
    const currentMirror = mirrorValues[mirrorValues.length - 1];
    const prevMirror = mirrorValues[mirrorValues.length - 2];
    
    const nearMax = currentMirror > mirrorMax * 0.98;
    const nearMin = currentMirror < mirrorMin * 1.02;
    
    if (nearMax && currentMirror < prevMirror) {
      signals.push({
        type: 'SELL',
        strength: 'medium',
        reason: 'Mirror reversal at extreme high',
        time: times[times.length - 1],
        price: currentPrice,
        mirrorPrice: currentMirror,
        pattern: 'Mirror Reversal High',
      });
    }
    
    if (nearMin && currentMirror > prevMirror) {
      signals.push({
        type: 'BUY',
        strength: 'medium',
        reason: 'Mirror reversal at extreme low',
        time: times[times.length - 1],
        price: currentPrice,
        mirrorPrice: currentMirror,
        pattern: 'Mirror Reversal Low',
      });
    }
  }

  return {
    signals: signals.slice(-5), // Keep last 5 signals
    symmetry,
    mirrorExtreme,
    divergence,
    trend,
  };
}

function calculateLocalSymmetry(prices: number[]): number {
  if (prices.length < 2) return 0.5;
  let upMoves = 0;
  let downMoves = 0;
  let totalMove = 0;
  for (let i = 1; i < prices.length; i++) {
    const move = Math.abs(prices[i] - prices[i - 1]);
    totalMove += move;
    if (prices[i] > prices[i - 1]) upMoves += move;
    else downMoves += move;
  }
  return totalMove > 0 ? 1 - Math.abs(upMoves - downMoves) / totalMove : 0.5;
}

