import type { OrderBook } from "./orderbook";

export type OrderBookSnapshot = {
  timestamp: number;
  book: OrderBook;
  bidVolume: number;
  askVolume: number;
  bidNotional: number; // total value of bids
  askNotional: number; // total value of asks
};

export type StrengthMetrics = {
  timeframe: '10s' | '30s' | '1m';
  bidStrength: number; // 0-100, where >50 means stronger bids
  askStrength: number; // 0-100, where >50 means stronger asks
  volumeImbalance: number; // bidVolume - askVolume
  notionalImbalance: number; // bidNotional - askNotional
  avgBidNotional: number; // average bid notional value in USD
  avgAskNotional: number; // average ask notional value in USD
  dominantSide: 'bid' | 'ask' | 'neutral';
  strengthPercent: number; // how strong the dominant side is (0-100)
};

export type PredictionMetrics = Omit<StrengthMetrics, 'timeframe'> & {
  timeframe: '1m' | '3m' | '5m';
  confidence: number; // 0-100, prediction confidence level
  trend: 'increasing' | 'decreasing' | 'stable'; // trend direction
};

/**
 * Calculate total volume and notional for a side of the order book
 */
function calculateSideMetrics(levels: { price: number; size: number }[], topN: number = 20): { volume: number; notional: number } {
  const top = levels.slice(0, topN);
  let volume = 0;
  let notional = 0;
  for (const level of top) {
    volume += level.size;
    notional += level.price * level.size;
  }
  return { volume, notional };
}

/**
 * Create a snapshot from an order book
 */
export function createSnapshot(book: OrderBook): OrderBookSnapshot {
  const bidMetrics = calculateSideMetrics(book.bids, 20);
  const askMetrics = calculateSideMetrics(book.asks, 20);
  
  return {
    timestamp: Date.now(),
    book,
    bidVolume: bidMetrics.volume,
    askVolume: askMetrics.volume,
    bidNotional: bidMetrics.notional,
    askNotional: askMetrics.notional,
  };
}

/**
 * Calculate strength metrics for a given timeframe
 */
export function calculateStrength(
  snapshots: OrderBookSnapshot[],
  timeframeMs: number
): StrengthMetrics | null {
  if (snapshots.length === 0) return null;

  const now = Date.now();
  const cutoff = now - timeframeMs;
  const relevant = snapshots.filter(s => s.timestamp >= cutoff);

  if (relevant.length === 0) return null;

  // Calculate average volumes and notional values
  let totalBidVolume = 0;
  let totalAskVolume = 0;
  let totalBidNotional = 0;
  let totalAskNotional = 0;

  for (const snap of relevant) {
    totalBidVolume += snap.bidVolume;
    totalAskVolume += snap.askVolume;
    totalBidNotional += snap.bidNotional;
    totalAskNotional += snap.askNotional;
  }

  const count = relevant.length;
  const avgBidVolume = totalBidVolume / count;
  const avgAskVolume = totalAskVolume / count;
  const avgBidNotional = totalBidNotional / count;
  const avgAskNotional = totalAskNotional / count;

  // Calculate volume imbalance
  const volumeImbalance = avgBidVolume - avgAskVolume;
  const notionalImbalance = avgBidNotional - avgAskNotional;

  // Calculate total volume for normalization
  const totalVolume = avgBidVolume + avgAskVolume;
  const totalNotional = avgBidNotional + avgAskNotional;

  // Calculate strength percentages (0-100)
  const bidStrength = totalVolume > 0 
    ? (avgBidVolume / totalVolume) * 100 
    : 50;
  const askStrength = totalVolume > 0 
    ? (avgAskVolume / totalVolume) * 100 
    : 50;

  // Determine dominant side based on volume and notional imbalance
  // Use a weighted approach: 70% volume, 30% notional (normalized)
  const volumeDiff = avgBidVolume - avgAskVolume;
  const notionalDiffPercent = totalNotional > 0 
    ? ((avgBidNotional - avgAskNotional) / totalNotional) * 100 
    : 0;
  
  // Normalize volume diff to percentage
  const volumeDiffPercent = totalVolume > 0 
    ? (volumeDiff / totalVolume) * 100 
    : 0;
  
  // Combined strength score (-100 to +100, where positive = bid stronger)
  const combinedStrength = volumeDiffPercent * 0.7 + notionalDiffPercent * 0.3;

  let dominantSide: 'bid' | 'ask' | 'neutral';
  let strengthPercent: number;

  // Consider neutral if strength is within 2% (very balanced)
  if (Math.abs(combinedStrength) < 2) {
    dominantSide = 'neutral';
    strengthPercent = 0;
  } else if (combinedStrength > 0) {
    dominantSide = 'bid';
    // Strength percent is how much stronger bids are (0-100)
    strengthPercent = Math.min(100, Math.abs(combinedStrength));
  } else {
    dominantSide = 'ask';
    // Strength percent is how much stronger asks are (0-100)
    strengthPercent = Math.min(100, Math.abs(combinedStrength));
  }

  const timeframeLabel = timeframeMs === 10000 ? '10s' : timeframeMs === 30000 ? '30s' : '1m';

  return {
    timeframe: timeframeLabel,
    bidStrength,
    askStrength,
    volumeImbalance,
    notionalImbalance,
    avgBidNotional: avgBidNotional,
    avgAskNotional: avgAskNotional,
    dominantSide,
    strengthPercent: Math.min(100, Math.max(0, strengthPercent)),
  };
}

