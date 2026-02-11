import type { CandlestickData } from "lightweight-charts";
import type { IndicatorSnapshot } from "./indicators";
import type { PriceActionAnalysis } from "./price-action";
import type { TradeSetup } from "./trade-entries";
import { calculateIndicatorSnapshot } from "./indicators";
import { analyzePriceAction } from "./price-action";

// ─── Types ──────────────────────────────────────────────────────────────────

export type StrategyId =
  | 'mean-reversion'
  | 'momentum'
  | 'breakout'
  | 'trend-following'
  | 'scalp';

export type QuantSignal = {
  strategy: StrategyId;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  strength: number; // 0-100
  reasons: string[];
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  timestamp: number;
};

export type StrategyWeight = {
  id: StrategyId;
  name: string;
  weight: number; // 0-1
  enabled: boolean;
};

export type CompositeScore = {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  score: number; // -100 to +100 (negative = SHORT, positive = LONG)
  confidence: number; // 0-100
  signals: QuantSignal[];
  breakdown: {
    indicators: number; // -100 to +100
    priceAction: number;
    momentum: number;
    volatility: number;
    trend: number;
  };
  riskMetrics: {
    kellyFraction: number; // optimal bet size (0-1)
    positionSizePct: number; // recommended position size as % of capital
    maxLoss: number; // max loss in % of capital
    volatilityRegime: 'low' | 'normal' | 'high' | 'extreme';
  };
};

export type QuantState = {
  indicators: IndicatorSnapshot | null;
  priceAction: PriceActionAnalysis | null;
  composite: CompositeScore | null;
  signals: QuantSignal[];
  strategyWeights: StrategyWeight[];
  isAutoTrading: boolean;
  lastUpdate: number;
  performance: StrategyPerformance;
};

export type StrategyPerformance = {
  totalTrades: number;
  winRate: number;
  avgRR: number;
  sharpeRatio: number;
  maxDrawdown: number;
  profitFactor: number;
  expectancy: number;
};

// ─── Default Strategy Weights ────────────────────────────────────────────────

export const DEFAULT_STRATEGY_WEIGHTS: StrategyWeight[] = [
  { id: 'trend-following', name: 'Trend Following', weight: 0.30, enabled: true },
  { id: 'momentum', name: 'Momentum', weight: 0.25, enabled: true },
  { id: 'mean-reversion', name: 'Mean Reversion', weight: 0.20, enabled: true },
  { id: 'breakout', name: 'Breakout', weight: 0.15, enabled: true },
  { id: 'scalp', name: 'Scalp', weight: 0.10, enabled: true },
];

// ─── Strategy Implementations ────────────────────────────────────────────────

/**
 * Mean Reversion Strategy
 * Looks for overextended moves that are likely to revert
 */
