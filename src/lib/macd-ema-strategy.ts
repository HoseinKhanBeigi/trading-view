import type { CandlestickData } from "lightweight-charts";
import { ema, macd, atr } from "./indicators";

// ─── MACD+EMA Strategy — Configurable Parameter Variants ─────────────────────

export type MACDEMAParams = {
  name: string;
  // MACD params
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  // EMA params
  emaFast: number;
  emaSlow: number;
  // Entry logic
  entryMode: 'macd-cross' | 'histogram-reversal' | 'zero-cross';
  // Exit logic
  exitMode: 'fixed-atr' | 'opposite-signal' | 'trailing-stop';
  // Risk management
  slATRMult: number;   // ATR multiplier for stop loss
  tpATRMult: number;   // ATR multiplier for take profit
  trailATRMult: number; // ATR multiplier for trailing stop
  // Filters
  requireEMATrend: boolean;  // require price to be on right side of slow EMA
  requireMACDAboveZero: boolean; // require MACD > 0 for long, < 0 for short
  atrPeriod: number;
};

export type MACDEMASignal = {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  strength: number; // 0-100
  reasons: string[];
};

// ─── Pre-built Variants to Test ──────────────────────────────────────────────

export const MACD_EMA_VARIANTS: MACDEMAParams[] = [
  // === Variant 1: Classic MACD Cross + EMA 50 trend filter ===
  {
    name: "Classic MACD(12,26,9) + EMA(9,50) Trend",
    macdFast: 12, macdSlow: 26, macdSignal: 9,
    emaFast: 9, emaSlow: 50,
    entryMode: 'macd-cross', exitMode: 'fixed-atr',
    slATRMult: 2.0, tpATRMult: 4.0, trailATRMult: 1.5,
    requireEMATrend: true, requireMACDAboveZero: false, atrPeriod: 14,
  },
  // === Variant 2: Fast MACD + EMA 21/55 ===
  {
    name: "Fast MACD(8,17,9) + EMA(21,55) Trend",
    macdFast: 8, macdSlow: 17, macdSignal: 9,
    emaFast: 21, emaSlow: 55,
    entryMode: 'macd-cross', exitMode: 'fixed-atr',
    slATRMult: 1.5, tpATRMult: 3.0, trailATRMult: 1.5,
    requireEMATrend: true, requireMACDAboveZero: false, atrPeriod: 14,
  },
  // === Variant 3: Wide MACD + Golden Cross Filter ===
  {
    name: "Wide MACD(5,35,5) + EMA(50,200) Golden",
    macdFast: 5, macdSlow: 35, macdSignal: 5,
    emaFast: 50, emaSlow: 200,
    entryMode: 'macd-cross', exitMode: 'fixed-atr',
    slATRMult: 2.5, tpATRMult: 5.0, trailATRMult: 2.0,
    requireEMATrend: true, requireMACDAboveZero: false, atrPeriod: 14,
  },
  // === Variant 4: MACD Histogram Reversal + EMA Stack ===
  {
    name: "Histogram Rev MACD(12,26,9) + EMA(9,21) Stack",
    macdFast: 12, macdSlow: 26, macdSignal: 9,
    emaFast: 9, emaSlow: 21,
    entryMode: 'histogram-reversal', exitMode: 'fixed-atr',
    slATRMult: 1.5, tpATRMult: 3.0, trailATRMult: 1.5,
    requireEMATrend: true, requireMACDAboveZero: false, atrPeriod: 14,
  },
  // === Variant 5: MACD Zero Cross + EMA 20/50 ===
  {
    name: "Zero Cross MACD(12,26,9) + EMA(20,50)",
    macdFast: 12, macdSlow: 26, macdSignal: 9,
    emaFast: 20, emaSlow: 50,
    entryMode: 'zero-cross', exitMode: 'fixed-atr',
    slATRMult: 2.0, tpATRMult: 4.0, trailATRMult: 1.5,
    requireEMATrend: true, requireMACDAboveZero: false, atrPeriod: 14,
  },
  // === Variant 6: Classic MACD + Trailing Stop ===
  {
    name: "Classic MACD(12,26,9) + EMA(9,50) Trail",
    macdFast: 12, macdSlow: 26, macdSignal: 9,
    emaFast: 9, emaSlow: 50,
    entryMode: 'macd-cross', exitMode: 'trailing-stop',
    slATRMult: 2.0, tpATRMult: 6.0, trailATRMult: 2.0,
    requireEMATrend: true, requireMACDAboveZero: false, atrPeriod: 14,
  },
  // === Variant 7: Fast MACD + Opposite Signal Exit ===
  {
    name: "Fast MACD(8,17,9) + EMA(12,26) OpSignal",
    macdFast: 8, macdSlow: 17, macdSignal: 9,
    emaFast: 12, emaSlow: 26,
    entryMode: 'macd-cross', exitMode: 'opposite-signal',
    slATRMult: 2.5, tpATRMult: 6.0, trailATRMult: 1.5,
    requireEMATrend: true, requireMACDAboveZero: false, atrPeriod: 14,
  },
  // === Variant 8: Conservative — MACD > 0 required ===
  {
    name: "Conservative MACD(12,26,9) + EMA(21,50) MACD>0",
    macdFast: 12, macdSlow: 26, macdSignal: 9,
    emaFast: 21, emaSlow: 50,
    entryMode: 'macd-cross', exitMode: 'fixed-atr',
    slATRMult: 2.0, tpATRMult: 4.0, trailATRMult: 1.5,
    requireEMATrend: true, requireMACDAboveZero: true, atrPeriod: 14,
  },
  // === Variant 9: Aggressive — No EMA filter ===
  {
    name: "Aggressive MACD(8,17,9) NoFilter",
    macdFast: 8, macdSlow: 17, macdSignal: 9,
    emaFast: 9, emaSlow: 21,
    entryMode: 'macd-cross', exitMode: 'fixed-atr',
    slATRMult: 1.5, tpATRMult: 3.5, trailATRMult: 1.0,
    requireEMATrend: false, requireMACDAboveZero: false, atrPeriod: 14,
  },
  // === Variant 10: Histogram + Zero + EMA(50,200) ===
  {
    name: "Hist+Zero MACD(12,26,9) + EMA(50,200)",
    macdFast: 12, macdSlow: 26, macdSignal: 9,
    emaFast: 50, emaSlow: 200,
    entryMode: 'histogram-reversal', exitMode: 'trailing-stop',
    slATRMult: 2.5, tpATRMult: 6.0, trailATRMult: 2.5,
    requireEMATrend: true, requireMACDAboveZero: true, atrPeriod: 14,
  },
  // === Variant 11: Slow MACD + Long-term EMAs ===
  {
    name: "Slow MACD(19,39,9) + EMA(50,200)",
    macdFast: 19, macdSlow: 39, macdSignal: 9,
    emaFast: 50, emaSlow: 200,
    entryMode: 'macd-cross', exitMode: 'fixed-atr',
    slATRMult: 3.0, tpATRMult: 6.0, trailATRMult: 2.0,
    requireEMATrend: true, requireMACDAboveZero: false, atrPeriod: 14,
  },
  // === Variant 12: Ultra-fast scalp-like ===
  {
    name: "Ultra-Fast MACD(5,13,4) + EMA(8,21)",
    macdFast: 5, macdSlow: 13, macdSignal: 4,
    emaFast: 8, emaSlow: 21,
    entryMode: 'macd-cross', exitMode: 'fixed-atr',
    slATRMult: 1.0, tpATRMult: 2.0, trailATRMult: 1.0,
    requireEMATrend: true, requireMACDAboveZero: false, atrPeriod: 10,
  },
  // === Variant 13: MACD(8,21,5) + EMA(21,50) + Trailing ===
  {
    name: "MACD(8,21,5) + EMA(21,50) Trail",
    macdFast: 8, macdSlow: 21, macdSignal: 5,
    emaFast: 21, emaSlow: 50,
    entryMode: 'macd-cross', exitMode: 'trailing-stop',
    slATRMult: 2.0, tpATRMult: 5.0, trailATRMult: 1.8,
    requireEMATrend: true, requireMACDAboveZero: false, atrPeriod: 14,
  },
  // === Variant 14: MACD(12,26,9) + EMA(9,21) + Hist Rev + No filter ===
  {
    name: "HistRev MACD(12,26,9) + EMA(9,21) NoFilter",
    macdFast: 12, macdSlow: 26, macdSignal: 9,
    emaFast: 9, emaSlow: 21,
    entryMode: 'histogram-reversal', exitMode: 'fixed-atr',
    slATRMult: 1.5, tpATRMult: 3.0, trailATRMult: 1.5,
    requireEMATrend: false, requireMACDAboveZero: false, atrPeriod: 14,
  },
  // === Variant 15: Golden Cross Confirmation (slow, high conviction) ===
  {
    name: "MACD(12,26,9) + EMA(50,200) Conservative Trail",
    macdFast: 12, macdSlow: 26, macdSignal: 9,
    emaFast: 50, emaSlow: 200,
    entryMode: 'macd-cross', exitMode: 'trailing-stop',
    slATRMult: 3.0, tpATRMult: 8.0, trailATRMult: 2.5,
    requireEMATrend: true, requireMACDAboveZero: true, atrPeriod: 14,
  },
];

