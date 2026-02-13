import type { CandlestickData } from "lightweight-charts";
import { calculateIndicatorSnapshot, type IndicatorSnapshot } from "./indicators";
import { analyzePriceAction, type PriceActionAnalysis } from "./price-action";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ScalpSignal = {
  id: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  riskReward: number;
  strength: number; // 0-100 (signal quality)
  grade: 'A+' | 'A' | 'B' | 'C'; // signal grade
  strategy: string;
  reasons: string[];
  positionSize: PositionSizing;
  timestamp: number;
  status: 'active' | 'triggered' | 'expired' | 'won' | 'lost';
  confluenceCount: number; // how many indicators agree
};

export type PositionSizing = {
  capital: number;
  leverage: number;
  notionalSize: number; // capital × leverage
  contractSize: number; // notionalSize / entry price
  riskAmount: number; // dollar risk
  riskPct: number; // risk as % of capital
  rewardAmount: number; // dollar reward at TP1
  rewardPct: number;
};

export type DailyTradeLog = {
  id: string;
  signal: ScalpSignal;
  result: 'win' | 'loss' | 'breakeven' | 'pending';
  pnlDollar: number;
  pnlPct: number;
  exitPrice: number;
  tradeNum: number; // 1-15
  time: number;
};

export type ScalpSession = 'asian' | 'london' | 'us' | 'off-hours';

export type DailyStats = {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnlDollar: number;
  totalPnlPct: number;
  consecutiveLosses: number;
  maxTradesReached: boolean;
  maxLossReached: boolean;
  shouldStop: boolean;
  stopReason: string | null;
};

export type ScalpConfig = {
  capital: number;
  leverage: number;
  maxTradesPerDay: number;
  riskPerTradePct: number; // % of capital
  maxDailyLossPct: number; // % of capital
  maxConsecutiveLosses: number;
};

export const DEFAULT_SCALP_CONFIG: ScalpConfig = {
  capital: 200,
  leverage: 10,
  maxTradesPerDay: 14, // Optimized for 1m scalping
  riskPerTradePct: 1, // 1% = $2
  maxDailyLossPct: 5, // 5% = $10
  maxConsecutiveLosses: 3,
};

// ─── Session Detection ──────────────────────────────────────────────────────

export function getCurrentSession(): ScalpSession {
  const now = new Date();
  const utcHour = now.getUTCHours();

  // Asian: 00:00-07:00 UTC
  if (utcHour >= 0 && utcHour < 7) return 'asian';
  // London: 07:00-13:00 UTC
  if (utcHour >= 7 && utcHour < 13) return 'london';
  // US: 13:00-21:00 UTC
  if (utcHour >= 13 && utcHour < 21) return 'us';
  // Off-hours: 21:00-00:00 UTC
  return 'off-hours';
}

export function getSessionInfo(session: ScalpSession): {
  name: string;
  emoji: string;
  volatility: 'low' | 'medium' | 'high';
  bestStrategies: string[];
  color: string;
} {
  switch (session) {
    case 'asian':
      return {
        name: 'Asian Session',
        emoji: '🌏',
        volatility: 'low',
        bestStrategies: ['Mean Reversion', 'Scalp'],
        color: 'sky',
      };
    case 'london':
      return {
        name: 'London Session',
        emoji: '🇬🇧',
        volatility: 'high',
        bestStrategies: ['Breakout', 'Momentum', 'Scalp'],
        color: 'amber',
      };
    case 'us':
      return {
        name: 'US Session',
        emoji: '🇺🇸',
        volatility: 'high',
        bestStrategies: ['Trend Following', 'Momentum', 'Scalp'],
        color: 'indigo',
      };
    case 'off-hours':
      return {
        name: 'Off-Hours',
        emoji: '🌙',
        volatility: 'low',
        bestStrategies: ['Scalp'],
        color: 'zinc',
      };
  }
}

// ─── Position Sizing Calculator ─────────────────────────────────────────────