function meanReversionStrategy(
  candles: CandlestickData[],
  indicators: IndicatorSnapshot,
  pa: PriceActionAnalysis
): QuantSignal | null {
  const currentPrice = candles[candles.length - 1].close;
  const time = candles[candles.length - 1].time as number;
  let score = 0;
  const reasons: string[] = [];

  // RSI extremes
  if (indicators.rsi > 75) {
    score -= 30;
    reasons.push(`RSI overbought (${indicators.rsi.toFixed(1)})`);
  } else if (indicators.rsi < 25) {
    score += 30;
    reasons.push(`RSI oversold (${indicators.rsi.toFixed(1)})`);
  } else if (indicators.rsi > 65) {
    score -= 15;
    reasons.push(`RSI elevated (${indicators.rsi.toFixed(1)})`);
  } else if (indicators.rsi < 35) {
    score += 15;
    reasons.push(`RSI depressed (${indicators.rsi.toFixed(1)})`);
  }

  // Bollinger Band extremes
  if (indicators.bollingerBands.percentB > 1) {
    score -= 25;
    reasons.push('Price above upper Bollinger Band');
  } else if (indicators.bollingerBands.percentB < 0) {
    score += 25;
    reasons.push('Price below lower Bollinger Band');
  } else if (indicators.bollingerBands.percentB > 0.85) {
    score -= 12;
    reasons.push('Price near upper BB');
  } else if (indicators.bollingerBands.percentB < 0.15) {
    score += 12;
    reasons.push('Price near lower BB');
  }

  // StochRSI extremes
  if (indicators.stochRSI.k > 80 && indicators.stochRSI.k < indicators.stochRSI.d) {
    score -= 15;
    reasons.push('StochRSI bearish cross in overbought');
  } else if (indicators.stochRSI.k < 20 && indicators.stochRSI.k > indicators.stochRSI.d) {
    score += 15;
    reasons.push('StochRSI bullish cross in oversold');
  }

  // CCI extreme
  if (indicators.cci > 200) {
    score -= 15;
    reasons.push(`CCI extremely overbought (${indicators.cci.toFixed(0)})`);
  } else if (indicators.cci < -200) {
    score += 15;
    reasons.push(`CCI extremely oversold (${indicators.cci.toFixed(0)})`);
  }

  // Distance from VWAP
  if (indicators.priceVsVwap > 2) {
    score -= 10;
    reasons.push(`Price ${indicators.priceVsVwap.toFixed(1)}% above VWAP`);
  } else if (indicators.priceVsVwap < -2) {
    score += 10;
    reasons.push(`Price ${Math.abs(indicators.priceVsVwap).toFixed(1)}% below VWAP`);
  }

  if (Math.abs(score) < 20) return null;

  const direction: 'LONG' | 'SHORT' = score > 0 ? 'LONG' : 'SHORT';
  const strength = Math.min(100, Math.abs(score));

  // Calculate entry, SL, TP using BB
  const entry = currentPrice;
  const stopLoss = direction === 'LONG'
    ? indicators.bollingerBands.lower - indicators.atr * 0.5
    : indicators.bollingerBands.upper + indicators.atr * 0.5;
  const takeProfit = direction === 'LONG'
    ? indicators.bollingerBands.middle + (indicators.bollingerBands.middle - indicators.bollingerBands.lower) * 0.5
    : indicators.bollingerBands.middle - (indicators.bollingerBands.upper - indicators.bollingerBands.middle) * 0.5;

  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);
  const rr = risk > 0 ? reward / risk : 0;

  return {
    strategy: 'mean-reversion',
    direction,
    strength,
    reasons,
    entry,
    stopLoss,
    takeProfit,
    riskReward: rr,
    timestamp: time,
  };
}

/**
 * Momentum Strategy
 * Follows strong directional moves
 */
