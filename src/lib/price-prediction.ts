import type { OrderBook } from "./orderbook";
import type { SupportResistanceLevel } from "./orderbook";

export type PricePrediction = {
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  confidence: number; // 0-100
  targetPrice?: number;
  stopLoss?: number;
  reasoning: string[];
  factors: {
    orderBookImbalance: number; // -100 to +100 (negative = SELL stronger, positive = BUY stronger)
    distanceToSupport: number; // percentage distance to nearest support
    distanceToResistance: number; // percentage distance to nearest resistance
    supportStrength: number; // 0-100, strength of nearest support
    resistanceStrength: number; // 0-100, strength of nearest resistance
    imbalanceTrend: 'increasing' | 'decreasing' | 'stable'; // trend of BUY/SELL imbalance
    nearestSupport?: {
      price: number;
      distance: number;
      strength: 'weak' | 'medium' | 'strong';
    } | null;
    nearestResistance?: {
      price: number;
      distance: number;
      strength: 'weak' | 'medium' | 'strong';
    } | null;
  };
};

/**
 * Calculate price distance to nearest support/resistance level
 */
export function calculateDistanceToLevel(
  currentPrice: number,
  level: SupportResistanceLevel
): { distance: number; distancePct: number } {
  const distance = Math.abs(currentPrice - level.price);
  const distancePct = (distance / currentPrice) * 100;
  return { distance, distancePct };
}

/**
 * Find nearest support and resistance levels
 */
export function findNearestLevels(
  currentPrice: number,
  support: SupportResistanceLevel[],
  resistance: SupportResistanceLevel[]
): {
  nearestSupport: SupportResistanceLevel | null;
  nearestResistance: SupportResistanceLevel | null;
  supportDistance: number;
  resistanceDistance: number;
} {
  // Find nearest support (below current price)
  const supportsBelow = support.filter(s => s.price < currentPrice);
  const nearestSupport = supportsBelow.length > 0
    ? supportsBelow.reduce((nearest, current) => 
        currentPrice - current.price < currentPrice - nearest.price ? current : nearest
      )
    : null;

  // Find nearest resistance (above current price)
  const resistancesAbove = resistance.filter(r => r.price > currentPrice);
  const nearestResistance = resistancesAbove.length > 0
    ? resistancesAbove.reduce((nearest, current) => 
        current.price - currentPrice < nearest.price - currentPrice ? current : nearest
      )
    : null;

  const supportDistance = nearestSupport 
    ? calculateDistanceToLevel(currentPrice, nearestSupport).distancePct 
    : Infinity;
  const resistanceDistance = nearestResistance 
    ? calculateDistanceToLevel(currentPrice, nearestResistance).distancePct 
    : Infinity;

  return {
    nearestSupport,
    nearestResistance,
    supportDistance,
    resistanceDistance,
  };
}

/**
 * Calculate order book imbalance score
 * Returns -100 to +100 where positive = BUY stronger, negative = SELL stronger
 */
export function calculateOrderBookImbalance(
  book: OrderBook,
  topN: number = 20
): number {
  const bids = book.bids.slice(0, topN);
  const asks = book.asks.slice(0, topN);
  
  const totalBidVolume = bids.reduce((sum, level) => sum + (level.size * level.price), 0);
  const totalAskVolume = asks.reduce((sum, level) => sum + (level.size * level.price), 0);
  const totalVolume = totalBidVolume + totalAskVolume;
  
  if (totalVolume === 0) return 0;
  
  const bidPercentage = (totalBidVolume / totalVolume) * 100;
  const askPercentage = (totalAskVolume / totalVolume) * 100;
  
  // Return imbalance: positive = BUY stronger, negative = SELL stronger
  return bidPercentage - askPercentage;
}

/**
 * Convert strength level to numeric score (0-100)
 */
function strengthToScore(strength: 'weak' | 'medium' | 'strong'): number {
  switch (strength) {
    case 'strong': return 100;
    case 'medium': return 60;
    case 'weak': return 30;
    default: return 0;
  }
}

/**
 * Predict price direction based on order book analysis
 */