export function calculatePositionSize(
  entry: number,
  stopLoss: number,
  config: ScalpConfig
): PositionSizing {
  const riskAmount = config.capital * (config.riskPerTradePct / 100);
  const slDistance = Math.abs(entry - stopLoss);
  const slPct = (slDistance / entry) * 100;

  // Calculate leverage-adjusted position
  const notionalSize = config.capital * config.leverage;
  const contractSize = notionalSize / entry;

  // Actual risk = notionalSize × slPct
  const actualRisk = notionalSize * (slPct / 100);

  // Adjust position size to match desired risk
  let adjustedNotional = notionalSize;
  if (actualRisk > riskAmount && slPct > 0) {
    adjustedNotional = (riskAmount / slPct) * 100;
  }

  const adjustedContract = adjustedNotional / entry;
  const actualRiskAmount = adjustedNotional * (slPct / 100);

  return {
    capital: config.capital,
    leverage: config.leverage,
    notionalSize: adjustedNotional,
    contractSize: adjustedContract,
    riskAmount: actualRiskAmount,
    riskPct: (actualRiskAmount / config.capital) * 100,
    rewardAmount: 0, // Set by caller
    rewardPct: 0,
  };
}

// ─── Scalp Signal Generator ─────────────────────────────────────────────────

export function generateScalpSignals(
  candles: CandlestickData[],
  config: ScalpConfig = DEFAULT_SCALP_CONFIG
): ScalpSignal[] {
  if (candles.length < 50) return [];

  const indicators = calculateIndicatorSnapshot(candles);
  if (!indicators) return [];

  let pa: PriceActionAnalysis | null = null;
  try {
    pa = analyzePriceAction(candles, {
      swingLeftBars: 3,
      swingRightBars: 3,
      fvgMinGapPct: 0.03,
      equalLevelTolerance: 0.12,
      displacementMinPct: 0.4,
    });
  } catch {
    // Price action analysis may fail with insufficient data
  }

  const signals: ScalpSignal[] = [];
  const currentPrice = candles[candles.length - 1].close;
  const time = (candles[candles.length - 1].time as number) * 1000 || Date.now();

  // ── Signal 1: EMA Cross Scalp ──
  const emaCrossSignal = generateEMACrossScalp(candles, indicators, config, time);
  if (emaCrossSignal) signals.push(emaCrossSignal);

  // ── Signal 2: RSI Extreme Bounce ──
  const rsiSignal = generateRSIBounce(candles, indicators, config, time);
  if (rsiSignal) signals.push(rsiSignal);

  // ── Signal 3: StochRSI Cross ──
  const stochSignal = generateStochRSICross(candles, indicators, config, time);
  if (stochSignal) signals.push(stochSignal);

  // ── Signal 4: Bollinger Band Bounce ──
  const bbSignal = generateBBBounce(candles, indicators, config, time);
  if (bbSignal) signals.push(bbSignal);

  // ── Signal 5: MACD Histogram Reversal ──
  const macdSignal = generateMACDScalp(candles, indicators, config, time);
  if (macdSignal) signals.push(macdSignal);

  // ── Signal 6: Liquidity Sweep (if PA available) ──
  if (pa) {
    const sweepSignal = generateLiquiditySweepScalp(candles, indicators, pa, config, time);
    if (sweepSignal) signals.push(sweepSignal);
  }

  // ── Signal 7: FVG Fill (if PA available) ──
  if (pa) {
    const fvgSignal = generateFVGScalp(candles, indicators, pa, config, time);
    if (fvgSignal) signals.push(fvgSignal);
  }

  // ── Signal 8: Confluence Composite ──
  const compositeSignal = generateCompositeScalp(candles, indicators, pa, config, time);
  if (compositeSignal) signals.push(compositeSignal);

  // Sort by strength (best first)
  signals.sort((a, b) => b.strength - a.strength);

  return signals;
}

// ── Signal Generators ───────────────────────────────────────────────────────

