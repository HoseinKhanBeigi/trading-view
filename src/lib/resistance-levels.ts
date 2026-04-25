import type { CandlestickData } from "lightweight-charts";
import { atr } from "./indicators";
import { detectSwingPoints } from "./price-action";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ResistanceLevel = {
  price: number;
  zone: { high: number; low: number };
  strength: number;
  touches: number;
  atrDistance: number;
  atrAtLevel: number;
  source: "swing";
  firstIndex: number;
  lastIndex: number;
  broken: boolean;
};

export type SupportLevel = {
  price: number;
  zone: { high: number; low: number };
  strength: number;
  touches: number;
  atrDistance: number;
  atrAtLevel: number;
  source: "swing";
  firstIndex: number;
  lastIndex: number;
  broken: boolean;
};

export type ResistanceLevelsResult = {
  resistance: ResistanceLevel[];
  support: SupportLevel[];
  atr: number;
  atrPeriod: number;
  currentPrice: number;
};

export type ResistanceLevelsOptions = {
  atrPeriod?: number;
  swingLeftBars?: number;
  swingRightBars?: number;
  /** Min swing size in ATR multiples to count as significant (default 0.3) */
  minSwingATR?: number;
  /** Merge levels within this ATR multiple (default 0.5) */
  mergeATR?: number;
  /** Zone half-width in ATR multiples (default 0.5) */
  zoneATR?: number;
  /** Max number of resistance levels to return (default 10) */
  maxResistance?: number;
  /** Max number of support levels to return (default 10) */
  maxSupport?: number;
};

const DEFAULT_OPTIONS: Required<ResistanceLevelsOptions> = {
  atrPeriod: 14,
  swingLeftBars: 3,
  swingRightBars: 3,
  minSwingATR: 0.3,
  mergeATR: 0.5,
  zoneATR: 0.5,
  maxResistance: 10,
  maxSupport: 10,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mergeLevels(
  prices: number[],
  atrAtMerge: number,
  mergeMultiplier: number,
  zoneMultiplier: number,
  currentPrice: number,
  type: "resistance" | "support"
): { price: number; zone: { high: number; low: number }; touches: number }[] {
  if (prices.length === 0) return [];
  const threshold = atrAtMerge * mergeMultiplier;
  const halfZone = atrAtMerge * zoneMultiplier;

  const sorted = [...prices].sort((a, b) => a - b);
  const clusters: number[][] = [];
  let cluster: number[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i];
    const prev = cluster[cluster.length - 1];
    if (p - prev <= threshold) {
      cluster.push(p);
    } else {
      clusters.push(cluster);
      cluster = [p];
    }
  }
  clusters.push(cluster);

  return clusters.map((cluster) => {
    const price = cluster.reduce((s, x) => s + x, 0) / cluster.length;
    return {
      price,
      zone: { high: price + halfZone, low: price - halfZone },
      touches: cluster.length,
    };
  });
}

function scoreStrength(
  touches: number,
  distanceFromPrice: number,
  atrVal: number,
  type: "resistance" | "support"
): number {
  const touchScore = Math.min(50, touches * 12);
  const atrDist = atrVal > 0 ? distanceFromPrice / atrVal : 0;
  const proximityScore = atrDist <= 2 ? 30 : atrDist <= 5 ? 15 : 0;
  return Math.min(100, Math.round(touchScore + proximityScore + 20));
}

// ─── Main API ───────────────────────────────────────────────────────────────

/**
 * Identifies resistance and support levels from swing points, using ATR for:
 * - Filtering significant swings (min size in ATR)
 * - Merging nearby levels (within ATR * mergeATR)
 * - Zone width (level ± ATR * zoneATR)
 * - Distance from current price in ATR units
 */
export function identifyResistanceLevels(
  candles: CandlestickData[],
  options: ResistanceLevelsOptions = {}
): ResistanceLevelsResult | null {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (candles.length < opts.atrPeriod + opts.swingLeftBars + opts.swingRightBars + 1) {
    return null;
  }

  const atrValues = atr(candles, opts.atrPeriod);
  const last = candles.length - 1;
  const currentPrice = candles[last].close;
  const currentATR = atrValues[last];
  if (currentATR <= 0 || !Number.isFinite(currentATR)) {
    return null;
  }

  const swings = detectSwingPoints(
    candles,
    opts.swingLeftBars,
    opts.swingRightBars
  );

  const swingHighs = swings.filter((s) => s.type === "high");
  const swingLows = swings.filter((s) => s.type === "low");

  const resistancePrices: number[] = [];
  const supportPrices: number[] = [];

  for (const s of swingHighs) {
    const candle = candles[s.index];
    const range = candle.high - (candle.low ?? candle.high);
    const atrAtSwing = atrValues[s.index];
    if (atrAtSwing > 0 && range >= atrAtSwing * opts.minSwingATR) {
      resistancePrices.push(s.price);
    } else if (opts.minSwingATR <= 0) {
      resistancePrices.push(s.price);
    }
  }

  for (const s of swingLows) {
    const candle = candles[s.index];
    const range = (candle.high ?? candle.low) - candle.low;
    const atrAtSwing = atrValues[s.index];
    if (atrAtSwing > 0 && range >= atrAtSwing * opts.minSwingATR) {
      supportPrices.push(s.price);
    } else if (opts.minSwingATR <= 0) {
      supportPrices.push(s.price);
    }
  }

  const mergedResistance = mergeLevels(
    resistancePrices.filter((p) => p > currentPrice),
    currentATR,
    opts.mergeATR,
    opts.zoneATR,
    currentPrice,
    "resistance"
  );

  const mergedSupport = mergeLevels(
    supportPrices.filter((p) => p < currentPrice),
    currentATR,
    opts.mergeATR,
    opts.zoneATR,
    currentPrice,
    "support"
  );

  const resistance: ResistanceLevel[] = mergedResistance
    .map((m) => {
      const distance = m.price - currentPrice;
      const atrDist = currentATR > 0 ? distance / currentATR : 0;
      const broken = currentPrice > m.zone.high;
      return {
        price: m.price,
        zone: m.zone,
        strength: scoreStrength(m.touches, distance, currentATR, "resistance"),
        touches: m.touches,
        atrDistance: atrDist,
        atrAtLevel: currentATR,
        source: "swing" as const,
        firstIndex: last,
        lastIndex: last,
        broken,
      };
    })
    .filter((r) => !r.broken)
    .sort((a, b) => a.price - b.price)
    .slice(0, opts.maxResistance);

  const support: SupportLevel[] = mergedSupport
    .map((m) => {
      const distance = currentPrice - m.price;
      const atrDist = currentATR > 0 ? distance / currentATR : 0;
      const broken = currentPrice < m.zone.low;
      return {
        price: m.price,
        zone: m.zone,
        strength: scoreStrength(m.touches, distance, currentATR, "support"),
        touches: m.touches,
        atrDistance: atrDist,
        atrAtLevel: currentATR,
        source: "swing" as const,
        firstIndex: last,
        lastIndex: last,
        broken,
      };
    })
    .filter((s) => !s.broken)
    .sort((a, b) => b.price - a.price)
    .slice(0, opts.maxSupport);

  return {
    resistance,
    support,
    atr: currentATR,
    atrPeriod: opts.atrPeriod,
    currentPrice,
  };
}
