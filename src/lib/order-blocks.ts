import type { CandlestickData } from "lightweight-charts";

export type OrderBlock = {
  price: number; // Block price level
  high: number; // Block high
  low: number; // Block low
  time: number; // When the block was formed
  type: 'bullish' | 'bearish'; // Bullish = support, Bearish = resistance
  strength: 'weak' | 'medium' | 'strong'; // Based on volume and price movement
  volume: number; // Estimated volume (based on candle size)
};

/**
 * Detect order blocks from candlestick data
 * Order blocks are areas where large orders were executed, creating support/resistance zones
 */
export function detectOrderBlocks(
  candles: CandlestickData[],
  options: {
    lookback?: number; // How many candles to analyze (default: 50)
    minBlockSize?: number; // Minimum price range for a block (default: 0.5% of price)
    volumeThreshold?: number; // Minimum volume relative to average (default: 1.5x)
  } = {}
): OrderBlock[] {
  const {
    lookback = 50,
    minBlockSize = 0.5,
    volumeThreshold = 1.5,
  } = options;

  if (candles.length < 10) return [];

  const recentCandles = candles.slice(-lookback);
  const blocks: OrderBlock[] = [];

  // Calculate average volume (using candle body size as proxy)
  const avgVolume = recentCandles.reduce((sum, c) => {
    const bodySize = Math.abs(c.close - c.open);
    return sum + bodySize;
  }, 0) / recentCandles.length;

  // Detect bullish order blocks (support zones)
  // These are areas where price rejected lower levels and moved up
  for (let i = 2; i < recentCandles.length - 1; i++) {
    const candle = recentCandles[i];
    const next = recentCandles[i + 1];

    // Bullish order block: Large green candle with lower wick, followed by upward movement
    const isBullish = candle.close > candle.open;
    const bodySize = Math.abs(candle.close - candle.open);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    
    // Check if this is a significant candle (large body relative to average)
    const volumeRatio = bodySize / (avgVolume || 1);
    
    // Bullish block criteria:
    // 1. Green candle (close > open)
    // 2. Significant size (body > minBlockSize% of price)
    // 3. Lower wick (rejection of lower prices) OR significant body
    // 4. Followed by upward movement (at least next candle)
    if (isBullish && 
        bodySize > (candle.close * minBlockSize / 100) &&
        volumeRatio > volumeThreshold &&
        (lowerWick > bodySize * 0.2 || bodySize > candle.close * 0.5 / 100) && // More lenient wick requirement
        next.close > candle.low) { // Price moved up from the low (more lenient)
      
      const blockPrice = candle.low; // Support level at the low
      const strength = volumeRatio > 2.5 ? 'strong' : volumeRatio > 1.8 ? 'medium' : 'weak';
      
      blocks.push({
        price: blockPrice,
        high: candle.high,
        low: candle.low,
        time: candle.time as number,
        type: 'bullish',
        strength,
        volume: bodySize,
      });
    }

    // Bearish order block: Large red candle with upper wick, followed by downward movement
    const isBearish = candle.close < candle.open;
    
    if (isBearish &&
        bodySize > (candle.close * minBlockSize / 100) &&
        volumeRatio > volumeThreshold &&
        (upperWick > bodySize * 0.2 || bodySize > candle.close * 0.5 / 100) && // More lenient wick requirement
        next.close < candle.high) { // Price moved down from the high (more lenient)
      
      const blockPrice = candle.high; // Resistance level at the high
      const strength = volumeRatio > 2.5 ? 'strong' : volumeRatio > 1.8 ? 'medium' : 'weak';
      
      blocks.push({
        price: blockPrice,
        high: candle.high,
        low: candle.low,
        time: candle.time as number,
        type: 'bearish',
        strength,
        volume: bodySize,
      });
    }
  }

  // Remove duplicate/overlapping blocks (keep strongest)
  const filteredBlocks: OrderBlock[] = [];
  for (const block of blocks) {
    const isDuplicate = filteredBlocks.some(existing => {
      const priceDiff = Math.abs(block.price - existing.price) / block.price * 100;
      return priceDiff < 0.5 && block.type === existing.type; // Within 0.5% and same type
    });
    
    if (!isDuplicate) {
      filteredBlocks.push(block);
    }
  }

  // Sort by strength and recency, return top 10
  return filteredBlocks
    .sort((a, b) => {
      // Prioritize stronger blocks
      const strengthOrder = { strong: 3, medium: 2, weak: 1 };
      if (strengthOrder[b.strength] !== strengthOrder[a.strength]) {
        return strengthOrder[b.strength] - strengthOrder[a.strength];
      }
      // Then by recency (newer first)
      return (b.time as number) - (a.time as number);
    })
    .slice(0, 10);
}

/**
 * Find active order blocks (those that haven't been broken)
 */
export function getActiveOrderBlocks(
  blocks: OrderBlock[],
  currentPrice: number
): {
  bullish: OrderBlock[]; // Support blocks below current price
  bearish: OrderBlock[]; // Resistance blocks above current price
} {
  // For bullish blocks: price (low) should be below current price, and high should not be broken
  const bullish = blocks
    .filter(b => {
      if (b.type !== 'bullish') return false;
      // Block is active if current price is above the block's low (support not broken)
      return b.low < currentPrice;
    })
    .sort((a, b) => b.low - a.low); // Closest to price first (highest low first)
  
  // For bearish blocks: price (high) should be above current price, and low should not be broken
  const bearish = blocks
    .filter(b => {
      if (b.type !== 'bearish') return false;
      // Block is active if current price is below the block's high (resistance not broken)
      return b.high > currentPrice;
    })
    .sort((a, b) => a.high - b.high); // Closest to price first (lowest high first)

  return { bullish, bearish };
}