function generateEMACrossScalp(
  candles: CandlestickData[],
  ind: IndicatorSnapshot,
  config: ScalpConfig,
  time: number
): ScalpSignal | null {
  const price = candles[candles.length - 1].close;
  const reasons: string[] = [];
  let direction: 'LONG' | 'SHORT' | null = null;
  let confluence = 0;

  // EMA 9/21 recent cross - more sensitive for 1m scalping
  const emaDiff = ((ind.ema9 - ind.ema21) / ind.ema21) * 100;

  if (ind.ema9 > ind.ema21 && Math.abs(emaDiff) < 0.5) { // Wider tolerance for 1m
    direction = 'LONG';
    reasons.push(`EMA 9 crossed above 21 (diff: ${emaDiff.toFixed(3)}%)`);
    confluence++;

    if (price > ind.ema50) { confluence++; reasons.push('Price above EMA 50'); }
    if (ind.rsi > 45 && ind.rsi < 65) { confluence++; reasons.push(`RSI supportive (${ind.rsi.toFixed(0)})`); }
    if (ind.macd.histogram > 0) { confluence++; reasons.push('MACD histogram positive'); }
    if (ind.obvTrend === 'rising') { confluence++; reasons.push('OBV rising'); }
  } else if (ind.ema9 < ind.ema21 && Math.abs(emaDiff) < 0.5) { // Wider tolerance for 1m
    direction = 'SHORT';
    reasons.push(`EMA 9 crossed below 21 (diff: ${emaDiff.toFixed(3)}%)`);
    confluence++;

    if (price < ind.ema50) { confluence++; reasons.push('Price below EMA 50'); }
    if (ind.rsi > 35 && ind.rsi < 55) { confluence++; reasons.push(`RSI supportive (${ind.rsi.toFixed(0)})`); }
    if (ind.macd.histogram < 0) { confluence++; reasons.push('MACD histogram negative'); }
    if (ind.obvTrend === 'falling') { confluence++; reasons.push('OBV falling'); }
  }

  // Lower threshold for 1m scalping (faster signals)
  if (!direction || confluence < 1) return null;

  return buildSignal('ema-cross', direction, price, ind.atr, reasons, confluence, config, time);
}

function generateRSIBounce(
  candles: CandlestickData[],
  ind: IndicatorSnapshot,
  config: ScalpConfig,
  time: number
): ScalpSignal | null {
  const price = candles[candles.length - 1].close;
  const reasons: string[] = [];
  let direction: 'LONG' | 'SHORT' | null = null;
  let confluence = 0;

  if (ind.rsi < 25) {
    direction = 'LONG';
    reasons.push(`RSI oversold (${ind.rsi.toFixed(1)})`);
    confluence++;

    if (ind.stochRSI.k < 20) { confluence++; reasons.push(`StochRSI also oversold (${ind.stochRSI.k.toFixed(0)})`); }
    if (ind.cci < -150) { confluence++; reasons.push(`CCI extreme (${ind.cci.toFixed(0)})`); }
    if (ind.bollingerBands.percentB < 0.05) { confluence++; reasons.push('Price at lower BB'); }
    if (ind.priceVsVwap < -1) { confluence++; reasons.push('Below VWAP — mean revert likely'); }
  } else if (ind.rsi > 75) {
    direction = 'SHORT';
    reasons.push(`RSI overbought (${ind.rsi.toFixed(1)})`);
    confluence++;

    if (ind.stochRSI.k > 80) { confluence++; reasons.push(`StochRSI also overbought (${ind.stochRSI.k.toFixed(0)})`); }
    if (ind.cci > 150) { confluence++; reasons.push(`CCI extreme (${ind.cci.toFixed(0)})`); }
    if (ind.bollingerBands.percentB > 0.95) { confluence++; reasons.push('Price at upper BB'); }
    if (ind.priceVsVwap > 1) { confluence++; reasons.push('Above VWAP — mean revert likely'); }
  }

  // Lower threshold for 1m scalping (faster signals)
  if (!direction || confluence < 1) return null;

  return buildSignal('rsi-bounce', direction, price, ind.atr, reasons, confluence, config, time);
}