/**
 * Maintain a rolling window of order book snapshots
 */
export class OrderBookStrengthTracker {
  private snapshots: OrderBookSnapshot[] = [];
  private readonly maxAge = 120000; // Keep 2 minutes of data
  private lastUpdate: number = 0;

  addSnapshot(book: OrderBook): void {
    const snapshot = createSnapshot(book);
    this.snapshots.push(snapshot);
    this.cleanup();
  }

  private cleanup(): void {
    const now = Date.now();
    this.snapshots = this.snapshots.filter(s => now - s.timestamp <= this.maxAge);
  }

  getStrength10s(): StrengthMetrics | null {
    return calculateStrength(this.snapshots, 10000);
  }

  getStrength30s(): StrengthMetrics | null {
    return calculateStrength(this.snapshots, 30000);
  }

  getStrength1m(): StrengthMetrics | null {
    return calculateStrength(this.snapshots, 60000);
  }

  clear(): void {
    this.snapshots = [];
    this.lastUpdate = 0;
  }

  shouldUpdate(): boolean {
    const now = Date.now();
    if (now - this.lastUpdate > 500) {
      this.lastUpdate = now;
      return true;
    }
    return false;
  }

  /**
   * Get historical metrics for trend analysis
   */
  private getHistoricalMetrics(): Array<{ timestamp: number; bidStrength: number; askStrength: number; bidNotional: number; askNotional: number }> {
    const now = Date.now();
    const historical: Array<{ timestamp: number; bidStrength: number; askStrength: number; bidNotional: number; askNotional: number }> = [];
    
    // Get metrics at different time points (every 10 seconds for last 2 minutes)
    for (let i = 120; i >= 10; i -= 10) {
      const cutoff = now - (i * 1000);
      const relevant = this.snapshots.filter(s => s.timestamp >= cutoff && s.timestamp <= cutoff + 5000);
      if (relevant.length > 0) {
        let totalBidVol = 0, totalAskVol = 0, totalBidNot = 0, totalAskNot = 0;
        for (const snap of relevant) {
          totalBidVol += snap.bidVolume;
          totalAskVol += snap.askVolume;
          totalBidNot += snap.bidNotional;
          totalAskNot += snap.askNotional;
        }
        const count = relevant.length;
        const avgBidVol = totalBidVol / count;
        const avgAskVol = totalAskVol / count;
        const totalVol = avgBidVol + avgAskVol;
        const bidStrength = totalVol > 0 ? (avgBidVol / totalVol) * 100 : 50;
        const askStrength = totalVol > 0 ? (avgAskVol / totalVol) * 100 : 50;
        
        historical.push({
          timestamp: cutoff,
          bidStrength,
          askStrength,
          bidNotional: totalBidNot / count,
          askNotional: totalAskNot / count,
        });
      }
    }
    return historical;
  }