// ─── Signal Generation ───────────────────────────────────────────────────────

/**
 * Generate MACD+EMA signal for a given bar
 */
export function generateMACDEMASignal(
  candles: CandlestickData[],
  bar: number,
  params: MACDEMAParams,
  // Precomputed indicators for performance
  precomputed: {
    macdLine: number[];
    signalLine: number[];
    histogram: number[];
    emaFastArr: number[];
    emaSlowArr: number[];
    atrArr: number[];
  }
): MACDEMASignal | null {
  if (bar < 2) return null;

  const { macdLine, signalLine, histogram, emaFastArr, emaSlowArr, atrArr } = precomputed;
  const price = candles[bar].close;
  const currentATR = atrArr[bar];

  if (isNaN(currentATR) || currentATR <= 0) return null;
  if (isNaN(macdLine[bar]) || isNaN(signalLine[bar])) return null;

  let direction: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
  const reasons: string[] = [];
  let strength = 0;

  // ── Entry Signal Logic ──
  switch (params.entryMode) {
    case 'macd-cross': {
      // MACD line crosses signal line
      const prevMacd = macdLine[bar - 1];
      const prevSignal = signalLine[bar - 1];
      const currMacd = macdLine[bar];
      const currSignal = signalLine[bar];

      if (isNaN(prevMacd) || isNaN(prevSignal)) return null;

      // Bullish cross: MACD crosses above signal
      if (prevMacd <= prevSignal && currMacd > currSignal) {
        direction = 'LONG';
        strength = Math.min(100, Math.abs(currMacd - currSignal) / currentATR * 50);
        reasons.push(`MACD crossed above signal (${currMacd.toFixed(2)} > ${currSignal.toFixed(2)})`);
      }
      // Bearish cross: MACD crosses below signal
      else if (prevMacd >= prevSignal && currMacd < currSignal) {
        direction = 'SHORT';
        strength = Math.min(100, Math.abs(currMacd - currSignal) / currentATR * 50);
        reasons.push(`MACD crossed below signal (${currMacd.toFixed(2)} < ${currSignal.toFixed(2)})`);
      }
      break;
    }

    case 'histogram-reversal': {
      // Histogram changes direction (from decreasing to increasing or vice versa)
      if (bar < 3) return null;
      const h0 = histogram[bar];
      const h1 = histogram[bar - 1];
      const h2 = histogram[bar - 2];

      if (isNaN(h0) || isNaN(h1) || isNaN(h2)) return null;

      // Bullish: histogram was decreasing (or negative) and starts increasing
      if (h2 > h1 && h1 < h0 && h0 > h1) {
        if (h1 < 0) { // Reversal from negative territory
          direction = 'LONG';
          strength = Math.min(100, Math.abs(h0 - h1) / currentATR * 60);
          reasons.push(`Histogram bullish reversal (${h1.toFixed(2)} → ${h0.toFixed(2)})`);
        }
      }
      // Bearish: histogram was increasing (or positive) and starts decreasing
      if (h2 < h1 && h1 > h0 && h0 < h1) {
        if (h1 > 0) { // Reversal from positive territory
          direction = 'SHORT';
          strength = Math.min(100, Math.abs(h0 - h1) / currentATR * 60);
          reasons.push(`Histogram bearish reversal (${h1.toFixed(2)} → ${h0.toFixed(2)})`);
        }
      }
      break;
    }

    case 'zero-cross': {
      // MACD line crosses the zero line
      const prevMacd = macdLine[bar - 1];
      const currMacd = macdLine[bar];

      if (isNaN(prevMacd)) return null;

      if (prevMacd <= 0 && currMacd > 0) {
        direction = 'LONG';
        strength = Math.min(100, Math.abs(currMacd) / currentATR * 40);
        reasons.push(`MACD crossed above zero (${currMacd.toFixed(2)})`);
      } else if (prevMacd >= 0 && currMacd < 0) {
        direction = 'SHORT';
        strength = Math.min(100, Math.abs(currMacd) / currentATR * 40);
        reasons.push(`MACD crossed below zero (${currMacd.toFixed(2)})`);
      }
      break;
    }
  }

  if (direction === 'NEUTRAL') return null;

  // ── Apply Filters ──

  // EMA trend filter
  if (params.requireEMATrend) {
    const emaF = emaFastArr[bar];
    const emaS = emaSlowArr[bar];
    if (isNaN(emaF) || isNaN(emaS)) return null;

    if (direction === 'LONG' && price < emaS) {
      return null; // Price below slow EMA, skip long
    }
    if (direction === 'SHORT' && price > emaS) {
      return null; // Price above slow EMA, skip short
    }

    // EMA alignment bonus
    if (direction === 'LONG' && emaF > emaS) {
      strength += 15;
      reasons.push(`EMA ${params.emaFast} > EMA ${params.emaSlow} (trend aligned)`);
    } else if (direction === 'SHORT' && emaF < emaS) {
      strength += 15;
      reasons.push(`EMA ${params.emaFast} < EMA ${params.emaSlow} (trend aligned)`);
    }
  }

  // MACD above/below zero filter
  if (params.requireMACDAboveZero) {
    if (direction === 'LONG' && macdLine[bar] < 0) return null;
    if (direction === 'SHORT' && macdLine[bar] > 0) return null;
    reasons.push(`MACD in ${direction === 'LONG' ? 'positive' : 'negative'} territory`);
  }

  strength = Math.min(100, Math.max(10, strength));

  // ── Calculate Entry, SL, TP ──
  const entry = price;
  const sl = direction === 'LONG'
    ? entry - currentATR * params.slATRMult
    : entry + currentATR * params.slATRMult;
  const tp = direction === 'LONG'
    ? entry + currentATR * params.tpATRMult
    : entry - currentATR * params.tpATRMult;

  return { direction, entry, stopLoss: sl, takeProfit: tp, strength, reasons };
}