function generateStochRSICross(
  candles: CandlestickData[],
  ind: IndicatorSnapshot,
  config: ScalpConfig,
  time: number
): ScalpSignal | null {
  const price = candles[candles.length - 1].close;
  const reasons: string[] = [];
  let direction: 'LONG' | 'SHORT' | null = null;
  let confluence = 0;

  // Bullish: K crosses above D in oversold zone
  if (ind.stochRSI.k < 30 && ind.stochRSI.k > ind.stochRSI.d) {
    direction = 'LONG';
    reasons.push(`StochRSI bullish cross in oversold (K:${ind.stochRSI.k.toFixed(0)} > D:${ind.stochRSI.d.toFixed(0)})`);
    confluence++;

    if (ind.rsi < 40) { confluence++; reasons.push(`RSI low (${ind.rsi.toFixed(0)})`); }
    if (ind.macd.histogram > ind.macd.histogram * 0.9) { confluence++; reasons.push('MACD histogram improving'); }
    if (price > ind.ema9) { confluence++; reasons.push('Price above EMA 9'); }
  }
  // Bearish: K crosses below D in overbought zone
  else if (ind.stochRSI.k > 70 && ind.stochRSI.k < ind.stochRSI.d) {
    direction = 'SHORT';
    reasons.push(`StochRSI bearish cross in overbought (K:${ind.stochRSI.k.toFixed(0)} < D:${ind.stochRSI.d.toFixed(0)})`);
    confluence++;

    if (ind.rsi > 60) { confluence++; reasons.push(`RSI high (${ind.rsi.toFixed(0)})`); }
    if (ind.macd.histogram < 0) { confluence++; reasons.push('MACD histogram negative'); }
    if (price < ind.ema9) { confluence++; reasons.push('Price below EMA 9'); }
  }

  // Lower threshold for 1m scalping (faster signals)
  if (!direction || confluence < 1) return null;

  return buildSignal('stoch-cross', direction, price, ind.atr, reasons, confluence, config, time);
}

function generateBBBounce(
  candles: CandlestickData[],
  ind: IndicatorSnapshot,
  config: ScalpConfig,
  time: number
): ScalpSignal | null {
  const price = candles[candles.length - 1].close;
  const reasons: string[] = [];
  let direction: 'LONG' | 'SHORT' | null = null;
  let confluence = 0;

  if (ind.bollingerBands.percentB < 0) {
    direction = 'LONG';
    reasons.push(`Price below lower BB (%%B: ${ind.bollingerBands.percentB.toFixed(2)})`);
    confluence++;

    if (ind.rsi < 35) { confluence++; reasons.push(`RSI oversold (${ind.rsi.toFixed(0)})`); }
    if (ind.stochRSI.k < 25) { confluence++; reasons.push('StochRSI oversold'); }
    if (ind.cci < -100) { confluence++; reasons.push('CCI oversold'); }
  } else if (ind.bollingerBands.percentB > 1) {
    direction = 'SHORT';
    reasons.push(`Price above upper BB (%%B: ${ind.bollingerBands.percentB.toFixed(2)})`);
    confluence++;

    if (ind.rsi > 65) { confluence++; reasons.push(`RSI overbought (${ind.rsi.toFixed(0)})`); }
    if (ind.stochRSI.k > 75) { confluence++; reasons.push('StochRSI overbought'); }
    if (ind.cci > 100) { confluence++; reasons.push('CCI overbought'); }
  }

  // Lower threshold for 1m scalping (faster signals)
  if (!direction || confluence < 1) return null;

  return buildSignal('bb-bounce', direction, price, ind.atr, reasons, confluence, config, time);
}

