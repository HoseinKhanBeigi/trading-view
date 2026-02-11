import type { CandlestickData } from "lightweight-charts";

// ─── Technical Indicators for Quant Trading ──────────────────────────────────

/**
 * Exponential Moving Average
 */
export function ema(values: number[], period: number): number[] {
  const result: number[] = [];
  if (values.length === 0 || period <= 0) return result;

  const k = 2 / (period + 1);
  result[0] = values[0];

  for (let i = 1; i < values.length; i++) {
    result[i] = values[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

/**
 * Simple Moving Average
 */
export function sma(values: number[], period: number): number[] {
  const result: number[] = [];
  if (values.length < period) return result;

  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) {
      result.push(sum / period);
    } else {
      result.push(NaN);
    }
  }
  return result;
}

/**
 * Relative Strength Index (RSI)
 */
export function rsi(closes: number[], period: number = 14): number[] {
  const result: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return result;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  // Smoothed
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

/**
 * MACD (Moving Average Convergence Divergence)
 */
export type MACDResult = {
  macd: number[];
  signal: number[];
  histogram: number[];
};

export function macd(
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult {
  const fastEMA = ema(closes, fastPeriod);
  const slowEMA = ema(closes, slowPeriod);

  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    macdLine.push(fastEMA[i] - slowEMA[i]);
  }

  const signalLine = ema(macdLine, signalPeriod);
  const histogram: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    histogram.push(macdLine[i] - signalLine[i]);
  }

  return { macd: macdLine, signal: signalLine, histogram };
}

/**
 * Bollinger Bands
 */
export type BollingerResult = {
  upper: number[];
  middle: number[];
  lower: number[];
  bandwidth: number[];
  percentB: number[]; // %B indicator (0 = at lower, 1 = at upper)
};

export function bollingerBands(
  closes: number[],
  period: number = 20,
  stdDev: number = 2
): BollingerResult {
  const middle = sma(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];
  const bandwidth: number[] = [];
  const percentB: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (isNaN(middle[i])) {
      upper.push(NaN);
      lower.push(NaN);
      bandwidth.push(NaN);
      percentB.push(NaN);
      continue;
    }

    // Calculate standard deviation
    const start = Math.max(0, i - period + 1);
    const slice = closes.slice(start, i + 1);
    const mean = middle[i];
    const variance = slice.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / slice.length;
    const sd = Math.sqrt(variance);

    const u = mean + stdDev * sd;
    const l = mean - stdDev * sd;
    upper.push(u);
    lower.push(l);
    bandwidth.push(mean > 0 ? ((u - l) / mean) * 100 : 0);
    percentB.push(u - l > 0 ? (closes[i] - l) / (u - l) : 0.5);
  }

  return { upper, middle, lower, bandwidth, percentB };
}

/**
 * Average True Range
 */
export function atr(candles: CandlestickData[], period: number = 14): number[] {
  const result: number[] = new Array(candles.length).fill(NaN);
  if (candles.length < 2) return result;

  const trValues: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    trValues.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }

  // Initial ATR = SMA of first `period` TR values
  if (trValues.length >= period) {
    let sum = 0;
    for (let i = 0; i < period; i++) sum += trValues[i];
    result[period - 1] = sum / period;

    // Smoothed ATR
    for (let i = period; i < trValues.length; i++) {
      result[i] = (result[i - 1] * (period - 1) + trValues[i]) / period;
    }
  }

  return result;
}

/**
 * Stochastic RSI
 */
export type StochRSIResult = {
  k: number[];
  d: number[];
};

export function stochRSI(
  closes: number[],
  rsiPeriod: number = 14,
  stochPeriod: number = 14,
  kSmoothing: number = 3,
  dSmoothing: number = 3
): StochRSIResult {
  const rsiValues = rsi(closes, rsiPeriod);
  const k: number[] = new Array(closes.length).fill(NaN);

  // Stochastic of RSI
  for (let i = stochPeriod - 1; i < rsiValues.length; i++) {
    const slice = rsiValues.slice(i - stochPeriod + 1, i + 1).filter(v => !isNaN(v));
    if (slice.length < stochPeriod) continue;
    const min = Math.min(...slice);
    const max = Math.max(...slice);
    k[i] = max - min === 0 ? 50 : ((rsiValues[i] - min) / (max - min)) * 100;
  }

  // Smooth K
  const smoothedK = smaOfSparse(k, kSmoothing);
  // D is SMA of smoothed K
  const d = smaOfSparse(smoothedK, dSmoothing);

  return { k: smoothedK, d };
}