// ─── Backtest Engine for MACD+EMA ────────────────────────────────────────────

export type MACDEMABacktestResult = {
  params: MACDEMAParams;
  trades: MACDEMABacktestTrade[];
  summary: MACDEMABacktestSummary;
  equityCurve: number[];
};

export type MACDEMABacktestTrade = {
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  entryBar: number;
  exitBar: number;
  pnlPct: number;
  result: 'win' | 'loss';
  holdingBars: number;
};

export type MACDEMABacktestSummary = {
  totalTrades: number;
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  expectancy: number;
  avgHoldingBars: number;
  bestTradePct: number;
  worstTradePct: number;
  maxConsecWins: number;
  maxConsecLosses: number;
  // Composite ranking score (higher = better)
  compositeScore: number;
};

export function backtestMACDEMA(
  candles: CandlestickData[],
  params: MACDEMAParams,
  config: {
    initialCapital?: number;
    positionSizePct?: number;
    commission?: number;
    slippage?: number;
    maxHoldBars?: number;
  } = {}
): MACDEMABacktestResult {
  const initialCapital = config.initialCapital ?? 10000;
  const positionSizePct = config.positionSizePct ?? 100; // full capital
  const commission = config.commission ?? 0.1; // 0.1% per trade
  const slippage = config.slippage ?? 0.05; // 0.05%
  const maxHoldBars = config.maxHoldBars ?? 100;

  // Precompute indicators
  const closes = candles.map(c => c.close);
  const macdResult = macd(closes, params.macdFast, params.macdSlow, params.macdSignal);
  const emaFastArr = ema(closes, params.emaFast);
  const emaSlowArr = ema(closes, params.emaSlow);
  const atrArr = atr(candles, params.atrPeriod);

  const precomputed = {
    macdLine: macdResult.macd,
    signalLine: macdResult.signal,
    histogram: macdResult.histogram,
    emaFastArr,
    emaSlowArr,
    atrArr,
  };

  const trades: MACDEMABacktestTrade[] = [];
  const equityCurve: number[] = [];
  let equity = initialCapital;

  // Start after enough lookback
  const startBar = Math.max(params.macdSlow + params.macdSignal, params.emaSlow, params.atrPeriod) + 5;

  let inPosition = false;
  let posDir: 'LONG' | 'SHORT' = 'LONG';
  let entryPrice = 0;
  let entryBar = 0;
  let sl = 0;
  let tp = 0;
  let trailStop = 0;

  for (let bar = startBar; bar < candles.length; bar++) {
    const high = candles[bar].high;
    const low = candles[bar].low;
    const close = candles[bar].close;
    const currentATR = atrArr[bar];

    // ── Check exits if in position ──
    if (inPosition) {
      let exitPrice: number | null = null;

      // Check SL/TP
      if (posDir === 'LONG') {
        // Update trailing stop
        if (params.exitMode === 'trailing-stop' && !isNaN(currentATR)) {
          const newTrail = close - currentATR * params.trailATRMult;
          trailStop = Math.max(trailStop, newTrail);
        }

        const effectiveSL = params.exitMode === 'trailing-stop' ? Math.max(sl, trailStop) : sl;

        if (low <= effectiveSL) {
          exitPrice = effectiveSL;
        } else if (high >= tp) {
          exitPrice = tp;
        } else if (bar - entryBar >= maxHoldBars) {
          exitPrice = close;
        }

        // Opposite signal exit
        if (params.exitMode === 'opposite-signal' && !exitPrice) {
          const sig = generateMACDEMASignal(candles, bar, params, precomputed);
          if (sig && sig.direction === 'SHORT') {
            exitPrice = close;
          }
        }
      } else { // SHORT
        if (params.exitMode === 'trailing-stop' && !isNaN(currentATR)) {
          const newTrail = close + currentATR * params.trailATRMult;
          trailStop = trailStop === 0 ? newTrail : Math.min(trailStop, newTrail);
        }

        const effectiveSL = params.exitMode === 'trailing-stop' && trailStop > 0
          ? Math.min(sl, trailStop)
          : sl;

        if (high >= effectiveSL) {
          exitPrice = effectiveSL;
        } else if (low <= tp) {
          exitPrice = tp;
        } else if (bar - entryBar >= maxHoldBars) {
          exitPrice = close;
        }

        if (params.exitMode === 'opposite-signal' && !exitPrice) {
          const sig = generateMACDEMASignal(candles, bar, params, precomputed);
          if (sig && sig.direction === 'LONG') {
            exitPrice = close;
          }
        }
      }

      if (exitPrice !== null) {
        // Apply slippage
        const slippageAdj = posDir === 'LONG'
          ? exitPrice * (1 - slippage / 100)
          : exitPrice * (1 + slippage / 100);

        const rawPnlPct = posDir === 'LONG'
          ? ((slippageAdj - entryPrice) / entryPrice) * 100
          : ((entryPrice - slippageAdj) / entryPrice) * 100;

        const netPnlPct = rawPnlPct - commission * 2; // Round trip commission
        const tradeReturn = (positionSizePct / 100) * (netPnlPct / 100);
        equity *= (1 + tradeReturn);

        trades.push({
          direction: posDir,
          entryPrice,
          exitPrice: slippageAdj,
          entryBar,
          exitBar: bar,
          pnlPct: netPnlPct,
          result: netPnlPct > 0 ? 'win' : 'loss',
          holdingBars: bar - entryBar,
        });

        inPosition = false;
      }
    }

    // ── Check for new entries ──
    if (!inPosition) {
      const signal = generateMACDEMASignal(candles, bar, params, precomputed);
      if (signal && signal.direction !== 'NEUTRAL') {
        // Apply slippage to entry
        entryPrice = signal.direction === 'LONG'
          ? signal.entry * (1 + slippage / 100)
          : signal.entry * (1 - slippage / 100);
        posDir = signal.direction;
        entryBar = bar;
        sl = signal.stopLoss;
        tp = signal.takeProfit;
        trailStop = signal.direction === 'LONG'
          ? entryPrice - (atrArr[bar] || entryPrice * 0.02) * params.trailATRMult
          : entryPrice + (atrArr[bar] || entryPrice * 0.02) * params.trailATRMult;
        inPosition = true;
      }
    }

    equityCurve.push(equity);
  }

  // Close any remaining position at last candle
  if (inPosition) {
    const lastClose = candles[candles.length - 1].close;
    const rawPnlPct = posDir === 'LONG'
      ? ((lastClose - entryPrice) / entryPrice) * 100
      : ((entryPrice - lastClose) / entryPrice) * 100;
    const netPnlPct = rawPnlPct - commission * 2;
    const tradeReturn = (positionSizePct / 100) * (netPnlPct / 100);
    equity *= (1 + tradeReturn);

    trades.push({
      direction: posDir,
      entryPrice,
      exitPrice: lastClose,
      entryBar,
      exitBar: candles.length - 1,
      pnlPct: netPnlPct,
      result: netPnlPct > 0 ? 'win' : 'loss',
      holdingBars: candles.length - 1 - entryBar,
    });
  }

  const summary = computeSummary(trades, initialCapital, equity, equityCurve);

  return { params, trades, summary, equityCurve };
}