function generateMACDScalp(
  candles: CandlestickData[],
  ind: IndicatorSnapshot,
  config: ScalpConfig,
  time: number
): ScalpSignal | null {
  const price = candles[candles.length - 1].close;
  const reasons: string[] = [];
  let direction: 'LONG' | 'SHORT' | null = null;
  let confluence = 0;

  // MACD line crossed signal line
  if (ind.macd.value > ind.macd.signal && ind.macd.histogram > 0) {
    // Check if this is a fresh cross (small histogram)
    const histRatio = Math.abs(ind.macd.histogram) / (Math.abs(ind.macd.value) || 1);
    if (histRatio < 0.5) {
      direction = 'LONG';
      reasons.push(`MACD bullish cross (hist: ${ind.macd.histogram.toFixed(2)})`);
      confluence++;

      if (ind.ema9 > ind.ema21) { confluence++; reasons.push('EMA 9 > 21'); }
      if (ind.rsi > 45 && ind.rsi < 70) { confluence++; reasons.push(`RSI healthy (${ind.rsi.toFixed(0)})`); }
      if (ind.obvTrend === 'rising') { confluence++; reasons.push('Volume supporting'); }
      if (!isNaN(ind.adx.value) && ind.adx.value > 20 && ind.adx.plusDI > ind.adx.minusDI) {
        confluence++; reasons.push(`ADX trend (${ind.adx.value.toFixed(0)})`);
      }
    }
  } else if (ind.macd.value < ind.macd.signal && ind.macd.histogram < 0) {
    const histRatio = Math.abs(ind.macd.histogram) / (Math.abs(ind.macd.value) || 1);
    if (histRatio < 0.5) {
      direction = 'SHORT';
      reasons.push(`MACD bearish cross (hist: ${ind.macd.histogram.toFixed(2)})`);
      confluence++;

      if (ind.ema9 < ind.ema21) { confluence++; reasons.push('EMA 9 < 21'); }
      if (ind.rsi > 30 && ind.rsi < 55) { confluence++; reasons.push(`RSI healthy (${ind.rsi.toFixed(0)})`); }
      if (ind.obvTrend === 'falling') { confluence++; reasons.push('Volume supporting'); }
      if (!isNaN(ind.adx.value) && ind.adx.value > 20 && ind.adx.minusDI > ind.adx.plusDI) {
        confluence++; reasons.push(`ADX trend (${ind.adx.value.toFixed(0)})`);
      }
    }
  }

  // Lower threshold for 1m scalping (faster signals)
  if (!direction || confluence < 1) return null;

  return buildSignal('macd-scalp', direction, price, ind.atr, reasons, confluence, config, time);
}

function generateLiquiditySweepScalp(
  candles: CandlestickData[],
  ind: IndicatorSnapshot,
  pa: PriceActionAnalysis,
  config: ScalpConfig,
  time: number
): ScalpSignal | null {
  const price = candles[candles.length - 1].close;
  const reasons: string[] = [];
  let direction: 'LONG' | 'SHORT' | null = null;
  let confluence = 0;

  const recentSweeps = pa.liquiditySweeps.filter(
    s => s.index >= candles.length - 3 && s.recovered
  );

  for (const sweep of recentSweeps) {
    if (sweep.type === 'sell-side') {
      direction = 'LONG';
      reasons.push(`Sell-side liquidity sweep + recovery at ${sweep.sweptLevel.toFixed(2)}`);
      confluence += 2; // Sweeps are high-value signals

      if (ind.rsi < 40) { confluence++; reasons.push('RSI confirms oversold'); }
      if (ind.stochRSI.k < 30) { confluence++; reasons.push('StochRSI oversold'); }
    } else {
      direction = 'SHORT';
      reasons.push(`Buy-side liquidity sweep + recovery at ${sweep.sweptLevel.toFixed(2)}`);
      confluence += 2;

      if (ind.rsi > 60) { confluence++; reasons.push('RSI confirms overbought'); }
      if (ind.stochRSI.k > 70) { confluence++; reasons.push('StochRSI overbought'); }
    }
    break; // Only take first sweep
  }

  // Lower threshold for 1m scalping (faster signals)
  if (!direction || confluence < 1) return null;

  return buildSignal('liq-sweep', direction, price, ind.atr, reasons, confluence, config, time);
}

function generateFVGScalp(
  candles: CandlestickData[],
  ind: IndicatorSnapshot,
  pa: PriceActionAnalysis,
  config: ScalpConfig,
  time: number
): ScalpSignal | null {
  const price = candles[candles.length - 1].close;
  const reasons: string[] = [];
  let direction: 'LONG' | 'SHORT' | null = null;
  let confluence = 0;

  // Wider tolerance for 1m scalping - catch FVGs faster
  const nearbyFVGs = pa.fairValueGaps.filter(
    g => !g.filled && Math.abs(g.midpoint - price) / price < 0.005 // 0.5% tolerance for 1m
  );

  for (const fvg of nearbyFVGs) {
    if (fvg.type === 'bullish' && fvg.midpoint < price) {
      direction = 'LONG';
      reasons.push(`Bullish FVG support at ${fvg.midpoint.toFixed(2)}`);
      confluence++;

      if (ind.rsi < 50) { confluence++; reasons.push('RSI below 50 (room to run)'); }
      if (ind.ema9 > ind.ema21) { confluence++; reasons.push('EMA aligned bullish'); }
    } else if (fvg.type === 'bearish' && fvg.midpoint > price) {
      direction = 'SHORT';
      reasons.push(`Bearish FVG resistance at ${fvg.midpoint.toFixed(2)}`);
      confluence++;

      if (ind.rsi > 50) { confluence++; reasons.push('RSI above 50 (room to drop)'); }
      if (ind.ema9 < ind.ema21) { confluence++; reasons.push('EMA aligned bearish'); }
    }
    break;
  }

  // Lower threshold for 1m scalping (faster signals)
  if (!direction || confluence < 1) return null;

  return buildSignal('fvg-fill', direction, price, ind.atr, reasons, confluence, config, time);
}