export function predictPriceFromOrderBook(
  currentPrice: number,
  book: OrderBook,
  support: SupportResistanceLevel[],
  resistance: SupportResistanceLevel[],
  previousImbalance?: number
): PricePrediction {
  // Calculate order book imbalance
  const imbalance = calculateOrderBookImbalance(book);
  
  // Determine imbalance trend
  let imbalanceTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';
  if (previousImbalance !== undefined) {
    if (imbalance > previousImbalance + 2) imbalanceTrend = 'increasing';
    else if (imbalance < previousImbalance - 2) imbalanceTrend = 'decreasing';
  }
  
  // Find nearest levels
  const { nearestSupport, nearestResistance, supportDistance, resistanceDistance } = 
    findNearestLevels(currentPrice, support, resistance);
  
  const supportStrength = nearestSupport ? strengthToScore(nearestSupport.strength) : 0;
  const resistanceStrength = nearestResistance ? strengthToScore(nearestResistance.strength) : 0;
  
  // Calculate prediction factors
  const factors = {
    orderBookImbalance: imbalance,
    distanceToSupport: supportDistance,
    distanceToResistance: resistanceDistance,
    supportStrength,
    resistanceStrength,
    imbalanceTrend,
  };
  
  // Build reasoning
  const reasoning: string[] = [];
  let direction: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
  let confidence = 0;
  let targetPrice: number | undefined;
  let stopLoss: number | undefined;
  
  // Factor 1: Order book imbalance (40% weight)
  const imbalanceScore = Math.abs(imbalance);
  const imbalanceWeight = 0.4;
  if (imbalance > 10) {
    reasoning.push(`Strong BUY pressure (${imbalance.toFixed(1)}% imbalance)`);
    direction = 'UP';
    confidence += imbalanceScore * imbalanceWeight;
  } else if (imbalance < -10) {
    reasoning.push(`Strong SELL pressure (${Math.abs(imbalance).toFixed(1)}% imbalance)`);
    direction = 'DOWN';
    confidence += imbalanceScore * imbalanceWeight;
  } else {
    reasoning.push(`Balanced order book (${imbalance.toFixed(1)}% imbalance)`);
  }
  
  // Factor 2: Proximity to support/resistance (30% weight)
  const proximityWeight = 0.3;
  if (nearestSupport && supportDistance < 1 && supportStrength > 50) {
    reasoning.push(`Near strong support at ${nearestSupport.price.toFixed(2)} (${supportDistance.toFixed(2)}% away)`);
    if (direction === 'DOWN') {
      // Near support + selling pressure = potential bounce
      direction = 'UP';
      confidence += (100 - supportDistance * 50) * proximityWeight;
      targetPrice = nearestResistance?.price;
      stopLoss = nearestSupport.price * 0.999;
    }
  } else if (nearestResistance && resistanceDistance < 1 && resistanceStrength > 50) {
    reasoning.push(`Near strong resistance at ${nearestResistance.price.toFixed(2)} (${resistanceDistance.toFixed(2)}% away)`);
    if (direction === 'UP') {
      // Near resistance + buying pressure = potential rejection
      direction = 'DOWN';
      confidence += (100 - resistanceDistance * 50) * proximityWeight;
      targetPrice = nearestSupport?.price;
      stopLoss = nearestResistance.price * 1.001;
    }
  }
  
  // Factor 3: Imbalance trend (20% weight)
  const trendWeight = 0.2;
  if (imbalanceTrend === 'increasing' && imbalance > 0) {
    reasoning.push('BUY pressure is increasing');
    if (direction === 'UP') confidence += 30 * trendWeight;
  } else if (imbalanceTrend === 'increasing' && imbalance < 0) {
    reasoning.push('SELL pressure is increasing');
    if (direction === 'DOWN') confidence += 30 * trendWeight;
  }
  
  // Factor 4: Support/Resistance strength (10% weight)
  const strengthWeight = 0.1;
  if (direction === 'UP' && supportStrength > 60) {
    reasoning.push(`Strong support level provides price floor`);
    confidence += supportStrength * strengthWeight;
    if (!targetPrice && nearestResistance) targetPrice = nearestResistance.price;
    if (!stopLoss && nearestSupport) stopLoss = nearestSupport.price * 0.999;
  } else if (direction === 'DOWN' && resistanceStrength > 60) {
    reasoning.push(`Strong resistance level provides price ceiling`);
    confidence += resistanceStrength * strengthWeight;
    if (!targetPrice && nearestSupport) targetPrice = nearestSupport.price;
    if (!stopLoss && nearestResistance) stopLoss = nearestResistance.price * 1.001;
  }
  
  // Cap confidence at 100
  confidence = Math.min(100, Math.max(0, confidence));
  
  // If confidence is too low, mark as neutral
  if (confidence < 30) {
    direction = 'NEUTRAL';
    reasoning.push('Insufficient signals for clear direction');
  }
  
  return {
    direction,
    confidence: Math.round(confidence),
    targetPrice,
    stopLoss,
    reasoning,
    factors,
  };
}