function momentumStrategy(
  candles: CandlestickData[],
  indicators: IndicatorSnapshot,
  pa: PriceActionAnalysis
): QuantSignal | null {
  const currentPrice = candles[candles.length - 1].close;
  const time = candles[candles.length - 1].time as number;
  let score = 0;
  const reasons: string[] = [];

  // MACD momentum
  if (indicators.macd.histogram > 0 && indicators.macd.value > indicators.macd.signal) {
    score += 20;
    reasons.push('MACD bullish momentum');
    if (indicators.macd.histogram > Math.abs(indicators.macd.signal) * 0.5) {
      score += 10;
      reasons.push('Strong MACD histogram');
    }
  } else if (indicators.macd.histogram < 0 && indicators.macd.value < indicators.macd.signal) {
    score -= 20;
    reasons.push('MACD bearish momentum');
    if (Math.abs(indicators.macd.histogram) > Math.abs(indicators.macd.signal) * 0.5) {
      score -= 10;
      reasons.push('Strong bearish MACD histogram');
    }
  }

  // ROC (Rate of Change)
  if (indicators.roc > 2) {
    score += 15;
    reasons.push(`Strong upward ROC (${indicators.roc.toFixed(1)}%)`);
  } else if (indicators.roc < -2) {
    score -= 15;
    reasons.push(`Strong downward ROC (${indicators.roc.toFixed(1)}%)`);
  }

  // ADX trend strength
  if (!isNaN(indicators.adx.value) && indicators.adx.value > 25) {
    if (indicators.adx.plusDI > indicators.adx.minusDI) {
      score += 15;
      reasons.push(`Strong bullish trend (ADX ${indicators.adx.value.toFixed(0)})`);
    } else {
      score -= 15;
      reasons.push(`Strong bearish trend (ADX ${indicators.adx.value.toFixed(0)})`);
    }
  }

  // OBV confirmation
  if (indicators.obvTrend === 'rising' && score > 0) {
    score += 10;
    reasons.push('OBV confirms bullish momentum');
  } else if (indicators.obvTrend === 'falling' && score < 0) {
    score += 10; // Adds to absolute conviction
    reasons.push('OBV confirms bearish momentum');
  }

  // RSI momentum (mid-range, not extreme)
  if (indicators.rsi > 50 && indicators.rsi < 70) {
    score += 5;
    reasons.push('RSI in bullish zone');
  } else if (indicators.rsi < 50 && indicators.rsi > 30) {
    score -= 5;
    reasons.push('RSI in bearish zone');
  }

  // Price action displacements
  const recentDisp = pa.displacements.filter(d => d.endIndex >= candles.length - 5);
  for (const d of recentDisp) {
    if (d.direction === 'bullish' && d.strength !== 'weak') {
      score += 15;
      reasons.push(`Bullish displacement (${d.sizePct.toFixed(1)}%)`);
    } else if (d.direction === 'bearish' && d.strength !== 'weak') {
      score -= 15;
      reasons.push(`Bearish displacement (${d.sizePct.toFixed(1)}%)`);
    }
  }

  if (Math.abs(score) < 20) return null;

  const direction: 'LONG' | 'SHORT' = score > 0 ? 'LONG' : 'SHORT';
  const strength = Math.min(100, Math.abs(score));

  const entry = currentPrice;
  const stopLoss = direction === 'LONG'
    ? entry - indicators.atr * 2
    : entry + indicators.atr * 2;
  const takeProfit = direction === 'LONG'
    ? entry + indicators.atr * 4
    : entry - indicators.atr * 4;

  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);

  return {
    strategy: 'momentum',
    direction,
    strength,
    reasons,
    entry,
    stopLoss,
    takeProfit,
    riskReward: risk > 0 ? reward / risk : 0,
    timestamp: time,
  };
}

/**
 * Breakout Strategy
 * Detects and trades breakouts from consolidation
 */