/** SMA that handles NaN values */
function smaOfSparse(values: number[], period: number): number[] {
  const result: number[] = new Array(values.length).fill(NaN);
  let sum = 0;
  let count = 0;

  for (let i = 0; i < values.length; i++) {
    if (!isNaN(values[i])) {
      sum += values[i];
      count++;
    }
    if (i >= period && !isNaN(values[i - period])) {
      sum -= values[i - period];
      count--;
    }
    if (count >= period) {
      result[i] = sum / count;
    }
  }
  return result;
}

/**
 * Volume Weighted Average Price (VWAP) — session-based
 * Since crypto is 24/7, we use a rolling window
 */
export function vwap(candles: CandlestickData[], period: number = 50): number[] {
  const result: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const start = Math.max(0, i - period + 1);
    const slice = candles.slice(start, i + 1);
    let vwapTPV = 0;
    let vwapVol = 0;
    for (const c of slice) {
      const tp = (c.high + c.low + c.close) / 3;
      // Use range as volume proxy when no volume data
      const vol = c.high - c.low || 1;
      vwapTPV += tp * vol;
      vwapVol += vol;
    }
    result.push(vwapVol > 0 ? vwapTPV / vwapVol : candles[i].close);
  }
  return result;
}

/**
 * On-Balance Volume proxy (using candle range as volume)
 */
export function obv(candles: CandlestickData[]): number[] {
  const result: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const vol = candles[i].high - candles[i].low || 1;
    if (candles[i].close > candles[i - 1].close) {
      result.push(result[i - 1] + vol);
    } else if (candles[i].close < candles[i - 1].close) {
      result.push(result[i - 1] - vol);
    } else {
      result.push(result[i - 1]);
    }
  }
  return result;
}

/**
 * Average Directional Index (ADX)
 */
export type ADXResult = {
  adx: number[];
  plusDI: number[];
  minusDI: number[];
};

export function adx(candles: CandlestickData[], period: number = 14): ADXResult {
  const n = candles.length;
  const plusDI: number[] = new Array(n).fill(NaN);
  const minusDI: number[] = new Array(n).fill(NaN);
  const adxArr: number[] = new Array(n).fill(NaN);

  if (n < period * 2) return { adx: adxArr, plusDI, minusDI };

  // Calculate +DM, -DM, TR
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  const trArr: number[] = [candles[0].high - candles[0].low];

  for (let i = 1; i < n; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    trArr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }

  // Smooth using Wilder's method
  let smoothPlusDM = 0, smoothMinusDM = 0, smoothTR = 0;
  for (let i = 0; i < period; i++) {
    smoothPlusDM += plusDM[i];
    smoothMinusDM += minusDM[i];
    smoothTR += trArr[i];
  }

  for (let i = period; i < n; i++) {
    smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[i];
    smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[i];
    smoothTR = smoothTR - smoothTR / period + trArr[i];

    const pdi = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
    const mdi = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
    plusDI[i] = pdi;
    minusDI[i] = mdi;

    const diSum = pdi + mdi;
    const dx = diSum > 0 ? (Math.abs(pdi - mdi) / diSum) * 100 : 0;

    if (i === period * 2 - 1) {
      // First ADX = average of first `period` DX values
      let dxSum = 0;
      let dxCount = 0;
      for (let j = period; j <= i; j++) {
        const pdi2 = plusDI[j];
        const mdi2 = minusDI[j];
        if (!isNaN(pdi2) && !isNaN(mdi2)) {
          const s = pdi2 + mdi2;
          dxSum += s > 0 ? (Math.abs(pdi2 - mdi2) / s) * 100 : 0;
          dxCount++;
        }
      }
      adxArr[i] = dxCount > 0 ? dxSum / dxCount : 0;
    } else if (i > period * 2 - 1 && !isNaN(adxArr[i - 1])) {
      adxArr[i] = (adxArr[i - 1] * (period - 1) + dx) / period;
    }
  }

  return { adx: adxArr, plusDI, minusDI };
}

/**
 * Rate of Change (ROC)
 */
export function roc(values: number[], period: number = 10): number[] {
  const result: number[] = new Array(values.length).fill(NaN);
  for (let i = period; i < values.length; i++) {
    if (values[i - period] !== 0) {
      result[i] = ((values[i] - values[i - period]) / values[i - period]) * 100;
    }
  }
  return result;
}

/**
 * Commodity Channel Index (CCI)
 */