function computeSummary(
  trades: MACDEMABacktestTrade[],
  initialCapital: number,
  finalEquity: number,
  equityCurve: number[]
): MACDEMABacktestSummary {
  const empty: MACDEMABacktestSummary = {
    totalTrades: 0, winRate: 0, avgWinPct: 0, avgLossPct: 0,
    profitFactor: 0, totalReturnPct: 0, maxDrawdownPct: 0,
    sharpeRatio: 0, sortinoRatio: 0, expectancy: 0,
    avgHoldingBars: 0, bestTradePct: 0, worstTradePct: 0,
    maxConsecWins: 0, maxConsecLosses: 0, compositeScore: -999,
  };

  if (trades.length === 0) return empty;

  const wins = trades.filter(t => t.result === 'win');
  const losses = trades.filter(t => t.result === 'loss');

  const winRate = (wins.length / trades.length) * 100;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + Math.abs(t.pnlPct), 0) / losses.length : 0;

  const grossProfit = wins.reduce((s, t) => s + t.pnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;

  const totalReturnPct = ((finalEquity - initialCapital) / initialCapital) * 100;

  // Max drawdown from equity curve
  let peak = equityCurve[0] || initialCapital;
  let maxDD = 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = ((peak - eq) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }

  // Sharpe & Sortino from trade returns
  const returns = trades.map(t => t.pnlPct);
  const avgR = returns.reduce((s, r) => s + r, 0) / returns.length;
  const stdR = Math.sqrt(returns.reduce((s, r) => s + (r - avgR) ** 2, 0) / returns.length);
  const sharpe = stdR > 0 ? (avgR / stdR) * Math.sqrt(365 / (trades.reduce((s, t) => s + t.holdingBars, 0) / trades.length || 1)) : 0;

  const negR = returns.filter(r => r < 0);
  const downDev = negR.length > 0 ? Math.sqrt(negR.reduce((s, r) => s + r * r, 0) / negR.length) : 0;
  const sortino = downDev > 0 ? (avgR / downDev) * Math.sqrt(365 / (trades.reduce((s, t) => s + t.holdingBars, 0) / trades.length || 1)) : 0;

  const expectancy = (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss;

  // Consecutive wins/losses
  let consecW = 0, consecL = 0, maxCW = 0, maxCL = 0;
  for (const t of trades) {
    if (t.result === 'win') { consecW++; consecL = 0; maxCW = Math.max(maxCW, consecW); }
    else { consecL++; consecW = 0; maxCL = Math.max(maxCL, consecL); }
  }

  // ── Composite Score: weighted ranking metric ──
  // Higher = better strategy
  const compositeScore =
    totalReturnPct * 0.30 +                          // Total return (30%)
    profitFactor * 10 * 0.20 +                       // Profit factor (20%)
    sharpe * 10 * 0.15 +                             // Sharpe ratio (15%)
    expectancy * 5 * 0.15 +                          // Expectancy (15%)
    winRate * 0.10 +                                  // Win rate (10%)
    -maxDD * 0.10;                                    // Max drawdown penalty (10%)

  return {
    totalTrades: trades.length,
    winRate,
    avgWinPct: avgWin,
    avgLossPct: avgLoss,
    profitFactor,
    totalReturnPct,
    maxDrawdownPct: maxDD,
    sharpeRatio: sharpe,
    sortinoRatio: sortino,
    expectancy,
    avgHoldingBars: trades.reduce((s, t) => s + t.holdingBars, 0) / trades.length,
    bestTradePct: Math.max(...trades.map(t => t.pnlPct)),
    worstTradePct: Math.min(...trades.map(t => t.pnlPct)),
    maxConsecWins: maxCW,
    maxConsecLosses: maxCL,
    compositeScore,
  };
}