function generateCompositeScalp(
  candles: CandlestickData[],
  ind: IndicatorSnapshot,
  pa: PriceActionAnalysis | null,
  config: ScalpConfig,
  time: number
): ScalpSignal | null {
  const price = candles[candles.length - 1].close;
  const reasons: string[] = [];
  let bullScore = 0;
  let bearScore = 0;
  let confluence = 0;

  // EMA alignment
  if (ind.ema9 > ind.ema21 && ind.ema21 > ind.ema50) { bullScore += 2; reasons.push('EMA stack bullish'); }
  else if (ind.ema9 < ind.ema21 && ind.ema21 < ind.ema50) { bearScore += 2; reasons.push('EMA stack bearish'); }

  // RSI
  if (ind.rsi > 55) bullScore++;
  else if (ind.rsi < 45) bearScore++;

  // MACD
  if (ind.macd.histogram > 0 && ind.macd.value > ind.macd.signal) { bullScore++; }
  else if (ind.macd.histogram < 0 && ind.macd.value < ind.macd.signal) { bearScore++; }

  // StochRSI
  if (ind.stochRSI.k > ind.stochRSI.d && ind.stochRSI.k < 80) bullScore++;
  else if (ind.stochRSI.k < ind.stochRSI.d && ind.stochRSI.k > 20) bearScore++;

  // OBV
  if (ind.obvTrend === 'rising') bullScore++;
  else if (ind.obvTrend === 'falling') bearScore++;

  // ADX
  if (!isNaN(ind.adx.value) && ind.adx.value > 25) {
    if (ind.adx.plusDI > ind.adx.minusDI) bullScore++;
    else bearScore++;
  }

  // VWAP
  if (ind.priceVsVwap > 0.3) bullScore++;
  else if (ind.priceVsVwap < -0.3) bearScore++;

  // Price action
  if (pa) {
    if (pa.trend === 'bullish') bullScore++;
    else if (pa.trend === 'bearish') bearScore++;

    const recentSigs = pa.signals.slice(0, 3);
    for (const sig of recentSigs) {
      if (sig.type === 'BUY') bullScore++;
      else if (sig.type === 'SELL') bearScore++;
    }
  }

  const maxScore = Math.max(bullScore, bearScore);
  confluence = maxScore;

  // Lower threshold for 1m scalping - need at least 3 signals aligned
  if (maxScore < 3) return null;

  const direction = bullScore > bearScore ? 'LONG' as const : 'SHORT' as const;

  if (direction === 'LONG') {
    reasons.unshift(`${bullScore} bullish signals aligned`);
  } else {
    reasons.unshift(`${bearScore} bearish signals aligned`);
  }

  return buildSignal('composite', direction, price, ind.atr, reasons, confluence, config, time);
}

// ─── Signal Builder ─────────────────────────────────────────────────────────