export function cci(candles: CandlestickData[], period: number = 20): number[] {
  const result: number[] = new Array(candles.length).fill(NaN);
  const tp: number[] = candles.map(c => (c.high + c.low + c.close) / 3);

  for (let i = period - 1; i < candles.length; i++) {
    const slice = tp.slice(i - period + 1, i + 1);
    const mean = slice.reduce((s, v) => s + v, 0) / period;
    const meanDev = slice.reduce((s, v) => s + Math.abs(v - mean), 0) / period;
    result[i] = meanDev !== 0 ? (tp[i] - mean) / (0.015 * meanDev) : 0;
  }
  return result;
}

// ─── Composite Indicator Snapshot ────────────────────────────────────────────

export type IndicatorSnapshot = {
  rsi: number;
  macd: { value: number; signal: number; histogram: number };
  bollingerBands: { upper: number; middle: number; lower: number; percentB: number; bandwidth: number };
  atr: number;
  atrPct: number; // ATR as % of price
  stochRSI: { k: number; d: number };
  adx: { value: number; plusDI: number; minusDI: number };
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  roc: number;
  cci: number;
  obv: number;
  obvTrend: 'rising' | 'falling' | 'flat';
  vwap: number;
  priceVsVwap: number; // % above/below VWAP
};

/**
 * Calculate all indicators at the current bar
 */
export function calculateIndicatorSnapshot(candles: CandlestickData[]): IndicatorSnapshot | null {
  if (candles.length < 50) return null;

  const closes = candles.map(c => c.close);
  const last = candles.length - 1;
  const currentPrice = closes[last];

  // RSI
  const rsiValues = rsi(closes, 14);
  const currentRSI = rsiValues[last] ?? 50;

  // MACD
  const macdResult = macd(closes, 12, 26, 9);
  const currentMACD = {
    value: macdResult.macd[last] ?? 0,
    signal: macdResult.signal[last] ?? 0,
    histogram: macdResult.histogram[last] ?? 0,
  };

  // Bollinger Bands
  const bbResult = bollingerBands(closes, 20, 2);
  const currentBB = {
    upper: bbResult.upper[last] ?? currentPrice,
    middle: bbResult.middle[last] ?? currentPrice,
    lower: bbResult.lower[last] ?? currentPrice,
    percentB: bbResult.percentB[last] ?? 0.5,
    bandwidth: bbResult.bandwidth[last] ?? 0,
  };

  // ATR
  const atrValues = atr(candles, 14);
  const currentATR = atrValues[last] ?? 0;
  const atrPct = currentPrice > 0 ? (currentATR / currentPrice) * 100 : 0;

  // Stochastic RSI
  const stochResult = stochRSI(closes, 14, 14, 3, 3);
  const currentStochRSI = {
    k: stochResult.k[last] ?? 50,
    d: stochResult.d[last] ?? 50,
  };

  // ADX
  const adxResult = adx(candles, 14);
  const currentADX = {
    value: adxResult.adx[last] ?? 0,
    plusDI: adxResult.plusDI[last] ?? 0,
    minusDI: adxResult.minusDI[last] ?? 0,
  };

  // EMAs
  const ema9Values = ema(closes, 9);
  const ema21Values = ema(closes, 21);
  const ema50Values = ema(closes, 50);
  const ema200Values = ema(closes, 200);

  // ROC
  const rocValues = roc(closes, 10);
  const currentROC = rocValues[last] ?? 0;

  // CCI
  const cciValues = cci(candles, 20);
  const currentCCI = cciValues[last] ?? 0;

  // OBV
  const obvValues = obv(candles);
  const currentOBV = obvValues[last] ?? 0;
  const obvSma = obvValues.length >= 10
    ? obvValues.slice(-10).reduce((s, v) => s + v, 0) / 10
    : currentOBV;
  const obvTrend: 'rising' | 'falling' | 'flat' =
    currentOBV > obvSma * 1.02 ? 'rising'
    : currentOBV < obvSma * 0.98 ? 'falling'
    : 'flat';

  // VWAP
  const vwapValues = vwap(candles, 50);
  const currentVWAP = vwapValues[last] ?? currentPrice;
  const priceVsVwap = currentVWAP > 0
    ? ((currentPrice - currentVWAP) / currentVWAP) * 100
    : 0;

  return {
    rsi: currentRSI,
    macd: currentMACD,
    bollingerBands: currentBB,
    atr: currentATR,
    atrPct,
    stochRSI: currentStochRSI,
    adx: currentADX,
    ema9: ema9Values[last] ?? currentPrice,
    ema21: ema21Values[last] ?? currentPrice,
    ema50: ema50Values[last] ?? currentPrice,
    ema200: ema200Values[last] ?? currentPrice,
    roc: currentROC,
    cci: currentCCI,
    obv: currentOBV,
    obvTrend,
    vwap: currentVWAP,
    priceVsVwap,
  };
}