function breakoutStrategy(
  candles: CandlestickData[],
  indicators: IndicatorSnapshot,
  pa: PriceActionAnalysis
): QuantSignal | null {
  const currentPrice = candles[candles.length - 1].close;
  const time = candles[candles.length - 1].time as number;
  let score = 0;
  const reasons: string[] = [];

  // BB squeeze (low bandwidth = consolidation)
  const isSqueezing = indicators.bollingerBands.bandwidth < 2;

  // Recent BOS (Break of Structure)
  const recentBOS = pa.structureBreaks.filter(
    b => b.type === 'BOS' && b.index >= candles.length - 5
  );

  for (const bos of recentBOS) {
    if (bos.direction === 'bullish') {
      score += bos.strength === 'strong' ? 30 : bos.strength === 'medium' ? 20 : 10;
      reasons.push(`Bullish BOS at ${bos.brokenLevel.toFixed(2)} (${bos.strength})`);
    } else {
      score -= bos.strength === 'strong' ? 30 : bos.strength === 'medium' ? 20 : 10;
      reasons.push(`Bearish BOS at ${bos.brokenLevel.toFixed(2)} (${bos.strength})`);
    }
  }

  // CHoCH (Change of Character) — potential reversal breakout
  const recentCHoCH = pa.structureBreaks.filter(
    b => b.type === 'CHoCH' && b.index >= candles.length - 5
  );
  for (const choch of recentCHoCH) {
    if (choch.direction === 'bullish') {
      score += 25;
      reasons.push(`Bullish CHoCH at ${choch.brokenLevel.toFixed(2)}`);
    } else {
      score -= 25;
      reasons.push(`Bearish CHoCH at ${choch.brokenLevel.toFixed(2)}`);
    }
  }

  // Squeeze release bonus
  if (isSqueezing && Math.abs(score) > 15) {
    score = score > 0 ? score + 15 : score - 15;
    reasons.push('BB squeeze breakout potential');
  }

  // ADX rising = strengthening trend = breakout confirmation
  if (!isNaN(indicators.adx.value) && indicators.adx.value > 20) {
    if (score > 0 && indicators.adx.plusDI > indicators.adx.minusDI) {
      score += 10;
      reasons.push('ADX confirms bullish breakout');
    } else if (score < 0 && indicators.adx.minusDI > indicators.adx.plusDI) {
      score += 10; // absolute conviction
      reasons.push('ADX confirms bearish breakout');
    }
  }

  // EMA alignment for breakout direction
  if (indicators.ema9 > indicators.ema21 && indicators.ema21 > indicators.ema50 && score > 0) {
    score += 10;
    reasons.push('EMAs aligned bullish (9 > 21 > 50)');
  } else if (indicators.ema9 < indicators.ema21 && indicators.ema21 < indicators.ema50 && score < 0) {
    score += 10;
    reasons.push('EMAs aligned bearish (9 < 21 < 50)');
  }

  if (Math.abs(score) < 20) return null;

  const direction: 'LONG' | 'SHORT' = score > 0 ? 'LONG' : 'SHORT';
  const strength = Math.min(100, Math.abs(score));

  const entry = currentPrice;
  const stopLoss = direction === 'LONG'
    ? entry - indicators.atr * 1.5
    : entry + indicators.atr * 1.5;
  const takeProfit = direction === 'LONG'
    ? entry + indicators.atr * 3
    : entry - indicators.atr * 3;

  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);

  return {
    strategy: 'breakout',
    direction,
    strength,
    reasons,
    entry,
    stopLoss,
    takeProfit,
    riskReward: risk > 0 ? reward / risk : 0,
    timestamp: time,
  };
}

/**
 * Trend Following Strategy
 * Trades with the established trend direction
 */