  /**
   * Simple linear regression for trend prediction
   */
  private linearRegression(
    points: Array<{ x: number; y: number }>
  ): { slope: number; intercept: number; r2: number } {
    if (points.length < 2) {
      return { slope: 0, intercept: points[0]?.y || 0, r2: 0 };
    }

    const n = points.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    for (const p of points) {
      sumX += p.x;
      sumY += p.y;
      sumXY += p.x * p.y;
      sumX2 += p.x * p.x;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate R² for confidence
    let ssRes = 0, ssTot = 0;
    const meanY = sumY / n;
    for (const p of points) {
      const predicted = slope * p.x + intercept;
      ssRes += Math.pow(p.y - predicted, 2);
      ssTot += Math.pow(p.y - meanY, 2);
    }
    const r2 = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;

    return { slope, intercept, r2: Math.max(0, Math.min(1, r2)) };
  }

  /**
   * Predict future order book strength based on trends
   */
  getPrediction(predictionMinutes: 1 | 3 | 5): PredictionMetrics | null {
    const current10s = this.getStrength10s();
    const current30s = this.getStrength30s();
    const current1m = this.getStrength1m();

    if (!current10s || !current30s || !current1m) return null;

    const historical = this.getHistoricalMetrics();
    if (historical.length < 3) return null;

    const now = Date.now();
    const predictionMs = predictionMinutes * 60000;

    // Normalize timestamps for regression (use relative time)
    const baseTime = historical[0]?.timestamp || now;
    const historicalBid = historical.map((h, i) => ({
      x: (h.timestamp - baseTime) / 1000, // seconds from base
      y: h.bidStrength,
    }));
    const historicalAsk = historical.map((h, i) => ({
      x: (h.timestamp - baseTime) / 1000,
      y: h.askStrength,
    }));
    const historicalBidNot = historical.map((h, i) => ({
      x: (h.timestamp - baseTime) / 1000,
      y: h.bidNotional,
    }));
    const historicalAskNot = historical.map((h, i) => ({
      x: (h.timestamp - baseTime) / 1000,
      y: h.askNotional,
    }));

    // Calculate trends
    const bidTrend = this.linearRegression(historicalBid);
    const askTrend = this.linearRegression(historicalAsk);
    const bidNotTrend = this.linearRegression(historicalBidNot);
    const askNotTrend = this.linearRegression(historicalAskNot);

    // Predict future values
    const futureTime = predictionMs / 1000; // seconds from base
    const predictedBidStrength = Math.max(0, Math.min(100, bidTrend.slope * futureTime + bidTrend.intercept));
    const predictedAskStrength = Math.max(0, Math.min(100, askTrend.slope * futureTime + askTrend.intercept));
    const predictedBidNotional = Math.max(0, bidNotTrend.slope * futureTime + bidNotTrend.intercept);
    const predictedAskNotional = Math.max(0, askNotTrend.slope * futureTime + askNotTrend.intercept);

    // Calculate confidence based on R² and data quality
    const avgR2 = (bidTrend.r2 + askTrend.r2 + bidNotTrend.r2 + askNotTrend.r2) / 4;
    const dataQuality = Math.min(1, historical.length / 12); // More data = higher quality
    const confidence = Math.round(avgR2 * dataQuality * 100);

    // Determine trend direction
    const strengthDiff = predictedBidStrength - predictedAskStrength;
    const currentDiff = current1m.bidStrength - current1m.askStrength;
    const trendDirection = Math.abs(strengthDiff - currentDiff) < 1 
      ? 'stable' 
      : strengthDiff > currentDiff 
        ? 'increasing' 
        : 'decreasing';

    // Normalize to ensure they sum to 100
    const totalStrength = predictedBidStrength + predictedAskStrength;
    const normalizedBid = totalStrength > 0 ? (predictedBidStrength / totalStrength) * 100 : 50;
    const normalizedAsk = totalStrength > 0 ? (predictedAskStrength / totalStrength) * 100 : 50;

    // Calculate combined strength for dominant side
    const volumeDiffPercent = normalizedBid - normalizedAsk;
    const notionalDiff = predictedBidNotional - predictedAskNotional;
    const totalNotional = predictedBidNotional + predictedAskNotional;
    const notionalDiffPercent = totalNotional > 0 ? (notionalDiff / totalNotional) * 100 : 0;
    const combinedStrength = volumeDiffPercent * 0.7 + notionalDiffPercent * 0.3;

    let dominantSide: 'bid' | 'ask' | 'neutral';
    let strengthPercent: number;

    if (Math.abs(combinedStrength) < 2) {
      dominantSide = 'neutral';
      strengthPercent = 0;
    } else if (combinedStrength > 0) {
      dominantSide = 'bid';
      strengthPercent = Math.min(100, Math.abs(combinedStrength));
    } else {
      dominantSide = 'ask';
      strengthPercent = Math.min(100, Math.abs(combinedStrength));
    }

    return {
      timeframe: `${predictionMinutes}m` as '1m' | '3m' | '5m',
      bidStrength: normalizedBid,
      askStrength: normalizedAsk,
      volumeImbalance: 0, // Not meaningful for predictions
      notionalImbalance: notionalDiff,
      avgBidNotional: predictedBidNotional,
      avgAskNotional: predictedAskNotional,
      dominantSide,
      strengthPercent: Math.min(100, Math.max(0, strengthPercent)),
      confidence: Math.max(0, Math.min(100, confidence)),
      trend: trendDirection,
    };
  }

  getPrediction1m(): PredictionMetrics | null {
    return this.getPrediction(1);
  }

  getPrediction3m(): PredictionMetrics | null {
    return this.getPrediction(3);
  }

  getPrediction5m(): PredictionMetrics | null {
    return this.getPrediction(5);
  }
}