function buildSignal(
  strategy: string,
  direction: 'LONG' | 'SHORT',
  price: number,
  atrValue: number,
  reasons: string[],
  confluence: number,
  config: ScalpConfig,
  time: number
): ScalpSignal {
  // Scalp SL/TP based on ATR - optimized for 1m timeframe
  // Tighter stops for faster scalping
  const slMultiplier = 0.8; // Tighter SL for 1m
  const tp1Multiplier = 1.2; // Quick TP1 for 1m scalps
  const tp2Multiplier = 2.0; // TP2 target

  // ── Better Entry Prices for 1m Scalping ──
  // Use limit orders slightly better than market to avoid slippage
  // LONG: Enter slightly below market (limit buy at better price)
  // SHORT: Enter slightly above market (limit sell at better price)
  // Use ATR-based offset (more adaptive) or fixed % offset
  const atrOffset = atrValue * 0.15; // 15% of ATR for entry offset
  const fixedOffsetPct = 0.1; // 0.1% fallback
  const fixedOffset = price * (fixedOffsetPct / 100);
  const entryOffset = Math.max(atrOffset, fixedOffset); // Use whichever is larger
  
  const entry = direction === 'LONG'
    ? price - entryOffset  // Buy limit slightly below market (better fill)
    : price + entryOffset; // Sell limit slightly above market (better fill)
  const stopLoss = direction === 'LONG'
    ? entry - atrValue * slMultiplier
    : entry + atrValue * slMultiplier;
  const takeProfit1 = direction === 'LONG'
    ? entry + atrValue * tp1Multiplier
    : entry - atrValue * tp1Multiplier;
  const takeProfit2 = direction === 'LONG'
    ? entry + atrValue * tp2Multiplier
    : entry - atrValue * tp2Multiplier;

  const risk = Math.abs(entry - stopLoss);
  const reward1 = Math.abs(takeProfit1 - entry);
  const rr = risk > 0 ? reward1 / risk : 0;

  // Calculate strength from confluence
  const strength = Math.min(100, confluence * 15 + 10);

  // Grade based on confluence and R:R - adjusted for 1m scalping
  const grade: 'A+' | 'A' | 'B' | 'C' =
    confluence >= 5 && rr >= 1.2 ? 'A+' : // Lower threshold for 1m
    confluence >= 3 && rr >= 1.0 ? 'A' :   // More lenient for 1m
    confluence >= 2 ? 'B' : 'C';           // Lower minimum

  // Position sizing
  const sizing = calculatePositionSize(entry, stopLoss, config);
  sizing.rewardAmount = sizing.notionalSize * (Math.abs(takeProfit1 - entry) / entry);
  sizing.rewardPct = (sizing.rewardAmount / config.capital) * 100;

  return {
    id: `${strategy}-${direction}-${Date.now()}`,
    direction,
    entry,
    stopLoss,
    takeProfit1,
    takeProfit2,
    riskReward: rr,
    strength,
    grade,
    strategy,
    reasons,
    positionSize: sizing,
    timestamp: time,
    status: 'active',
    confluenceCount: confluence,
  };
}

// ─── Daily Stats Calculator ─────────────────────────────────────────────────

export function calculateDailyStats(
  trades: DailyTradeLog[],
  config: ScalpConfig
): DailyStats {
  const completedTrades = trades.filter(t => t.result !== 'pending');
  const wins = completedTrades.filter(t => t.result === 'win');
  const losses = completedTrades.filter(t => t.result === 'loss');

  const totalPnlDollar = completedTrades.reduce((sum, t) => sum + t.pnlDollar, 0);
  const totalPnlPct = config.capital > 0 ? (totalPnlDollar / config.capital) * 100 : 0;

  // Calculate consecutive losses
  let maxConsecLosses = 0;
  let currentConsecLosses = 0;
  for (const t of completedTrades) {
    if (t.result === 'loss') {
      currentConsecLosses++;
      maxConsecLosses = Math.max(maxConsecLosses, currentConsecLosses);
    } else {
      currentConsecLosses = 0;
    }
  }

  const maxTradesReached = trades.length >= config.maxTradesPerDay;
  const maxLossReached = totalPnlPct <= -config.maxDailyLossPct;
  const consecutiveLossReached = currentConsecLosses >= config.maxConsecutiveLosses;

  let stopReason: string | null = null;
  if (maxTradesReached) stopReason = `Max ${config.maxTradesPerDay} trades reached`;
  else if (maxLossReached) stopReason = `Max daily loss of ${config.maxDailyLossPct}% reached`;
  else if (consecutiveLossReached) stopReason = `${config.maxConsecutiveLosses} consecutive losses — take a break`;

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: completedTrades.length > 0 ? (wins.length / completedTrades.length) * 100 : 0,
    totalPnlDollar,
    totalPnlPct,
    consecutiveLosses: currentConsecLosses,
    maxTradesReached,
    maxLossReached,
    shouldStop: maxTradesReached || maxLossReached || consecutiveLossReached,
    stopReason,
  };
}