function trendFollowingStrategy(
  candles: CandlestickData[],
  indicators: IndicatorSnapshot,
  pa: PriceActionAnalysis
): QuantSignal | null {
  const currentPrice = candles[candles.length - 1].close;
  const time = candles[candles.length - 1].time as number;
  let score = 0;
  const reasons: string[] = [];

  // EMA Stack
  if (currentPrice > indicators.ema9 && indicators.ema9 > indicators.ema21 && indicators.ema21 > indicators.ema50) {
    score += 25;
    reasons.push('Price above EMA stack (9 > 21 > 50)');
    if (indicators.ema50 > indicators.ema200) {
      score += 10;
      reasons.push('Above EMA200 — strong bullish structure');
    }
  } else if (currentPrice < indicators.ema9 && indicators.ema9 < indicators.ema21 && indicators.ema21 < indicators.ema50) {
    score -= 25;
    reasons.push('Price below EMA stack (9 < 21 < 50)');
    if (indicators.ema50 < indicators.ema200) {
      score -= 10;
      reasons.push('Below EMA200 — strong bearish structure');
    }
  }

  // Price action trend
  if (pa.trend === 'bullish') {
    score += 15;
    reasons.push(`PA trend: bullish (${pa.trendStrength.toFixed(0)}%)`);
  } else if (pa.trend === 'bearish') {
    score -= 15;
    reasons.push(`PA trend: bearish (${pa.trendStrength.toFixed(0)}%)`);
  }

  // Market phase alignment
  if (pa.marketPhase === 'markup') {
    score += 10;
    reasons.push('Market phase: markup');
  } else if (pa.marketPhase === 'markdown') {
    score -= 10;
    reasons.push('Market phase: markdown');
  } else if (pa.marketPhase === 'accumulation') {
    score += 5;
    reasons.push('Market phase: accumulation (potential upside)');
  } else if (pa.marketPhase === 'distribution') {
    score -= 5;
    reasons.push('Market phase: distribution (potential downside)');
  }

  // MACD trend confirmation
  if (indicators.macd.value > 0 && indicators.macd.histogram > 0) {
    score += 10;
    reasons.push('MACD positive & rising');
  } else if (indicators.macd.value < 0 && indicators.macd.histogram < 0) {
    score -= 10;
    reasons.push('MACD negative & falling');
  }

  // Price vs VWAP
  if (indicators.priceVsVwap > 0.5 && score > 0) {
    score += 5;
    reasons.push('Price above VWAP');
  } else if (indicators.priceVsVwap < -0.5 && score < 0) {
    score += 5;
    reasons.push('Price below VWAP');
  }

  if (Math.abs(score) < 20) return null;

  const direction: 'LONG' | 'SHORT' = score > 0 ? 'LONG' : 'SHORT';
  const strength = Math.min(100, Math.abs(score));

  // Trend following uses wider stops
  const entry = currentPrice;
  const stopLoss = direction === 'LONG'
    ? Math.min(entry - indicators.atr * 2.5, indicators.ema50)
    : Math.max(entry + indicators.atr * 2.5, indicators.ema50);
  const takeProfit = direction === 'LONG'
    ? entry + indicators.atr * 5
    : entry - indicators.atr * 5;

  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);

  return {
    strategy: 'trend-following',
    direction,
    strength,
    reasons,
    entry,
    stopLoss,
    takeProfit,
    riskReward: risk > 0 ? reward / risk : 0,
    timestamp: time,
  };
}

/**
 * Scalp Strategy
 * Quick trades based on short-term signals
 */
function scalpStrategy(
  candles: CandlestickData[],
  indicators: IndicatorSnapshot,
  pa: PriceActionAnalysis
): QuantSignal | null {
  const currentPrice = candles[candles.length - 1].close;
  const time = candles[candles.length - 1].time as number;
  let score = 0;
  const reasons: string[] = [];

  // EMA 9/21 cross
  if (indicators.ema9 > indicators.ema21) {
    const crossStrength = ((indicators.ema9 - indicators.ema21) / indicators.ema21) * 100;
    if (crossStrength < 0.5) { // Recent cross
      score += 20;
      reasons.push('EMA 9/21 bullish cross');
    }
  } else {
    const crossStrength = ((indicators.ema21 - indicators.ema9) / indicators.ema9) * 100;
    if (crossStrength < 0.5) {
      score -= 20;
      reasons.push('EMA 9/21 bearish cross');
    }
  }

  // StochRSI quick signals
  if (indicators.stochRSI.k < 20) {
    score += 15;
    reasons.push('StochRSI oversold');
  } else if (indicators.stochRSI.k > 80) {
    score -= 15;
    reasons.push('StochRSI overbought');
  }

  // Recent liquidity sweeps (great scalp setups)
  const recentSweeps = pa.liquiditySweeps.filter(
    s => s.index >= candles.length - 3 && s.recovered
  );
  for (const sweep of recentSweeps) {
    if (sweep.type === 'sell-side') {
      score += 20;
      reasons.push('Sell-side sweep + recovery');
    } else {
      score -= 20;
      reasons.push('Buy-side sweep + recovery');
    }
  }

  // FVG nearby (price magnet)
  const nearbyFVGs = pa.fairValueGaps.filter(
    g => !g.filled && Math.abs(g.midpoint - currentPrice) / currentPrice < 0.005
  );
  for (const fvg of nearbyFVGs) {
    if (fvg.type === 'bullish' && fvg.midpoint < currentPrice) {
      score += 10;
      reasons.push('Bullish FVG support nearby');
    } else if (fvg.type === 'bearish' && fvg.midpoint > currentPrice) {
      score -= 10;
      reasons.push('Bearish FVG resistance nearby');
    }
  }

  if (Math.abs(score) < 20) return null;

  const direction: 'LONG' | 'SHORT' = score > 0 ? 'LONG' : 'SHORT';
  const strength = Math.min(100, Math.abs(score));

  // Scalp = tight SL/TP
  const entry = currentPrice;
  const stopLoss = direction === 'LONG'
    ? entry - indicators.atr * 1
    : entry + indicators.atr * 1;
  const takeProfit = direction === 'LONG'
    ? entry + indicators.atr * 1.5
    : entry - indicators.atr * 1.5;

  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);

  return {
    strategy: 'scalp',
    direction,
    strength,
    reasons,
    entry,
    stopLoss,
    takeProfit,
    riskReward: risk > 0 ? reward / risk : 0,
    timestamp: time,
  };
}

// ─── Composite Score Calculator ──────────────────────────────────────────────

/**
 * Calculate the composite quant score from all strategies and indicators
 */
export function calculateCompositeScore(
  candles: CandlestickData[],
  strategyWeights: StrategyWeight[] = DEFAULT_STRATEGY_WEIGHTS
): CompositeScore | null {
  if (candles.length < 50) return null;

  const indicators = calculateIndicatorSnapshot(candles);
  if (!indicators) return null;

  const pa = analyzePriceAction(candles, {
    swingLeftBars: 3,
    swingRightBars: 3,
    fvgMinGapPct: 0.03,
    equalLevelTolerance: 0.12,
    displacementMinPct: 0.4,
  });

  const currentPrice = candles[candles.length - 1].close;

  // Run each strategy
  const strategyFns: Record<StrategyId, (c: CandlestickData[], i: IndicatorSnapshot, p: PriceActionAnalysis) => QuantSignal | null> = {
    'mean-reversion': meanReversionStrategy,
    'momentum': momentumStrategy,
    'breakout': breakoutStrategy,
    'trend-following': trendFollowingStrategy,
    'scalp': scalpStrategy,
  };

  const signals: QuantSignal[] = [];
  let weightedScore = 0;
  let totalWeight = 0;

  for (const sw of strategyWeights) {
    if (!sw.enabled) continue;
    const fn = strategyFns[sw.id];
    if (!fn) continue;

    const signal = fn(candles, indicators, pa);
    if (signal) {
      signals.push(signal);
      const dirSign = signal.direction === 'LONG' ? 1 : signal.direction === 'SHORT' ? -1 : 0;
      weightedScore += dirSign * signal.strength * sw.weight;
      totalWeight += sw.weight;
    } else {
      totalWeight += sw.weight * 0.3; // Neutral signal still counts partially
    }
  }

  // Normalize score to -100..+100
  const normalizedScore = totalWeight > 0 ? (weightedScore / totalWeight) : 0;

  // ── Breakdown Calculation ──
  // Indicators sub-score
  let indicatorScore = 0;
  if (indicators.rsi > 50) indicatorScore += (indicators.rsi - 50) * 0.5;
  else indicatorScore -= (50 - indicators.rsi) * 0.5;
  if (indicators.macd.histogram > 0) indicatorScore += 10;
  else indicatorScore -= 10;
  if (indicators.cci > 0) indicatorScore += Math.min(15, indicators.cci / 10);
  else indicatorScore -= Math.min(15, Math.abs(indicators.cci) / 10);

  // Price action sub-score
  let priceActionScore = 0;
  if (pa.trend === 'bullish') priceActionScore += 20 * (pa.trendStrength / 100);
  else if (pa.trend === 'bearish') priceActionScore -= 20 * (pa.trendStrength / 100);
  const recentSignals = pa.signals.slice(0, 5);
  for (const sig of recentSignals) {
    if (sig.type === 'BUY') priceActionScore += sig.confidence * 0.15;
    else if (sig.type === 'SELL') priceActionScore -= sig.confidence * 0.15;
  }

  // Momentum sub-score
  let momentumScore = 0;
  momentumScore += indicators.roc * 2;
  if (indicators.macd.histogram > 0) momentumScore += 15;
  else momentumScore -= 15;

  // Volatility sub-score
  let volatilityScore = 0;
  if (indicators.bollingerBands.bandwidth > 5) volatilityScore -= 10; // High vol = caution
  else if (indicators.bollingerBands.bandwidth < 1.5) volatilityScore += 5; // Low vol = squeeze potential

  // Trend sub-score
  let trendScore = 0;
  if (currentPrice > indicators.ema50) trendScore += 20;
  else trendScore -= 20;
  if (indicators.ema9 > indicators.ema21) trendScore += 15;
  else trendScore -= 15;

  const clamp = (v: number) => Math.max(-100, Math.min(100, v));

  // ── Determine Direction ──
  const direction: 'LONG' | 'SHORT' | 'NEUTRAL' =
    normalizedScore > 15 ? 'LONG' :
    normalizedScore < -15 ? 'SHORT' :
    'NEUTRAL';

  const confidence = Math.min(100, Math.abs(normalizedScore));

  // ── Risk Metrics ──
  // Volatility regime
  const volatilityRegime: 'low' | 'normal' | 'high' | 'extreme' =
    indicators.atrPct < 0.5 ? 'low' :
    indicators.atrPct < 1.5 ? 'normal' :
    indicators.atrPct < 3 ? 'high' : 'extreme';

  // Kelly Criterion (simplified)
  // f = (bp - q) / b, where b = avg win/avg loss, p = win probability, q = 1-p
  const winProb = 0.5 + (confidence / 200); // Rough: confidence maps to edge
  const avgRR = signals.length > 0
    ? signals.reduce((s, sig) => s + sig.riskReward, 0) / signals.length
    : 1.5;
  const kellyFraction = Math.max(0, Math.min(0.25, (avgRR * winProb - (1 - winProb)) / avgRR));

  // Position size (conservative: half-Kelly)
  const halfKelly = kellyFraction / 2;
  const volatilityAdjustment =
    volatilityRegime === 'low' ? 1.2 :
    volatilityRegime === 'normal' ? 1.0 :
    volatilityRegime === 'high' ? 0.6 :
    0.3;
  const positionSizePct = Math.max(0.5, Math.min(10, halfKelly * 100 * volatilityAdjustment));

  return {
    direction,
    score: clamp(normalizedScore),
    confidence,
    signals,
    breakdown: {
      indicators: clamp(indicatorScore),
      priceAction: clamp(priceActionScore),
      momentum: clamp(momentumScore),
      volatility: clamp(volatilityScore),
      trend: clamp(trendScore),
    },
    riskMetrics: {
      kellyFraction,
      positionSizePct,
      maxLoss: positionSizePct * 0.02, // 2% risk per trade
      volatilityRegime,
    },
  };
}

// ─── Full Quant Analysis ─────────────────────────────────────────────────────

export function runQuantAnalysis(
  candles: CandlestickData[],
  strategyWeights: StrategyWeight[] = DEFAULT_STRATEGY_WEIGHTS
): QuantState {
  const indicators = calculateIndicatorSnapshot(candles);
  const pa = candles.length >= 15 ? analyzePriceAction(candles) : null;
  const composite = calculateCompositeScore(candles, strategyWeights);

  return {
    indicators,
    priceAction: pa,
    composite,
    signals: composite?.signals ?? [],
    strategyWeights,
    isAutoTrading: false,
    lastUpdate: Date.now(),
    performance: {
      totalTrades: 0,
      winRate: 0,
      avgRR: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      profitFactor: 0,
      expectancy: 0,
    },
  };
}

