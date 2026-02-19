import type { CandlestickData } from "lightweight-charts";
import type { Trade } from "@/store/types";
import { calculateIndicatorSnapshot, type IndicatorSnapshot } from "./indicators";
import {
  analyzePriceAction,
  type PriceActionAnalysis,
  type SwingPoint,
  type StructureBreak,
  type FairValueGap,
  type LiquiditySweep,
  type EqualLevel,
} from "./price-action";
import { detectOrderBlocks, getActiveOrderBlocks, type OrderBlock } from "./order-blocks";
import type { OrderBook, BookLevel } from "./orderbook";
import { identifySupportResistance, type SupportResistanceLevel } from "./orderbook";
import {
  analyzeShadows,
  type ShadowAnalysisResult,
  type ShadowPattern,
  type ShadowClusterZone,
  type StopHuntEvent,
} from "./shadow-analysis";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Order Flow ──────────────────────────────────────────────────────────────

export type OrderFlowAnalysis = {
  cvd: number;                        // Cumulative Volume Delta
  cvdTrend: 'rising' | 'falling' | 'flat';
  deltaPerCandle: number[];           // Delta per recent candle
  buyPressure: number;                // 0-100
  sellPressure: number;               // 0-100
  netFlow: 'buying' | 'selling' | 'neutral';
  aggressiveSide: 'buyers' | 'sellers' | 'balanced';
  largeOrderCount: number;            // whale trade count in window
  largeOrderBias: 'buy' | 'sell' | 'neutral';
  tradeVelocity: number;             // trades per second
  volumeProfile: VolumeNode[];        // volume at price levels
  absorptionDetected: boolean;        // large orders being absorbed
  absorptionSide: 'bid' | 'ask' | null;
  score: number;                      // -100 (max sell) to +100 (max buy)
};

export type VolumeNode = {
  price: number;
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
  delta: number;                      // buy - sell
  isHighVolume: boolean;              // POC (Point of Control) or HVN
};

// ─── Liquidity ───────────────────────────────────────────────────────────────

export type LiquidityAnalysis = {
  zones: LiquidityZone[];             // Active liquidity zones
  nearestSupport: LiquidityZone | null;
  nearestResistance: LiquidityZone | null;
  liquidityPools: LiquidityPool[];    // equal highs/lows pools
  imbalanceZones: ImbalanceZone[];    // order book imbalance areas
  sweepEvents: SweepEvent[];          // recent liquidity sweeps
  currentLiquidityBias: 'above' | 'below' | 'balanced'; // where is more liquidity
  score: number;                      // -100 to +100 (positive = bullish setup)
};

export type LiquidityZone = {
  priceHigh: number;
  priceLow: number;
  midPrice: number;
  type: 'support' | 'resistance';
  strength: number;                   // 0-100
  source: 'orderbook' | 'orderblock' | 'swing' | 'fvg' | 'equal-level';
  touches: number;
  lastTouch: number;
  active: boolean;
};

export type LiquidityPool = {
  price: number;
  type: 'buy-side' | 'sell-side';
  size: number;                       // estimated liquidity size
  touches: number;
  swept: boolean;
};

export type ImbalanceZone = {
  priceLevel: number;
  bidSize: number;
  askSize: number;
  ratio: number;                      // bid/ask ratio (>1 = more bids)
  type: 'bid-heavy' | 'ask-heavy';
  strength: 'weak' | 'medium' | 'strong';
};

export type SweepEvent = {
  price: number;
  type: 'buy-side' | 'sell-side';
  recovered: boolean;
  time: number;
  strength: 'weak' | 'medium' | 'strong';
};

// ─── Market Structure ────────────────────────────────────────────────────────

export type MarketStructureAnalysis = {
  trend: 'bullish' | 'bearish' | 'ranging';
  trendStrength: number;              // 0-100
  phase: 'accumulation' | 'markup' | 'distribution' | 'markdown' | 'unknown';
  recentBOS: StructureBreak[];
  recentCHoCH: StructureBreak[];
  mssDetected: boolean;               // Market Structure Shift
  mssDirection: 'bullish' | 'bearish' | null;
  premiumDiscount: 'premium' | 'discount' | 'equilibrium';
  equilibriumPrice: number;
  pointsOfInterest: PointOfInterest[];
  fibLevels: { level: number; price: number; label: string }[];
  score: number;                      // -100 to +100
};

export type PointOfInterest = {
  price: number;
  type: 'order-block' | 'fvg' | 'breaker' | 'liquidity-void' | 'swing-level';
  direction: 'bullish' | 'bearish';
  strength: number;                   // 0-100
  reason: string;
};

// ─── Systematic Execution ────────────────────────────────────────────────────

export type ExecutionAnalysis = {
  checklist: ChecklistItem[];
  passedCount: number;
  totalChecks: number;
  passRate: number;                   // 0-100
  setupGrade: 'A+' | 'A' | 'B' | 'C' | 'NO-TRADE';
  confluenceScore: number;            // 0-100 weighted
  direction: 'LONG' | 'SHORT' | 'WAIT';
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  riskReward: number;
  invalidationPrice: number;          // price that invalidates the setup
  timeInForce: 'GTC' | 'IOC' | 'SESSION'; // how long signal is valid
  reasons: string[];
  warnings: string[];
};

export type ChecklistItem = {
  id: string;
  category: 'order-flow' | 'liquidity' | 'structure' | 'execution' | 'risk';
  label: string;
  passed: boolean;
  weight: number;                     // importance 1-5
  detail: string;
};

// ─── Risk Management ─────────────────────────────────────────────────────────

export type PropComplianceRule = {
  id: string;
  label: string;
  passed: boolean;
  current: string;
  limit: string;
  severity: 'ok' | 'warning' | 'danger' | 'violated';
  pctUsed: number;                    // 0-100, how close to limit
};

export type PropCompliance = {
  rules: PropComplianceRule[];
  overallStatus: 'compliant' | 'warning' | 'violated';
  profitTarget: number;              // $ amount to reach
  profitTargetPct: number;           // % target
  currentProfitPct: number;          // current % toward target
  progressToTarget: number;          // 0-100%
  trailingDrawdownLevel: number;     // trailing DD high water mark $
  trailingDrawdownPct: number;       // current trailing DD %
  daysTraded: number;
  minDaysRequired: number;
  maxDaysAllowed: number;            // 0 = unlimited
  daysRemaining: number;             // -1 = unlimited
  consistencyScore: number;          // 0-100 (100 = perfectly consistent)
  maxSingleTradePct: number;         // largest single trade as % of total profit
  profitSplit: number;               // % trader keeps
  estimatedPayout: number;           // $ estimated payout at current profit
  accountHealth: number;             // 0-100 composite score
};

export type RiskAnalysis = {
  positionSize: number;               // contracts/units
  positionNotional: number;           // USD value
  riskAmount: number;                 // USD at risk
  riskPercent: number;                // % of capital
  rewardAmount: number;               // USD reward at TP1
  rewardPercent: number;
  kellyFraction: number;              // Kelly criterion optimal fraction
  adjustedKelly: number;              // Half-Kelly (safer)
  drawdownCurrent: number;            // current drawdown %
  drawdownMax: number;                // max allowed drawdown
  heatIndex: number;                  // 0-100 (100 = max risk exposure)
  shouldReduceSize: boolean;
  sizeMultiplier: number;             // 0.25-1.5 based on performance
  consecutiveLosses: number;
  consecutiveWins: number;
  recentWinRate: number;              // last N trades win rate
  dailyPnl: number;
  dailyPnlPct: number;
  shouldStop: boolean;
  stopReason: string | null;
  trailingStopPrice: number | null;
  partialTPs: PartialTP[];
  // Prop firm compliance
  propCompliance: PropCompliance | null;
};

export type PartialTP = {
  price: number;
  percent: number;                    // % of position to close
  label: string;
};

// ─── Master Strategy Output ──────────────────────────────────────────────────

// ─── Multi-Timeframe ─────────────────────────────────────────────────────────

export type TimeframeBias = {
  tf: string;                           // "1m" | "5m" | "15m" | "1h"
  trend: 'bullish' | 'bearish' | 'neutral';
  strength: number;                     // 0-100
  ema9: number;
  ema21: number;
  rsi: number;
  macdHist: number;
  atr: number;
};

export type MultiTimeframeAnalysis = {
  timeframes: TimeframeBias[];
  alignment: 'aligned-bull' | 'aligned-bear' | 'mixed';
  htfBias: 'bullish' | 'bearish' | 'neutral';  // higher-timeframe consensus
  htfScore: number;                     // -100 to +100
};

// ─── Pending Setups ──────────────────────────────────────────────────────────

export type PendingSetup = {
  id: string;
  type: 'long' | 'short';
  trigger: string;                      // what needs to happen
  entryZone: { low: number; high: number };
  stopLoss: number;
  target1: number;
  target2: number;
  riskReward: number;
  confidence: number;                   // 0-100
  reasons: string[];
  invalidation: string;                 // what kills the setup
};

// ─── Unified Master Signal ───────────────────────────────────────────────────

export type UnifiedSignal = {
  direction: 'STRONG_LONG' | 'LONG' | 'LEAN_LONG' | 'NEUTRAL' | 'LEAN_SHORT' | 'SHORT' | 'STRONG_SHORT';
  conviction: number;                   // 0-100
  summary: string;                      // one-line human-readable summary
  keyLevels: {
    strongSupport: number;
    nearSupport: number;
    currentPrice: number;
    nearResistance: number;
    strongResistance: number;
  };
  pillarSummary: {
    name: string;
    status: 'bullish' | 'bearish' | 'neutral';
    score: number;
    detail: string;
  }[];
  actionAdvice: string;                 // "ENTER LONG at $X" or "WAIT for X"
  pendingSetups: PendingSetup[];
  mtfAlignment: MultiTimeframeAnalysis;
};

// ─── Signal History ──────────────────────────────────────────────────────────

export type SignalHistoryEntry = {
  timestamp: number;
  direction: 'LONG' | 'SHORT' | 'WAIT';
  grade: string;
  price: number;
  entry: number;
  stopLoss: number;
  tp1: number;
  confluenceScore: number;
  expired: boolean;
  reason: string;
};

export type AdvancedStrategyResult = {
  timestamp: number;
  symbol: string;
  orderFlow: OrderFlowAnalysis;
  liquidity: LiquidityAnalysis;
  structure: MarketStructureAnalysis;
  execution: ExecutionAnalysis;
  risk: RiskAnalysis;
  shadows: ShadowAnalysisResult;      // Shadow/wick analysis
  masterScore: number;                // -100 to +100 (composite of all pillars)
  masterDirection: 'LONG' | 'SHORT' | 'WAIT';
  masterGrade: 'A+' | 'A' | 'B' | 'C' | 'NO-TRADE';
  confidence: number;                 // 0-100
  // New unified outputs
  unifiedSignal: UnifiedSignal;
  mtf: MultiTimeframeAnalysis;
};

// ─── Prop Firm Types ─────────────────────────────────────────────────────────

export type PropFirmId = 'none' | 'ftmo' | 'topstep' | 'apex' | 'the-funded-trader' | 'custom';

export type ChallengePhase = 'challenge' | 'verification' | 'funded';

export type PropFirmPreset = {
  id: PropFirmId;
  name: string;
  accountSizes: number[];
  phases: {
    [K in ChallengePhase]: {
      profitTarget: number;           // % of account
      maxDailyLoss: number;           // % of account
      maxTotalDrawdown: number;       // % of account
      trailingDrawdown: boolean;      // does the drawdown trail with equity?
      minTradingDays: number;
      maxTradingDays: number;         // 0 = unlimited
      consistencyRule: number;        // max % of total profit from single trade (0 = none)
      weekendHolding: boolean;        // allowed to hold over weekend?
      newsTrading: boolean;           // allowed to trade during news?
      maxLeverage: number;
      profitSplit: number;            // % that goes to trader (funded only)
    };
  };
};

export const PROP_FIRM_PRESETS: PropFirmPreset[] = [
  {
    id: 'ftmo',
    name: 'FTMO',
    accountSizes: [10000, 25000, 50000, 100000, 200000],
    phases: {
      challenge: {
        profitTarget: 10, maxDailyLoss: 5, maxTotalDrawdown: 10,
        trailingDrawdown: false, minTradingDays: 4, maxTradingDays: 30,
        consistencyRule: 0, weekendHolding: true, newsTrading: true,
        maxLeverage: 100, profitSplit: 0,
      },
      verification: {
        profitTarget: 5, maxDailyLoss: 5, maxTotalDrawdown: 10,
        trailingDrawdown: false, minTradingDays: 4, maxTradingDays: 60,
        consistencyRule: 0, weekendHolding: true, newsTrading: true,
        maxLeverage: 100, profitSplit: 0,
      },
      funded: {
        profitTarget: 0, maxDailyLoss: 5, maxTotalDrawdown: 10,
        trailingDrawdown: false, minTradingDays: 0, maxTradingDays: 0,
        consistencyRule: 0, weekendHolding: true, newsTrading: true,
        maxLeverage: 100, profitSplit: 80,
      },
    },
  },
  {
    id: 'topstep',
    name: 'Topstep',
    accountSizes: [50000, 100000, 150000],
    phases: {
      challenge: {
        profitTarget: 6, maxDailyLoss: 2, maxTotalDrawdown: 4,
        trailingDrawdown: true, minTradingDays: 5, maxTradingDays: 0,
        consistencyRule: 40, weekendHolding: false, newsTrading: true,
        maxLeverage: 50, profitSplit: 0,
      },
      verification: {
        profitTarget: 6, maxDailyLoss: 2, maxTotalDrawdown: 4,
        trailingDrawdown: true, minTradingDays: 5, maxTradingDays: 0,
        consistencyRule: 40, weekendHolding: false, newsTrading: true,
        maxLeverage: 50, profitSplit: 0,
      },
      funded: {
        profitTarget: 0, maxDailyLoss: 2, maxTotalDrawdown: 4,
        trailingDrawdown: true, minTradingDays: 0, maxTradingDays: 0,
        consistencyRule: 40, weekendHolding: false, newsTrading: true,
        maxLeverage: 50, profitSplit: 90,
      },
    },
  },
  {
    id: 'apex',
    name: 'Apex Trader Funding',
    accountSizes: [25000, 50000, 100000, 250000, 300000],
    phases: {
      challenge: {
        profitTarget: 6, maxDailyLoss: 0, maxTotalDrawdown: 2.5,
        trailingDrawdown: true, minTradingDays: 7, maxTradingDays: 0,
        consistencyRule: 30, weekendHolding: false, newsTrading: false,
        maxLeverage: 50, profitSplit: 0,
      },
      verification: {
        profitTarget: 6, maxDailyLoss: 0, maxTotalDrawdown: 2.5,
        trailingDrawdown: true, minTradingDays: 7, maxTradingDays: 0,
        consistencyRule: 30, weekendHolding: false, newsTrading: false,
        maxLeverage: 50, profitSplit: 0,
      },
      funded: {
        profitTarget: 0, maxDailyLoss: 0, maxTotalDrawdown: 2.5,
        trailingDrawdown: true, minTradingDays: 0, maxTradingDays: 0,
        consistencyRule: 30, weekendHolding: false, newsTrading: false,
        maxLeverage: 50, profitSplit: 100,
      },
    },
  },
  {
    id: 'the-funded-trader',
    name: 'The Funded Trader',
    accountSizes: [5000, 10000, 25000, 50000, 100000, 200000],
    phases: {
      challenge: {
        profitTarget: 8, maxDailyLoss: 5, maxTotalDrawdown: 10,
        trailingDrawdown: false, minTradingDays: 3, maxTradingDays: 35,
        consistencyRule: 0, weekendHolding: true, newsTrading: true,
        maxLeverage: 100, profitSplit: 0,
      },
      verification: {
        profitTarget: 5, maxDailyLoss: 5, maxTotalDrawdown: 10,
        trailingDrawdown: false, minTradingDays: 3, maxTradingDays: 60,
        consistencyRule: 0, weekendHolding: true, newsTrading: true,
        maxLeverage: 100, profitSplit: 0,
      },
      funded: {
        profitTarget: 0, maxDailyLoss: 5, maxTotalDrawdown: 10,
        trailingDrawdown: false, minTradingDays: 0, maxTradingDays: 0,
        consistencyRule: 0, weekendHolding: true, newsTrading: true,
        maxLeverage: 100, profitSplit: 80,
      },
    },
  },
];

export function getPropPreset(id: PropFirmId): PropFirmPreset | null {
  return PROP_FIRM_PRESETS.find(p => p.id === id) ?? null;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export type AdvancedConfig = {
  capital: number;
  leverage: number;
  maxRiskPerTrade: number;            // % of capital
  maxDailyLoss: number;               // % of capital
  maxDrawdown: number;                // % of capital
  maxConsecutiveLosses: number;
  maxTradesPerDay: number;
  minConfluenceScore: number;         // minimum confluence to trade (0-100)
  minRiskReward: number;              // minimum R:R ratio
  useKellySizing: boolean;
  kellyFractionMultiplier: number;    // 0.25-1.0 (half-kelly = 0.5)
  sessionFilter: boolean;             // only trade during active sessions
  // Prop firm settings
  propFirmMode: boolean;              // enable prop firm rule enforcement
  propFirmId: PropFirmId;
  propPhase: ChallengePhase;
  propAccountSize: number;            // selected account size
  propStartDate: number;              // timestamp of challenge start
  // Pillar weights for master score
  weights: {
    orderFlow: number;                // 0-1
    liquidity: number;
    structure: number;
    execution: number;
    risk: number;
  };
};

export const DEFAULT_ADVANCED_CONFIG: AdvancedConfig = {
  capital: 200,
  leverage: 10,
  maxRiskPerTrade: 1.5,
  maxDailyLoss: 5,
  maxDrawdown: 15,
  maxConsecutiveLosses: 3,
  maxTradesPerDay: 10,
  minConfluenceScore: 55,
  minRiskReward: 1.5,
  useKellySizing: true,
  kellyFractionMultiplier: 0.5,
  sessionFilter: false,
  propFirmMode: false,
  propFirmId: 'none',
  propPhase: 'challenge',
  propAccountSize: 0,
  propStartDate: 0,
  weights: {
    orderFlow: 0.25,
    liquidity: 0.20,
    structure: 0.25,
    execution: 0.20,
    risk: 0.10,
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// PILLAR 1: ORDER FLOW ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

export function analyzeOrderFlow(
  candles: CandlestickData[],
  trades: Trade[],
  orderBook: OrderBook | null,
): OrderFlowAnalysis {
  const defaultResult: OrderFlowAnalysis = {
    cvd: 0, cvdTrend: 'flat', deltaPerCandle: [], buyPressure: 50,
    sellPressure: 50, netFlow: 'neutral', aggressiveSide: 'balanced',
    largeOrderCount: 0, largeOrderBias: 'neutral', tradeVelocity: 0,
    volumeProfile: [], absorptionDetected: false, absorptionSide: null, score: 0,
  };

  if (candles.length < 20) return defaultResult;

  // ── CVD from candle data (proxy when no tick data) ──
  const deltaPerCandle: number[] = [];
  let cvd = 0;
  const lookback = Math.min(candles.length, 100);
  for (let i = candles.length - lookback; i < candles.length; i++) {
    const c = candles[i];
    const bodySize = Math.abs(c.close - c.open);
    const range = c.high - c.low || 0.0001;
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    // Buy pressure: close near high, sell pressure: close near low
    const buyRatio = (c.close - c.low) / range;
    const sellRatio = (c.high - c.close) / range;
    const delta = (buyRatio - sellRatio) * range;
    deltaPerCandle.push(delta);
    cvd += delta;
  }

  // CVD trend (last 20 candles)
  const recentDeltas = deltaPerCandle.slice(-20);
  const firstHalf = recentDeltas.slice(0, 10).reduce((s, d) => s + d, 0);
  const secondHalf = recentDeltas.slice(10).reduce((s, d) => s + d, 0);
  const cvdTrend: 'rising' | 'falling' | 'flat' =
    secondHalf > firstHalf * 1.1 ? 'rising'
    : secondHalf < firstHalf * 0.9 ? 'falling'
    : 'flat';

  // ── Trade flow analysis ──
  let buyVolume = 0, sellVolume = 0, largeBuys = 0, largeSells = 0;
  const now = Date.now();
  const recentTrades = trades.filter(t => now - t.time < 60000); // last 60s
  const tradeVelocity = recentTrades.length > 0
    ? recentTrades.length / 60
    : 0;

  if (recentTrades.length > 0) {
    const avgQty = recentTrades.reduce((s, t) => s + t.qty, 0) / recentTrades.length;
    const largeThreshold = avgQty * 3;
    for (const t of recentTrades) {
      if (t.isBuyerMaker) {
        sellVolume += t.qty * t.price;
        if (t.qty >= largeThreshold) largeSells++;
      } else {
        buyVolume += t.qty * t.price;
        if (t.qty >= largeThreshold) largeBuys++;
      }
    }
  }

  const totalVolume = buyVolume + sellVolume;
  const buyPressure = totalVolume > 0 ? (buyVolume / totalVolume) * 100 : 50;
  const sellPressure = 100 - buyPressure;
  const netFlow: 'buying' | 'selling' | 'neutral' =
    buyPressure > 58 ? 'buying' : sellPressure > 58 ? 'selling' : 'neutral';

  // Aggressive side detection
  const aggressiveSide: 'buyers' | 'sellers' | 'balanced' =
    buyPressure > 60 ? 'buyers' : sellPressure > 60 ? 'sellers' : 'balanced';

  const largeOrderCount = largeBuys + largeSells;
  const largeOrderBias: 'buy' | 'sell' | 'neutral' =
    largeBuys > largeSells + 1 ? 'buy'
    : largeSells > largeBuys + 1 ? 'sell'
    : 'neutral';

  // ── Volume Profile (from candles) ──
  const volumeProfile = buildVolumeProfile(candles.slice(-50));

  // ── Absorption detection from order book ──
  let absorptionDetected = false;
  let absorptionSide: 'bid' | 'ask' | null = null;
  if (orderBook && orderBook.bids.length > 5 && orderBook.asks.length > 5) {
    const bidWall = orderBook.bids.slice(0, 5).reduce((s, l) => s + l.size, 0);
    const askWall = orderBook.asks.slice(0, 5).reduce((s, l) => s + l.size, 0);
    const ratio = bidWall / (askWall || 1);
    if (ratio > 3) {
      absorptionDetected = true;
      absorptionSide = 'bid'; // large bids absorbing selling
    } else if (ratio < 0.33) {
      absorptionDetected = true;
      absorptionSide = 'ask'; // large asks absorbing buying
    }
  }

  // ── Score calculation ──
  let score = 0;
  // CVD contribution
  score += cvdTrend === 'rising' ? 20 : cvdTrend === 'falling' ? -20 : 0;
  // Buy/sell pressure
  score += (buyPressure - 50) * 0.8;
  // Large order bias
  score += largeOrderBias === 'buy' ? 15 : largeOrderBias === 'sell' ? -15 : 0;
  // Absorption
  if (absorptionDetected) {
    score += absorptionSide === 'bid' ? 15 : -15;
  }
  score = Math.max(-100, Math.min(100, score));

  return {
    cvd, cvdTrend, deltaPerCandle: deltaPerCandle.slice(-20),
    buyPressure, sellPressure, netFlow, aggressiveSide,
    largeOrderCount, largeOrderBias, tradeVelocity,
    volumeProfile, absorptionDetected, absorptionSide, score,
  };
}

function buildVolumeProfile(candles: CandlestickData[]): VolumeNode[] {
  if (candles.length === 0) return [];
  const priceHigh = Math.max(...candles.map(c => c.high));
  const priceLow = Math.min(...candles.map(c => c.low));
  const range = priceHigh - priceLow;
  if (range <= 0) return [];

  const numBins = 20;
  const binSize = range / numBins;
  const bins: VolumeNode[] = [];

  for (let i = 0; i < numBins; i++) {
    const low = priceLow + i * binSize;
    const high = low + binSize;
    bins.push({
      price: (low + high) / 2,
      buyVolume: 0, sellVolume: 0, totalVolume: 0, delta: 0, isHighVolume: false,
    });
  }

  for (const c of candles) {
    const volume = c.high - c.low || 0.0001;
    const isBullish = c.close >= c.open;
    const tp = (c.high + c.low + c.close) / 3;
    const binIdx = Math.min(numBins - 1, Math.floor((tp - priceLow) / binSize));
    if (binIdx >= 0 && binIdx < numBins) {
      if (isBullish) bins[binIdx].buyVolume += volume;
      else bins[binIdx].sellVolume += volume;
      bins[binIdx].totalVolume += volume;
      bins[binIdx].delta += isBullish ? volume : -volume;
    }
  }

  // Mark high volume nodes (top 30%)
  const sortedVols = [...bins].sort((a, b) => b.totalVolume - a.totalVolume);
  const hvnThreshold = sortedVols[Math.floor(numBins * 0.3)]?.totalVolume ?? 0;
  for (const bin of bins) {
    bin.isHighVolume = bin.totalVolume >= hvnThreshold;
  }

  return bins;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PILLAR 2: LIQUIDITY ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

export function analyzeLiquidity(
  candles: CandlestickData[],
  pa: PriceActionAnalysis | null,
  orderBook: OrderBook | null,
): LiquidityAnalysis {
  const defaultResult: LiquidityAnalysis = {
    zones: [], nearestSupport: null, nearestResistance: null,
    liquidityPools: [], imbalanceZones: [], sweepEvents: [],
    currentLiquidityBias: 'balanced', score: 0,
  };

  if (candles.length < 20) return defaultResult;
  const currentPrice = candles[candles.length - 1].close;
  const zones: LiquidityZone[] = [];

  // ── Order Book S/R Zones ──
  if (orderBook && orderBook.bids.length > 0) {
    const sr = identifySupportResistance(orderBook, {
      minSizePercentile: 80,
      maxLevels: 5,
      lookbackLevels: 50,
    });
    for (const s of sr.support) {
      zones.push({
        priceHigh: s.price * 1.001, priceLow: s.price * 0.999,
        midPrice: s.price, type: 'support',
        strength: s.strength === 'strong' ? 90 : s.strength === 'medium' ? 60 : 30,
        source: 'orderbook', touches: 1, lastTouch: Date.now(), active: true,
      });
    }
    for (const r of sr.resistance) {
      zones.push({
        priceHigh: r.price * 1.001, priceLow: r.price * 0.999,
        midPrice: r.price, type: 'resistance',
        strength: r.strength === 'strong' ? 90 : r.strength === 'medium' ? 60 : 30,
        source: 'orderbook', touches: 1, lastTouch: Date.now(), active: true,
      });
    }
  }

  // ── Order Block Zones ──
  const orderBlocks = detectOrderBlocks(candles, { lookback: 50, minBlockSize: 0.3, volumeThreshold: 1.3 });
  const activeBlocks = getActiveOrderBlocks(orderBlocks, currentPrice);
  for (const ob of activeBlocks.bullish.slice(0, 3)) {
    zones.push({
      priceHigh: ob.high, priceLow: ob.low, midPrice: (ob.high + ob.low) / 2,
      type: 'support',
      strength: ob.strength === 'strong' ? 85 : ob.strength === 'medium' ? 55 : 25,
      source: 'orderblock', touches: 1, lastTouch: ob.time, active: true,
    });
  }
  for (const ob of activeBlocks.bearish.slice(0, 3)) {
    zones.push({
      priceHigh: ob.high, priceLow: ob.low, midPrice: (ob.high + ob.low) / 2,
      type: 'resistance',
      strength: ob.strength === 'strong' ? 85 : ob.strength === 'medium' ? 55 : 25,
      source: 'orderblock', touches: 1, lastTouch: ob.time, active: true,
    });
  }

  // ── Swing Level Zones ──
  if (pa) {
    const recentSwings = pa.swingPoints.slice(-10);
    for (const sw of recentSwings) {
      const tolerance = currentPrice * 0.001;
      zones.push({
        priceHigh: sw.price + tolerance, priceLow: sw.price - tolerance,
        midPrice: sw.price,
        type: sw.type === 'high' ? 'resistance' : 'support',
        strength: 50, source: 'swing', touches: 1, lastTouch: sw.time, active: true,
      });
    }
  }

  // ── FVG Zones ──
  if (pa) {
    for (const fvg of pa.fairValueGaps.filter(g => !g.filled).slice(0, 5)) {
      zones.push({
        priceHigh: fvg.high, priceLow: fvg.low, midPrice: fvg.midpoint,
        type: fvg.type === 'bullish' ? 'support' : 'resistance',
        strength: 65, source: 'fvg', touches: 0, lastTouch: fvg.time, active: true,
      });
    }
  }

  // ── Equal Level Zones ──
  if (pa) {
    for (const el of pa.equalLevels.filter(l => l.liquidityPool)) {
      zones.push({
        priceHigh: el.avgPrice * 1.001, priceLow: el.avgPrice * 0.999,
        midPrice: el.avgPrice,
        type: el.type === 'equal-highs' ? 'resistance' : 'support',
        strength: 75, source: 'equal-level', touches: el.count, lastTouch: Date.now(), active: true,
      });
    }
  }

  // Sort zones by distance to current price
  zones.sort((a, b) => Math.abs(a.midPrice - currentPrice) - Math.abs(b.midPrice - currentPrice));

  const nearestSupport = zones.find(z => z.type === 'support' && z.midPrice < currentPrice) ?? null;
  const nearestResistance = zones.find(z => z.type === 'resistance' && z.midPrice > currentPrice) ?? null;

  // ── Liquidity Pools ──
  const liquidityPools: LiquidityPool[] = [];
  if (pa) {
    for (const el of pa.equalLevels) {
      liquidityPools.push({
        price: el.avgPrice,
        type: el.type === 'equal-highs' ? 'buy-side' : 'sell-side',
        size: el.count * 10, // estimated
        touches: el.count,
        swept: false,
      });
    }
  }

  // ── Imbalance Zones from order book ──
  const imbalanceZones: ImbalanceZone[] = [];
  if (orderBook && orderBook.bids.length > 10 && orderBook.asks.length > 10) {
    // Check top 20 levels for imbalance
    for (let i = 0; i < Math.min(20, orderBook.bids.length); i++) {
      const bid = orderBook.bids[i];
      // Find the corresponding ask level
      const matchingAsk = orderBook.asks.find(a =>
        Math.abs(a.price - bid.price) / bid.price < 0.002
      );
      const askSize = matchingAsk?.size ?? 0;
      const ratio = bid.size / (askSize || 0.001);
      if (ratio > 3 || ratio < 0.33) {
        imbalanceZones.push({
          priceLevel: bid.price,
          bidSize: bid.size,
          askSize,
          ratio,
          type: ratio > 1 ? 'bid-heavy' : 'ask-heavy',
          strength: ratio > 5 || ratio < 0.2 ? 'strong' : ratio > 3 || ratio < 0.33 ? 'medium' : 'weak',
        });
      }
    }
  }

  // ── Sweep Events ──
  const sweepEvents: SweepEvent[] = [];
  if (pa) {
    for (const sweep of pa.liquiditySweeps.slice(-5)) {
      sweepEvents.push({
        price: sweep.price,
        type: sweep.type,
        recovered: sweep.recovered,
        time: sweep.time,
        strength: sweep.strength,
      });
    }
  }

  // ── Liquidity bias ──
  const aboveZones = zones.filter(z => z.midPrice > currentPrice);
  const belowZones = zones.filter(z => z.midPrice < currentPrice);
  const aboveStrength = aboveZones.reduce((s, z) => s + z.strength, 0);
  const belowStrength = belowZones.reduce((s, z) => s + z.strength, 0);
  const currentLiquidityBias: 'above' | 'below' | 'balanced' =
    aboveStrength > belowStrength * 1.3 ? 'above'
    : belowStrength > aboveStrength * 1.3 ? 'below'
    : 'balanced';

  // ── Score ──
  let score = 0;
  // Near strong support = bullish bias
  if (nearestSupport && nearestSupport.strength > 60) {
    const dist = (currentPrice - nearestSupport.midPrice) / currentPrice * 100;
    if (dist < 0.5) score += 25; // very close to support
    else if (dist < 1) score += 15;
  }
  // Near strong resistance = bearish bias
  if (nearestResistance && nearestResistance.strength > 60) {
    const dist = (nearestResistance.midPrice - currentPrice) / currentPrice * 100;
    if (dist < 0.5) score -= 25;
    else if (dist < 1) score -= 15;
  }
  // Sweep events (reversal signal)
  for (const sweep of sweepEvents.filter(s => s.recovered)) {
    score += sweep.type === 'sell-side' ? 20 : -20;
  }
  // Liquidity bias (price tends to seek liquidity)
  score += currentLiquidityBias === 'above' ? -5 : currentLiquidityBias === 'below' ? 5 : 0;

  score = Math.max(-100, Math.min(100, score));

  return {
    zones: zones.slice(0, 15),
    nearestSupport, nearestResistance,
    liquidityPools, imbalanceZones: imbalanceZones.slice(0, 8),
    sweepEvents, currentLiquidityBias, score,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PILLAR 3: MARKET STRUCTURE ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

export function analyzeStructure(
  candles: CandlestickData[],
  indicators: IndicatorSnapshot | null,
  pa: PriceActionAnalysis | null,
): MarketStructureAnalysis {
  const defaultResult: MarketStructureAnalysis = {
    trend: 'ranging', trendStrength: 0, phase: 'unknown',
    recentBOS: [], recentCHoCH: [], mssDetected: false, mssDirection: null,
    premiumDiscount: 'equilibrium', equilibriumPrice: 0,
    pointsOfInterest: [], fibLevels: [], score: 0,
  };

  if (candles.length < 30 || !pa) return defaultResult;
  const currentPrice = candles[candles.length - 1].close;

  // ── Trend & Phase from Price Action ──
  const trend = pa.trend;
  const trendStrength = pa.trendStrength;
  const phase = pa.marketPhase;

  // ── Recent structure breaks ──
  const recentBOS = pa.structureBreaks
    .filter(b => b.type === 'BOS' && b.index >= candles.length - 10);
  const recentCHoCH = pa.structureBreaks
    .filter(b => b.type === 'CHoCH' && b.index >= candles.length - 10);

  // ── MSS Detection (Market Structure Shift) ──
  // MSS = CHoCH followed by a BOS in the new direction
  let mssDetected = false;
  let mssDirection: 'bullish' | 'bearish' | null = null;
  if (recentCHoCH.length > 0) {
    const lastCHoCH = recentCHoCH[recentCHoCH.length - 1];
    const confirmingBOS = recentBOS.find(
      b => b.direction === lastCHoCH.direction && b.index > lastCHoCH.index
    );
    if (confirmingBOS) {
      mssDetected = true;
      mssDirection = lastCHoCH.direction;
    }
  }

  // ── Premium / Discount Zone ──
  const swingHighs = pa.swingPoints.filter(s => s.type === 'high').slice(-5);
  const swingLows = pa.swingPoints.filter(s => s.type === 'low').slice(-5);
  const rangeHigh = swingHighs.length > 0
    ? Math.max(...swingHighs.map(s => s.price)) : currentPrice;
  const rangeLow = swingLows.length > 0
    ? Math.min(...swingLows.map(s => s.price)) : currentPrice;
  const equilibriumPrice = (rangeHigh + rangeLow) / 2;
  const premiumDiscount: 'premium' | 'discount' | 'equilibrium' =
    currentPrice > equilibriumPrice + (rangeHigh - rangeLow) * 0.15 ? 'premium'
    : currentPrice < equilibriumPrice - (rangeHigh - rangeLow) * 0.15 ? 'discount'
    : 'equilibrium';

  // ── Points of Interest ──
  const pointsOfInterest: PointOfInterest[] = [];

  // Order blocks as POI
  const orderBlocks = detectOrderBlocks(candles, { lookback: 50 });
  const activeBlocks = getActiveOrderBlocks(orderBlocks, currentPrice);
  for (const ob of [...activeBlocks.bullish.slice(0, 2), ...activeBlocks.bearish.slice(0, 2)]) {
    pointsOfInterest.push({
      price: (ob.high + ob.low) / 2,
      type: 'order-block',
      direction: ob.type === 'bullish' ? 'bullish' : 'bearish',
      strength: ob.strength === 'strong' ? 90 : ob.strength === 'medium' ? 60 : 30,
      reason: `${ob.type} order block at ${((ob.high + ob.low) / 2).toFixed(2)}`,
    });
  }

  // FVGs as POI
  for (const fvg of pa.fairValueGaps.filter(g => !g.filled).slice(0, 3)) {
    pointsOfInterest.push({
      price: fvg.midpoint,
      type: 'fvg',
      direction: fvg.type,
      strength: 65,
      reason: `${fvg.type} FVG at ${fvg.midpoint.toFixed(2)}`,
    });
  }

  // ── Fib Levels ──
  const fibLevels = pa.fibLevels;

  // ── Score ──
  let score = 0;
  // Trend direction
  score += trend === 'bullish' ? 25 : trend === 'bearish' ? -25 : 0;
  // Trend strength bonus
  score += trend === 'bullish'
    ? trendStrength * 0.15
    : trend === 'bearish'
    ? -trendStrength * 0.15
    : 0;
  // MSS
  if (mssDetected) score += mssDirection === 'bullish' ? 30 : -30;
  // Recent BOS
  for (const bos of recentBOS) {
    score += bos.direction === 'bullish' ? 10 : -10;
  }
  // Premium/discount
  if (premiumDiscount === 'discount' && trend !== 'bearish') score += 10;
  if (premiumDiscount === 'premium' && trend !== 'bullish') score -= 10;
  // Phase
  if (phase === 'accumulation') score += 15;
  if (phase === 'distribution') score -= 15;
  if (phase === 'markup') score += 10;
  if (phase === 'markdown') score -= 10;

  // EMA alignment from indicators
  if (indicators) {
    if (indicators.ema9 > indicators.ema21 && indicators.ema21 > indicators.ema50) score += 10;
    else if (indicators.ema9 < indicators.ema21 && indicators.ema21 < indicators.ema50) score -= 10;
  }

  score = Math.max(-100, Math.min(100, score));

  return {
    trend, trendStrength, phase,
    recentBOS, recentCHoCH,
    mssDetected, mssDirection,
    premiumDiscount, equilibriumPrice,
    pointsOfInterest, fibLevels, score,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PILLAR 4: SYSTEMATIC EXECUTION (ZERO EMOTION)
// ═══════════════════════════════════════════════════════════════════════════════

export function analyzeExecution(
  candles: CandlestickData[],
  indicators: IndicatorSnapshot | null,
  orderFlow: OrderFlowAnalysis,
  liquidity: LiquidityAnalysis,
  structure: MarketStructureAnalysis,
  shadows: ShadowAnalysisResult,
  config: AdvancedConfig,
): ExecutionAnalysis {
  const defaultResult: ExecutionAnalysis = {
    checklist: [], passedCount: 0, totalChecks: 0, passRate: 0,
    setupGrade: 'NO-TRADE', confluenceScore: 0,
    direction: 'WAIT', entry: 0, stopLoss: 0,
    takeProfit1: 0, takeProfit2: 0, takeProfit3: 0,
    riskReward: 0, invalidationPrice: 0,
    timeInForce: 'SESSION', reasons: [], warnings: [],
  };

  if (candles.length < 30 || !indicators) return defaultResult;
  const currentPrice = candles[candles.length - 1].close;
  const atr = indicators.atr;

  // ── Determine direction from pillar scores ──
  const compositeScore = (
    orderFlow.score * config.weights.orderFlow +
    liquidity.score * config.weights.liquidity +
    structure.score * config.weights.structure
  ) / (config.weights.orderFlow + config.weights.liquidity + config.weights.structure);

  const direction: 'LONG' | 'SHORT' | 'WAIT' =
    compositeScore > 20 ? 'LONG'
    : compositeScore < -20 ? 'SHORT'
    : 'WAIT';

  // ── Build Checklist ──
  const checklist: ChecklistItem[] = [];

  // ORDER FLOW checks
  checklist.push({
    id: 'of-1', category: 'order-flow',
    label: 'CVD confirms direction',
    passed: direction === 'LONG'
      ? orderFlow.cvdTrend === 'rising'
      : direction === 'SHORT'
      ? orderFlow.cvdTrend === 'falling'
      : false,
    weight: 4,
    detail: `CVD trend: ${orderFlow.cvdTrend}`,
  });
  checklist.push({
    id: 'of-2', category: 'order-flow',
    label: 'Net flow aligned',
    passed: direction === 'LONG'
      ? orderFlow.netFlow === 'buying'
      : direction === 'SHORT'
      ? orderFlow.netFlow === 'selling'
      : false,
    weight: 3,
    detail: `Net flow: ${orderFlow.netFlow} (buy: ${orderFlow.buyPressure.toFixed(0)}%)`,
  });
  checklist.push({
    id: 'of-3', category: 'order-flow',
    label: 'No absorption against trade',
    passed: !orderFlow.absorptionDetected || (
      direction === 'LONG' ? orderFlow.absorptionSide === 'bid' : orderFlow.absorptionSide === 'ask'
    ),
    weight: 5,
    detail: orderFlow.absorptionDetected
      ? `Absorption on ${orderFlow.absorptionSide} side`
      : 'No absorption detected',
  });
  checklist.push({
    id: 'of-4', category: 'order-flow',
    label: 'Large orders support direction',
    passed: direction === 'LONG'
      ? orderFlow.largeOrderBias !== 'sell'
      : direction === 'SHORT'
      ? orderFlow.largeOrderBias !== 'buy'
      : true,
    weight: 3,
    detail: `Large order bias: ${orderFlow.largeOrderBias} (${orderFlow.largeOrderCount} whales)`,
  });

  // LIQUIDITY checks
  checklist.push({
    id: 'lq-1', category: 'liquidity',
    label: 'Near key support/resistance',
    passed: direction === 'LONG'
      ? liquidity.nearestSupport !== null && liquidity.nearestSupport.strength > 50
      : direction === 'SHORT'
      ? liquidity.nearestResistance !== null && liquidity.nearestResistance.strength > 50
      : false,
    weight: 4,
    detail: direction === 'LONG'
      ? `Support: ${liquidity.nearestSupport?.midPrice.toFixed(2) ?? 'none'} (str: ${liquidity.nearestSupport?.strength ?? 0})`
      : `Resistance: ${liquidity.nearestResistance?.midPrice.toFixed(2) ?? 'none'} (str: ${liquidity.nearestResistance?.strength ?? 0})`,
  });
  checklist.push({
    id: 'lq-2', category: 'liquidity',
    label: 'Liquidity sweep confirmed',
    passed: liquidity.sweepEvents.some(s => s.recovered && (
      (direction === 'LONG' && s.type === 'sell-side') ||
      (direction === 'SHORT' && s.type === 'buy-side')
    )),
    weight: 5,
    detail: `${liquidity.sweepEvents.filter(s => s.recovered).length} recovered sweeps`,
  });
  checklist.push({
    id: 'lq-3', category: 'liquidity',
    label: 'Order book imbalance favorable',
    passed: liquidity.imbalanceZones.some(z =>
      (direction === 'LONG' && z.type === 'bid-heavy') ||
      (direction === 'SHORT' && z.type === 'ask-heavy')
    ),
    weight: 3,
    detail: `${liquidity.imbalanceZones.length} imbalance zones detected`,
  });

  // STRUCTURE checks
  checklist.push({
    id: 'st-1', category: 'structure',
    label: 'Trend aligned',
    passed: direction === 'LONG'
      ? structure.trend === 'bullish'
      : direction === 'SHORT'
      ? structure.trend === 'bearish'
      : false,
    weight: 5,
    detail: `Trend: ${structure.trend} (strength: ${structure.trendStrength.toFixed(0)})`,
  });
  checklist.push({
    id: 'st-2', category: 'structure',
    label: 'BOS/CHoCH confirms',
    passed: direction === 'LONG'
      ? structure.recentBOS.some(b => b.direction === 'bullish') || structure.recentCHoCH.some(b => b.direction === 'bullish')
      : direction === 'SHORT'
      ? structure.recentBOS.some(b => b.direction === 'bearish') || structure.recentCHoCH.some(b => b.direction === 'bearish')
      : false,
    weight: 4,
    detail: `BOS: ${structure.recentBOS.length}, CHoCH: ${structure.recentCHoCH.length}`,
  });
  checklist.push({
    id: 'st-3', category: 'structure',
    label: 'Premium/discount zone favorable',
    passed: direction === 'LONG'
      ? structure.premiumDiscount !== 'premium'
      : direction === 'SHORT'
      ? structure.premiumDiscount !== 'discount'
      : false,
    weight: 3,
    detail: `Zone: ${structure.premiumDiscount} (eq: ${structure.equilibriumPrice.toFixed(2)})`,
  });
  checklist.push({
    id: 'st-4', category: 'structure',
    label: 'Market phase supports trade',
    passed: direction === 'LONG'
      ? structure.phase === 'accumulation' || structure.phase === 'markup'
      : direction === 'SHORT'
      ? structure.phase === 'distribution' || structure.phase === 'markdown'
      : false,
    weight: 3,
    detail: `Phase: ${structure.phase}`,
  });

  // EXECUTION checks (indicators)
  checklist.push({
    id: 'ex-1', category: 'execution',
    label: 'EMA alignment',
    passed: direction === 'LONG'
      ? indicators.ema9 > indicators.ema21
      : direction === 'SHORT'
      ? indicators.ema9 < indicators.ema21
      : false,
    weight: 3,
    detail: `EMA9: ${indicators.ema9.toFixed(2)}, EMA21: ${indicators.ema21.toFixed(2)}`,
  });
  checklist.push({
    id: 'ex-2', category: 'execution',
    label: 'RSI not extreme against trade',
    passed: direction === 'LONG'
      ? indicators.rsi < 75
      : direction === 'SHORT'
      ? indicators.rsi > 25
      : true,
    weight: 4,
    detail: `RSI: ${indicators.rsi.toFixed(1)}`,
  });
  checklist.push({
    id: 'ex-3', category: 'execution',
    label: 'MACD confirms momentum',
    passed: direction === 'LONG'
      ? indicators.macd.histogram > 0
      : direction === 'SHORT'
      ? indicators.macd.histogram < 0
      : false,
    weight: 3,
    detail: `MACD hist: ${indicators.macd.histogram.toFixed(4)}`,
  });
  checklist.push({
    id: 'ex-4', category: 'execution',
    label: 'VWAP positioned correctly',
    passed: direction === 'LONG'
      ? indicators.priceVsVwap > -0.5
      : direction === 'SHORT'
      ? indicators.priceVsVwap < 0.5
      : true,
    weight: 2,
    detail: `Price vs VWAP: ${indicators.priceVsVwap.toFixed(2)}%`,
  });
  checklist.push({
    id: 'ex-5', category: 'execution',
    label: 'ADX shows trend strength',
    passed: !isNaN(indicators.adx.value) && indicators.adx.value > 20,
    weight: 2,
    detail: `ADX: ${indicators.adx.value.toFixed(1)}`,
  });

  // SHADOW / WICK checks
  const recentShadowPatterns = shadows.patterns.slice(0, 5);
  const bullishShadows = recentShadowPatterns.filter(p => p.direction === 'bullish');
  const bearishShadows = recentShadowPatterns.filter(p => p.direction === 'bearish');

  checklist.push({
    id: 'sh-1', category: 'execution',
    label: 'Shadow patterns confirm direction',
    passed: direction === 'LONG'
      ? bullishShadows.length > bearishShadows.length
      : direction === 'SHORT'
      ? bearishShadows.length > bullishShadows.length
      : false,
    weight: 4,
    detail: `Shadows: ${bullishShadows.length} bull, ${bearishShadows.length} bear${recentShadowPatterns.length > 0 ? ` (${recentShadowPatterns[0].type})` : ''}`,
  });

  checklist.push({
    id: 'sh-2', category: 'execution',
    label: 'No stop hunt against trade',
    passed: !shadows.stopHunts.some(sh =>
      sh.recovered && (
        (direction === 'LONG' && sh.type === 'short') ||
        (direction === 'SHORT' && sh.type === 'long')
      )
    ),
    weight: 5,
    detail: shadows.stopHunts.length > 0
      ? `${shadows.stopHunts[0].type} hunt at ${shadows.stopHunts[0].levelHunted.toFixed(1)}`
      : 'No stop hunts detected',
  });

  checklist.push({
    id: 'sh-3', category: 'execution',
    label: 'Shadow cluster zone supports entry',
    passed: direction === 'LONG'
      ? shadows.clusterZones.some(z => z.type === 'support' && z.midPrice < currentPrice && z.strength > 40)
      : direction === 'SHORT'
      ? shadows.clusterZones.some(z => z.type === 'resistance' && z.midPrice > currentPrice && z.strength > 40)
      : false,
    weight: 3,
    detail: `${shadows.clusterZones.length} cluster zones, bias: ${shadows.bias}`,
  });

  // ── Calculate confluence score ──
  const totalWeight = checklist.reduce((s, c) => s + c.weight, 0);
  const passedWeight = checklist.filter(c => c.passed).reduce((s, c) => s + c.weight, 0);
  const confluenceScore = totalWeight > 0 ? (passedWeight / totalWeight) * 100 : 0;
  const passedCount = checklist.filter(c => c.passed).length;
  const passRate = checklist.length > 0 ? (passedCount / checklist.length) * 100 : 0;

  // ── Setup Grade ──
  let setupGrade: 'A+' | 'A' | 'B' | 'C' | 'NO-TRADE' = 'NO-TRADE';
  if (direction === 'WAIT' || confluenceScore < config.minConfluenceScore) {
    setupGrade = 'NO-TRADE';
  } else if (confluenceScore >= 85) {
    setupGrade = 'A+';
  } else if (confluenceScore >= 70) {
    setupGrade = 'A';
  } else if (confluenceScore >= 55) {
    setupGrade = 'B';
  } else {
    setupGrade = 'C';
  }

  // ── Entry / SL / TP Calculation ──
  const entryOffset = atr * 0.15;
  const entry = direction === 'LONG'
    ? currentPrice - entryOffset
    : direction === 'SHORT'
    ? currentPrice + entryOffset
    : currentPrice;

  // Dynamic SL based on structure
  const slMultiplier = setupGrade === 'A+' || setupGrade === 'A' ? 1.0 : 1.2;
  let stopLoss = direction === 'LONG'
    ? entry - atr * slMultiplier
    : direction === 'SHORT'
    ? entry + atr * slMultiplier
    : entry;

  // If we have a nearby support/resistance, use it for SL
  if (direction === 'LONG' && liquidity.nearestSupport) {
    const structuralSL = liquidity.nearestSupport.priceLow - atr * 0.2;
    if (structuralSL > stopLoss && structuralSL < entry) {
      stopLoss = structuralSL; // tighter SL at structure
    }
  } else if (direction === 'SHORT' && liquidity.nearestResistance) {
    const structuralSL = liquidity.nearestResistance.priceHigh + atr * 0.2;
    if (structuralSL < stopLoss && structuralSL > entry) {
      stopLoss = structuralSL;
    }
  }

  const riskDist = Math.abs(entry - stopLoss);
  const takeProfit1 = direction === 'LONG'
    ? entry + riskDist * 1.5
    : direction === 'SHORT'
    ? entry - riskDist * 1.5
    : entry;
  const takeProfit2 = direction === 'LONG'
    ? entry + riskDist * 2.5
    : direction === 'SHORT'
    ? entry - riskDist * 2.5
    : entry;
  const takeProfit3 = direction === 'LONG'
    ? entry + riskDist * 4.0
    : direction === 'SHORT'
    ? entry - riskDist * 4.0
    : entry;

  const riskReward = riskDist > 0 ? (Math.abs(takeProfit1 - entry)) / riskDist : 0;
  const invalidationPrice = stopLoss;

  // ── Reasons & Warnings ──
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (structure.mssDetected) reasons.push(`MSS ${structure.mssDirection}`);
  if (structure.recentCHoCH.length > 0) reasons.push('CHoCH confirmed');
  if (structure.recentBOS.length > 0) reasons.push('BOS confirmed');
  if (orderFlow.cvdTrend === 'rising' && direction === 'LONG') reasons.push('CVD rising');
  if (orderFlow.cvdTrend === 'falling' && direction === 'SHORT') reasons.push('CVD falling');
  if (orderFlow.absorptionDetected) reasons.push(`${orderFlow.absorptionSide} absorption`);
  if (liquidity.sweepEvents.some(s => s.recovered)) reasons.push('Liquidity sweep + recovery');
  if (structure.premiumDiscount === 'discount' && direction === 'LONG') reasons.push('In discount zone');
  if (structure.premiumDiscount === 'premium' && direction === 'SHORT') reasons.push('In premium zone');

  if (riskReward < config.minRiskReward) warnings.push(`R:R ${riskReward.toFixed(1)} below minimum ${config.minRiskReward}`);
  if (confluenceScore < 60) warnings.push('Low confluence — reduced confidence');
  if (orderFlow.absorptionDetected && (
    (direction === 'LONG' && orderFlow.absorptionSide === 'ask') ||
    (direction === 'SHORT' && orderFlow.absorptionSide === 'bid')
  )) warnings.push('Absorption against trade direction!');
  if (structure.premiumDiscount === 'premium' && direction === 'LONG') warnings.push('Buying in premium zone');
  if (structure.premiumDiscount === 'discount' && direction === 'SHORT') warnings.push('Selling in discount zone');

  return {
    checklist,
    passedCount,
    totalChecks: checklist.length,
    passRate,
    setupGrade,
    confluenceScore,
    direction,
    entry, stopLoss, takeProfit1, takeProfit2, takeProfit3,
    riskReward,
    invalidationPrice,
    timeInForce: 'SESSION',
    reasons, warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PILLAR 5: RISK MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

export type TradeRecord = {
  result: 'win' | 'loss' | 'breakeven';
  pnl: number;
  pnlPct: number;
  time: number;
};

export function analyzeRisk(
  execution: ExecutionAnalysis,
  config: AdvancedConfig,
  tradeHistory: TradeRecord[],
): RiskAnalysis {
  const { entry, stopLoss, takeProfit1, direction } = execution;

  // ── Recent performance ──
  const recentTrades = tradeHistory.slice(-20);
  const wins = recentTrades.filter(t => t.result === 'win').length;
  const losses = recentTrades.filter(t => t.result === 'loss').length;
  const total = wins + losses;
  const recentWinRate = total > 0 ? (wins / total) * 100 : 50;

  // Consecutive losses/wins
  let consecutiveLosses = 0;
  let consecutiveWins = 0;
  for (let i = recentTrades.length - 1; i >= 0; i--) {
    if (recentTrades[i].result === 'loss') {
      if (consecutiveWins === 0) consecutiveLosses++;
      else break;
    } else if (recentTrades[i].result === 'win') {
      if (consecutiveLosses === 0) consecutiveWins++;
      else break;
    } else break;
  }

  // Daily P&L
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTrades = tradeHistory.filter(t => t.time >= todayStart.getTime());
  const dailyPnl = todayTrades.reduce((s, t) => s + t.pnl, 0);
  const dailyPnlPct = config.capital > 0 ? (dailyPnl / config.capital) * 100 : 0;

  // ── Drawdown tracking ──
  let peak = config.capital;
  let currentEquity = config.capital;
  for (const t of tradeHistory) {
    currentEquity += t.pnl;
    if (currentEquity > peak) peak = currentEquity;
  }
  const drawdownCurrent = peak > 0 ? ((peak - currentEquity) / peak) * 100 : 0;

  // ── Kelly Criterion ──
  const avgWin = recentTrades.filter(t => t.result === 'win').reduce((s, t) => s + t.pnlPct, 0) / (wins || 1);
  const avgLoss = Math.abs(recentTrades.filter(t => t.result === 'loss').reduce((s, t) => s + t.pnlPct, 0) / (losses || 1));
  const winProb = recentWinRate / 100;
  const lossProb = 1 - winProb;
  const kellyFraction = avgLoss > 0
    ? (winProb / (avgLoss / 100)) - (lossProb / (avgWin / 100 || 1))
    : config.maxRiskPerTrade / 100;
  const adjustedKelly = Math.max(0.001, Math.min(0.1, kellyFraction * config.kellyFractionMultiplier));

  // ── Dynamic Size Multiplier ──
  let sizeMultiplier = 1.0;
  // Reduce size after consecutive losses
  if (consecutiveLosses >= 2) sizeMultiplier *= 0.5;
  else if (consecutiveLosses === 1) sizeMultiplier *= 0.75;
  // Increase slightly after winning streak
  if (consecutiveWins >= 3) sizeMultiplier *= 1.15;
  // Reduce size during drawdown
  if (drawdownCurrent > config.maxDrawdown * 0.5) sizeMultiplier *= 0.5;
  else if (drawdownCurrent > config.maxDrawdown * 0.3) sizeMultiplier *= 0.75;
  // Reduce based on daily loss
  if (dailyPnlPct < -config.maxDailyLoss * 0.5) sizeMultiplier *= 0.5;
  // Cap
  sizeMultiplier = Math.max(0.25, Math.min(1.5, sizeMultiplier));

  // ── Position Size Calculation ──
  const riskDist = Math.abs(entry - stopLoss);
  const riskPct = entry > 0 ? (riskDist / entry) * 100 : 0;
  const baseRiskAmount = config.useKellySizing
    ? config.capital * adjustedKelly
    : config.capital * (config.maxRiskPerTrade / 100);
  const adjustedRiskAmount = baseRiskAmount * sizeMultiplier;

  const positionNotional = riskPct > 0
    ? (adjustedRiskAmount / (riskPct / 100))
    : config.capital * config.leverage;
  const positionSize = entry > 0 ? positionNotional / entry : 0;

  const riskAmount = adjustedRiskAmount;
  const riskPercent = config.capital > 0 ? (riskAmount / config.capital) * 100 : 0;
  const rewardDist = Math.abs(takeProfit1 - entry);
  const rewardAmount = entry > 0 ? positionNotional * (rewardDist / entry) : 0;
  const rewardPercent = config.capital > 0 ? (rewardAmount / config.capital) * 100 : 0;

  // ── Heat Index (overall risk exposure) ──
  const heatIndex = Math.min(100,
    (drawdownCurrent / config.maxDrawdown) * 30 +
    (consecutiveLosses / config.maxConsecutiveLosses) * 30 +
    (Math.abs(dailyPnlPct) / config.maxDailyLoss) * 20 +
    (riskPercent / config.maxRiskPerTrade) * 20
  );

  // ── Should Stop Trading ──
  let shouldStop = false;
  let stopReason: string | null = null;
  if (dailyPnlPct <= -config.maxDailyLoss) {
    shouldStop = true;
    stopReason = `Daily loss limit hit: ${dailyPnlPct.toFixed(1)}%`;
  } else if (consecutiveLosses >= config.maxConsecutiveLosses) {
    shouldStop = true;
    stopReason = `${consecutiveLosses} consecutive losses — take a break`;
  } else if (drawdownCurrent >= config.maxDrawdown) {
    shouldStop = true;
    stopReason = `Max drawdown hit: ${drawdownCurrent.toFixed(1)}%`;
  } else if (todayTrades.length >= config.maxTradesPerDay) {
    shouldStop = true;
    stopReason = `Max ${config.maxTradesPerDay} trades per day reached`;
  }

  // ── Trailing Stop ──
  const trailingStopPrice = direction === 'LONG'
    ? entry + (takeProfit1 - entry) * 0.3 // Move SL to breakeven + 30% when TP1 area
    : direction === 'SHORT'
    ? entry - (entry - takeProfit1) * 0.3
    : null;

  // ── Partial TPs ──
  const partialTPs: PartialTP[] = [
    { price: takeProfit1, percent: 40, label: 'TP1 (40%)' },
    { price: execution.takeProfit2, percent: 35, label: 'TP2 (35%)' },
    { price: execution.takeProfit3, percent: 25, label: 'TP3 (25%)' },
  ];

  // ── Prop Firm Compliance ──
  let propCompliance: PropCompliance | null = null;
  if (config.propFirmMode && config.propFirmId !== 'none') {
    propCompliance = analyzePropCompliance(config, tradeHistory, dailyPnl, dailyPnlPct, drawdownCurrent, currentEquity, peak);
    // Override shouldStop based on prop rules
    if (propCompliance.overallStatus === 'violated') {
      shouldStop = true;
      const violatedRule = propCompliance.rules.find(r => r.severity === 'violated');
      stopReason = `⛔ PROP RULE VIOLATED: ${violatedRule?.label ?? 'Unknown rule'}`;
    }
    // Extra caution in prop mode — reduce size when warning
    if (propCompliance.overallStatus === 'warning' && sizeMultiplier > 0.5) {
      sizeMultiplier *= 0.6;
    }
  }

  return {
    positionSize, positionNotional, riskAmount, riskPercent,
    rewardAmount, rewardPercent, kellyFraction, adjustedKelly,
    drawdownCurrent, drawdownMax: config.maxDrawdown,
    heatIndex,
    shouldReduceSize: sizeMultiplier < 0.8,
    sizeMultiplier,
    consecutiveLosses, consecutiveWins, recentWinRate,
    dailyPnl, dailyPnlPct,
    shouldStop, stopReason,
    trailingStopPrice, partialTPs,
    propCompliance,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROP FIRM COMPLIANCE ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function analyzePropCompliance(
  config: AdvancedConfig,
  tradeHistory: TradeRecord[],
  dailyPnl: number,
  dailyPnlPct: number,
  drawdownCurrent: number,
  currentEquity: number,
  peakEquity: number,
): PropCompliance {
  const preset = getPropPreset(config.propFirmId);
  const accountSize = config.propAccountSize || config.capital;
  const phase = preset?.phases[config.propPhase];
  const rules: PropComplianceRule[] = [];

  // Defaults if no preset
  const maxDailyLossPct = phase?.maxDailyLoss ?? config.maxDailyLoss;
  const maxTotalDD = phase?.maxTotalDrawdown ?? config.maxDrawdown;
  const profitTargetPct = phase?.profitTarget ?? 0;
  const trailingDD = phase?.trailingDrawdown ?? false;
  const minDays = phase?.minTradingDays ?? 0;
  const maxDays = phase?.maxTradingDays ?? 0;
  const consistencyRuleMax = phase?.consistencyRule ?? 0;
  const weekendHolding = phase?.weekendHolding ?? true;
  const newsTrading = phase?.newsTrading ?? true;
  const maxLeverage = phase?.maxLeverage ?? 100;
  const profitSplit = phase?.profitSplit ?? 0;

  // ── Calculate totals ──
  const totalPnl = tradeHistory.reduce((s, t) => s + t.pnl, 0);
  const totalPnlPct = accountSize > 0 ? (totalPnl / accountSize) * 100 : 0;
  const profitTarget = accountSize * (profitTargetPct / 100);

  // ── Trailing Drawdown ──
  // For trailing DD firms, the max loss level trails up with equity but never down
  let trailingDrawdownLevel = accountSize; // initial level
  let runningEquity = accountSize;
  for (const t of tradeHistory) {
    runningEquity += t.pnl;
    if (trailingDD && runningEquity > trailingDrawdownLevel) {
      trailingDrawdownLevel = runningEquity;
    }
  }
  if (!trailingDD) {
    trailingDrawdownLevel = accountSize; // fixed from start
  }
  const trailingDrawdownLimit = trailingDrawdownLevel * (1 - maxTotalDD / 100);
  const trailingDrawdownPct = trailingDrawdownLevel > 0
    ? ((trailingDrawdownLevel - currentEquity) / trailingDrawdownLevel) * 100
    : 0;

  // ── Trading Days ──
  const tradingDaysSet = new Set<string>();
  for (const t of tradeHistory) {
    tradingDaysSet.add(new Date(t.time).toISOString().slice(0, 10));
  }
  const daysTraded = tradingDaysSet.size;
  const daysSinceStart = config.propStartDate > 0
    ? Math.floor((Date.now() - config.propStartDate) / (1000 * 60 * 60 * 24))
    : daysTraded;
  const daysRemaining = maxDays > 0 ? Math.max(0, maxDays - daysSinceStart) : -1;

  // ── Consistency Rule ──
  const winTrades = tradeHistory.filter(t => t.pnl > 0);
  const totalProfit = winTrades.reduce((s, t) => s + t.pnl, 0);
  const maxSingleTrade = winTrades.length > 0
    ? Math.max(...winTrades.map(t => t.pnl))
    : 0;
  const maxSingleTradePct = totalProfit > 0 ? (maxSingleTrade / totalProfit) * 100 : 0;
  const consistencyScore = consistencyRuleMax > 0
    ? Math.max(0, 100 - (maxSingleTradePct / consistencyRuleMax) * 100)
    : 100;

  // ── Is Weekend? ──
  const now = new Date();
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;

  // ── Build Rules ──

  // Rule 1: Daily Loss Limit
  if (maxDailyLossPct > 0) {
    const pctUsed = Math.abs(dailyPnlPct) / maxDailyLossPct * 100;
    const severity: PropComplianceRule['severity'] =
      dailyPnlPct <= -maxDailyLossPct ? 'violated'
      : pctUsed > 75 ? 'danger'
      : pctUsed > 50 ? 'warning'
      : 'ok';
    rules.push({
      id: 'daily-loss', label: 'Daily Loss Limit',
      passed: dailyPnlPct > -maxDailyLossPct,
      current: `${dailyPnlPct.toFixed(2)}%`,
      limit: `-${maxDailyLossPct}%`,
      severity, pctUsed: Math.min(100, pctUsed),
    });
  }

  // Rule 2: Max Drawdown (trailing or fixed)
  const ddPctUsed = maxTotalDD > 0 ? (trailingDD ? trailingDrawdownPct : drawdownCurrent) / maxTotalDD * 100 : 0;
  const currentDDval = trailingDD ? trailingDrawdownPct : drawdownCurrent;
  const ddSeverity: PropComplianceRule['severity'] =
    currentDDval >= maxTotalDD ? 'violated'
    : ddPctUsed > 75 ? 'danger'
    : ddPctUsed > 50 ? 'warning'
    : 'ok';
  rules.push({
    id: 'max-drawdown', label: trailingDD ? 'Trailing Drawdown' : 'Max Drawdown',
    passed: currentDDval < maxTotalDD,
    current: `${currentDDval.toFixed(2)}%`,
    limit: `${maxTotalDD}%`,
    severity: ddSeverity, pctUsed: Math.min(100, ddPctUsed),
  });

  // Rule 3: Profit Target Progress (challenge/verification only)
  if (profitTargetPct > 0) {
    const progress = Math.max(0, Math.min(100, (totalPnlPct / profitTargetPct) * 100));
    rules.push({
      id: 'profit-target', label: 'Profit Target',
      passed: totalPnlPct >= profitTargetPct,
      current: `${totalPnlPct.toFixed(2)}%`,
      limit: `${profitTargetPct}%`,
      severity: totalPnlPct >= profitTargetPct ? 'ok' : progress > 50 ? 'ok' : 'warning',
      pctUsed: progress,
    });
  }

  // Rule 4: Minimum Trading Days
  if (minDays > 0) {
    const progress = (daysTraded / minDays) * 100;
    rules.push({
      id: 'min-days', label: 'Min Trading Days',
      passed: daysTraded >= minDays,
      current: `${daysTraded}`,
      limit: `${minDays}`,
      severity: daysTraded >= minDays ? 'ok' : 'warning',
      pctUsed: Math.min(100, progress),
    });
  }

  // Rule 5: Max Trading Days / Time Limit
  if (maxDays > 0) {
    const pctUsed = (daysSinceStart / maxDays) * 100;
    rules.push({
      id: 'max-days', label: 'Time Limit',
      passed: daysSinceStart <= maxDays,
      current: `Day ${daysSinceStart}`,
      limit: `${maxDays} days`,
      severity: daysSinceStart > maxDays ? 'violated' : pctUsed > 85 ? 'danger' : pctUsed > 60 ? 'warning' : 'ok',
      pctUsed: Math.min(100, pctUsed),
    });
  }

  // Rule 6: Consistency Rule
  if (consistencyRuleMax > 0) {
    const pctUsed = (maxSingleTradePct / consistencyRuleMax) * 100;
    rules.push({
      id: 'consistency', label: 'Consistency Rule',
      passed: maxSingleTradePct <= consistencyRuleMax,
      current: `${maxSingleTradePct.toFixed(1)}%`,
      limit: `${consistencyRuleMax}%`,
      severity: maxSingleTradePct > consistencyRuleMax ? 'violated' : pctUsed > 80 ? 'danger' : pctUsed > 60 ? 'warning' : 'ok',
      pctUsed: Math.min(100, pctUsed),
    });
  }

  // Rule 7: Weekend Holding
  if (!weekendHolding) {
    rules.push({
      id: 'weekend', label: 'No Weekend Holding',
      passed: !isWeekend,
      current: isWeekend ? 'WEEKEND' : 'Weekday',
      limit: 'Close before Fri',
      severity: isWeekend ? 'danger' : 'ok',
      pctUsed: isWeekend ? 100 : 0,
    });
  }

  // Rule 8: Leverage Check
  if (config.leverage > maxLeverage) {
    rules.push({
      id: 'leverage', label: 'Max Leverage',
      passed: config.leverage <= maxLeverage,
      current: `${config.leverage}x`,
      limit: `${maxLeverage}x`,
      severity: 'violated',
      pctUsed: 100,
    });
  }

  // ── Overall Status ──
  const hasViolation = rules.some(r => r.severity === 'violated');
  const hasDanger = rules.some(r => r.severity === 'danger');
  const overallStatus: PropCompliance['overallStatus'] =
    hasViolation ? 'violated' : hasDanger ? 'warning' : 'compliant';

  // ── Progress to Target ──
  const progressToTarget = profitTargetPct > 0
    ? Math.max(0, Math.min(100, (totalPnlPct / profitTargetPct) * 100))
    : 0;

  // ── Estimated Payout ──
  const estimatedPayout = totalPnl > 0 ? totalPnl * (profitSplit / 100) : 0;

  // ── Account Health (composite score) ──
  const ddHealth = maxTotalDD > 0 ? Math.max(0, 100 - ddPctUsed) : 100;
  const dailyHealth = maxDailyLossPct > 0 ? Math.max(0, 100 - (Math.abs(dailyPnlPct) / maxDailyLossPct * 100)) : 100;
  const consistencyHealth = consistencyRuleMax > 0 ? consistencyScore : 100;
  const accountHealth = (ddHealth * 0.4 + dailyHealth * 0.35 + consistencyHealth * 0.25);

  return {
    rules,
    overallStatus,
    profitTarget,
    profitTargetPct,
    currentProfitPct: totalPnlPct,
    progressToTarget,
    trailingDrawdownLevel,
    trailingDrawdownPct,
    daysTraded,
    minDaysRequired: minDays,
    maxDaysAllowed: maxDays,
    daysRemaining,
    consistencyScore,
    maxSingleTradePct,
    profitSplit,
    estimatedPayout,
    accountHealth,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PILLAR 6: MULTI-TIMEFRAME ANALYSIS (resample 1m candles)
// ═══════════════════════════════════════════════════════════════════════════════

function resampleCandles(candles: CandlestickData[], factor: number): CandlestickData[] {
  if (factor <= 1 || candles.length < factor) return candles;
  const resampled: CandlestickData[] = [];
  for (let i = 0; i <= candles.length - factor; i += factor) {
    const slice = candles.slice(i, i + factor);
    const open = slice[0].open;
    const close = slice[slice.length - 1].close;
    const high = Math.max(...slice.map(c => c.high));
    const low = Math.min(...slice.map(c => c.low));
    const time = slice[slice.length - 1].time;
    resampled.push({ open, high, low, close, time });
  }
  return resampled;
}

function analyzeTimeframeBias(candles: CandlestickData[], tf: string): TimeframeBias | null {
  if (candles.length < 30) return null;
  const ind = calculateIndicatorSnapshot(candles);
  if (!ind) return null;

  const priceAboveEma9 = candles[candles.length - 1].close > ind.ema9;
  const priceAboveEma21 = candles[candles.length - 1].close > ind.ema21;
  const ema9Above21 = ind.ema9 > ind.ema21;
  const rsiBull = ind.rsi > 50;
  const macdBull = ind.macd.histogram > 0;

  let bullPoints = 0;
  if (priceAboveEma9) bullPoints++;
  if (priceAboveEma21) bullPoints++;
  if (ema9Above21) bullPoints++;
  if (rsiBull) bullPoints++;
  if (macdBull) bullPoints++;

  const trend: 'bullish' | 'bearish' | 'neutral' =
    bullPoints >= 4 ? 'bullish' : bullPoints <= 1 ? 'bearish' : 'neutral';
  const strength = Math.abs(bullPoints - 2.5) * 40; // 0-100

  return {
    tf,
    trend,
    strength: Math.min(100, strength),
    ema9: ind.ema9,
    ema21: ind.ema21,
    rsi: ind.rsi,
    macdHist: ind.macd.histogram,
    atr: ind.atr,
  };
}

function analyzeMultiTimeframe(candles: CandlestickData[]): MultiTimeframeAnalysis {
  const timeframes: TimeframeBias[] = [];

  // 1m = raw candles (already have this from main analysis)
  const tf1m = analyzeTimeframeBias(candles, '1m');
  if (tf1m) timeframes.push(tf1m);

  // 5m = resample by 5
  const candles5m = resampleCandles(candles, 5);
  const tf5m = analyzeTimeframeBias(candles5m, '5m');
  if (tf5m) timeframes.push(tf5m);

  // 15m = resample by 15
  const candles15m = resampleCandles(candles, 15);
  const tf15m = analyzeTimeframeBias(candles15m, '15m');
  if (tf15m) timeframes.push(tf15m);

  // 1h = resample by 60
  const candles1h = resampleCandles(candles, 60);
  const tf1h = analyzeTimeframeBias(candles1h, '1h');
  if (tf1h) timeframes.push(tf1h);

  // Determine alignment
  const bullCount = timeframes.filter(t => t.trend === 'bullish').length;
  const bearCount = timeframes.filter(t => t.trend === 'bearish').length;
  const total = timeframes.length;

  const alignment: 'aligned-bull' | 'aligned-bear' | 'mixed' =
    bullCount >= total * 0.75 ? 'aligned-bull'
    : bearCount >= total * 0.75 ? 'aligned-bear'
    : 'mixed';

  // HTF bias (weight higher TFs more)
  const tfWeights: Record<string, number> = { '1m': 0.1, '5m': 0.2, '15m': 0.3, '1h': 0.4 };
  let htfScore = 0;
  let totalWeight = 0;
  for (const tf of timeframes) {
    const w = tfWeights[tf.tf] ?? 0.1;
    const score = tf.trend === 'bullish' ? tf.strength : tf.trend === 'bearish' ? -tf.strength : 0;
    htfScore += score * w;
    totalWeight += w;
  }
  if (totalWeight > 0) htfScore /= totalWeight;

  const htfBias: 'bullish' | 'bearish' | 'neutral' =
    htfScore > 20 ? 'bullish' : htfScore < -20 ? 'bearish' : 'neutral';

  return { timeframes, alignment, htfBias, htfScore };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PENDING SETUPS GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

function generatePendingSetups(
  candles: CandlestickData[],
  orderFlow: OrderFlowAnalysis,
  liquidity: LiquidityAnalysis,
  structure: MarketStructureAnalysis,
  mtf: MultiTimeframeAnalysis,
  currentPrice: number,
  atr: number,
): PendingSetup[] {
  const setups: PendingSetup[] = [];
  const slBuffer = atr * 0.2;

  // ── Setup 1: Long on support bounce ──
  if (liquidity.nearestSupport && liquidity.nearestSupport.midPrice < currentPrice) {
    const support = liquidity.nearestSupport;
    const entryLow = support.midPrice;
    const entryHigh = support.midPrice + atr * 0.3;
    const sl = support.priceLow - slBuffer;
    const risk = entryLow - sl;
    const tp1 = entryLow + risk * 2;
    const tp2 = entryLow + risk * 3.5;

    let conf = 30;
    if (structure.phase === 'accumulation' || structure.phase === 'markup') conf += 15;
    if (mtf.htfBias === 'bullish') conf += 20;
    if (orderFlow.cvdTrend === 'rising') conf += 10;
    if (support.strength > 70) conf += 10;
    conf = Math.min(95, conf);

    const reasons: string[] = [`Support at ${entryLow.toFixed(1)} (strength ${support.strength})`];
    if (structure.phase === 'accumulation') reasons.push('Accumulation phase');
    if (mtf.htfBias === 'bullish') reasons.push('HTF bullish');
    if (orderFlow.cvdTrend === 'rising') reasons.push('CVD rising');

    setups.push({
      id: 'long-support-bounce',
      type: 'long',
      trigger: `Price touches support zone ${entryLow.toFixed(1)}–${entryHigh.toFixed(1)} with bullish reaction`,
      entryZone: { low: entryLow, high: entryHigh },
      stopLoss: sl,
      target1: tp1,
      target2: tp2,
      riskReward: risk > 0 ? (tp1 - entryLow) / risk : 0,
      confidence: conf,
      reasons,
      invalidation: `Break below ${sl.toFixed(1)}`,
    });
  }

  // ── Setup 2: Short on resistance rejection ──
  if (liquidity.nearestResistance && liquidity.nearestResistance.midPrice > currentPrice) {
    const resist = liquidity.nearestResistance;
    const entryHigh = resist.midPrice;
    const entryLow = resist.midPrice - atr * 0.3;
    const sl = resist.priceHigh + slBuffer;
    const risk = sl - entryHigh;
    const tp1 = entryHigh - risk * 2;
    const tp2 = entryHigh - risk * 3.5;

    let conf = 30;
    if (structure.phase === 'distribution' || structure.phase === 'markdown') conf += 15;
    if (structure.trend === 'bearish') conf += 10;
    if (mtf.htfBias === 'bearish') conf += 20;
    if (orderFlow.cvdTrend === 'falling') conf += 10;
    if (resist.strength > 70) conf += 10;
    conf = Math.min(95, conf);

    const reasons: string[] = [`Resistance at ${entryHigh.toFixed(1)} (strength ${resist.strength})`];
    if (structure.trend === 'bearish') reasons.push('Bearish structure');
    if (mtf.htfBias === 'bearish') reasons.push('HTF bearish');
    if (orderFlow.cvdTrend === 'falling') reasons.push('CVD falling');

    setups.push({
      id: 'short-resistance-reject',
      type: 'short',
      trigger: `Price reaches resistance zone ${entryLow.toFixed(1)}–${entryHigh.toFixed(1)} with bearish reaction`,
      entryZone: { low: entryLow, high: entryHigh },
      stopLoss: sl,
      target1: tp1,
      target2: tp2,
      riskReward: risk > 0 ? (entryHigh - tp1) / risk : 0,
      confidence: conf,
      reasons,
      invalidation: `Break above ${sl.toFixed(1)}`,
    });
  }

  // ── Setup 3: FVG fill long ──
  const fvgPOIs = structure.pointsOfInterest.filter(p => p.type === 'fvg');
  const bullFvgPOIs = fvgPOIs.filter((p: PointOfInterest) => p.price < currentPrice && p.direction === 'bullish');
  if (bullFvgPOIs.length > 0) {
    const nearest = bullFvgPOIs.reduce((a: PointOfInterest, b: PointOfInterest) =>
      Math.abs(a.price - currentPrice) < Math.abs(b.price - currentPrice) ? a : b
    );
    const entryMid = nearest.price;
    const entryLow = entryMid - atr * 0.3;
    const entryHigh = entryMid + atr * 0.3;
    const sl = entryLow - atr * 0.5;
    const risk = entryMid - sl;
    const tp1 = entryHigh + risk * 2;
    const tp2 = entryHigh + risk * 4;

    let conf = 35;
    if (mtf.htfBias === 'bullish') conf += 20;
    if (structure.trend === 'bullish') conf += 10;
    if (orderFlow.cvdTrend === 'rising') conf += 10;
    conf = Math.min(90, conf);

    setups.push({
      id: 'long-fvg-fill',
      type: 'long',
      trigger: `Price fills FVG at ${entryLow.toFixed(1)}–${entryHigh.toFixed(1)}`,
      entryZone: { low: entryLow, high: entryHigh },
      stopLoss: sl,
      target1: tp1,
      target2: tp2,
      riskReward: risk > 0 ? (tp1 - entryHigh) / risk : 0,
      confidence: conf,
      reasons: [`FVG at ${entryMid.toFixed(1)}`, `Strength: ${nearest.strength}`, 'Mean reversion entry'],
      invalidation: `Price breaks below ${sl.toFixed(1)} without reaction`,
    });
  }

  // ── Setup 4: FVG fill short ──
  const bearFvgPOIs = fvgPOIs.filter((p: PointOfInterest) => p.price > currentPrice && p.direction === 'bearish');
  if (bearFvgPOIs.length > 0) {
    const nearest = bearFvgPOIs.reduce((a: PointOfInterest, b: PointOfInterest) =>
      Math.abs(a.price - currentPrice) < Math.abs(b.price - currentPrice) ? a : b
    );
    const entryMid = nearest.price;
    const entryLow = entryMid - atr * 0.3;
    const entryHigh = entryMid + atr * 0.3;
    const sl = entryHigh + atr * 0.5;
    const risk = sl - entryMid;
    const tp1 = entryLow - risk * 2;
    const tp2 = entryLow - risk * 4;

    let conf = 35;
    if (mtf.htfBias === 'bearish') conf += 20;
    if (structure.trend === 'bearish') conf += 10;
    if (orderFlow.cvdTrend === 'falling') conf += 10;
    conf = Math.min(90, conf);

    setups.push({
      id: 'short-fvg-fill',
      type: 'short',
      trigger: `Price fills FVG at ${entryLow.toFixed(1)}–${entryHigh.toFixed(1)}`,
      entryZone: { low: entryLow, high: entryHigh },
      stopLoss: sl,
      target1: tp1,
      target2: tp2,
      riskReward: risk > 0 ? (entryLow - tp1) / risk : 0,
      confidence: conf,
      reasons: [`FVG at ${entryMid.toFixed(1)}`, `Strength: ${nearest.strength}`, 'Mean reversion short'],
      invalidation: `Price breaks above ${sl.toFixed(1)}`,
    });
  }

  // ── Setup 5: Structure break continuation ──
  if (structure.mssDetected) {
    const isBullMss = structure.mssDirection === 'bullish';
    const entryPrice = currentPrice;
    const sl = isBullMss
      ? entryPrice - atr * 1.2
      : entryPrice + atr * 1.2;
    const risk = Math.abs(entryPrice - sl);
    const tp1 = isBullMss ? entryPrice + risk * 2 : entryPrice - risk * 2;
    const tp2 = isBullMss ? entryPrice + risk * 3.5 : entryPrice - risk * 3.5;

    let conf = 40;
    if (mtf.alignment === (isBullMss ? 'aligned-bull' : 'aligned-bear')) conf += 25;
    if ((isBullMss && orderFlow.netFlow === 'buying') || (!isBullMss && orderFlow.netFlow === 'selling')) conf += 15;
    conf = Math.min(95, conf);

    setups.push({
      id: `${isBullMss ? 'long' : 'short'}-mss-continuation`,
      type: isBullMss ? 'long' : 'short',
      trigger: `MSS ${structure.mssDirection} confirmed — enter on pullback`,
      entryZone: { low: isBullMss ? entryPrice - atr * 0.3 : entryPrice, high: isBullMss ? entryPrice : entryPrice + atr * 0.3 },
      stopLoss: sl,
      target1: tp1,
      target2: tp2,
      riskReward: risk > 0 ? Math.abs(tp1 - entryPrice) / risk : 0,
      confidence: conf,
      reasons: [`MSS ${structure.mssDirection}`, 'Structure shift entry'],
      invalidation: `Price invalidates MSS below ${sl.toFixed(1)}`,
    });
  }

  // Sort by confidence desc
  setups.sort((a, b) => b.confidence - a.confidence);
  return setups.slice(0, 5); // max 5 setups
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED SIGNAL BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

function buildUnifiedSignal(
  currentPrice: number,
  orderFlow: OrderFlowAnalysis,
  liquidity: LiquidityAnalysis,
  structure: MarketStructureAnalysis,
  execution: ExecutionAnalysis,
  risk: RiskAnalysis,
  mtf: MultiTimeframeAnalysis,
  masterScore: number,
  masterDirection: 'LONG' | 'SHORT' | 'WAIT',
  confidence: number,
  pendingSetups: PendingSetup[],
  atr: number,
): UnifiedSignal {
  // ── Direction with nuance ──
  let direction: UnifiedSignal['direction'] = 'NEUTRAL';
  if (masterDirection === 'LONG' && confidence >= 70) direction = 'STRONG_LONG';
  else if (masterDirection === 'LONG' && confidence >= 50) direction = 'LONG';
  else if (masterScore > 10) direction = 'LEAN_LONG';
  else if (masterDirection === 'SHORT' && confidence >= 70) direction = 'STRONG_SHORT';
  else if (masterDirection === 'SHORT' && confidence >= 50) direction = 'SHORT';
  else if (masterScore < -10) direction = 'LEAN_SHORT';
  else direction = 'NEUTRAL';

  // ── Conviction (refined confidence) ──
  let conviction = confidence;
  if (mtf.alignment === 'aligned-bull' && masterScore > 0) conviction = Math.min(100, conviction + 10);
  else if (mtf.alignment === 'aligned-bear' && masterScore < 0) conviction = Math.min(100, conviction + 10);
  else if (mtf.alignment === 'mixed') conviction = Math.max(0, conviction - 10);

  // ── Key levels ──
  const supportZones = liquidity.zones.filter(z => z.midPrice < currentPrice).sort((a, b) => b.midPrice - a.midPrice);
  const resistZones = liquidity.zones.filter(z => z.midPrice > currentPrice).sort((a, b) => a.midPrice - b.midPrice);

  const keyLevels = {
    strongSupport: supportZones.length > 1 ? supportZones[1].midPrice : currentPrice - atr * 3,
    nearSupport: supportZones.length > 0 ? supportZones[0].midPrice : currentPrice - atr * 1.5,
    currentPrice,
    nearResistance: resistZones.length > 0 ? resistZones[0].midPrice : currentPrice + atr * 1.5,
    strongResistance: resistZones.length > 1 ? resistZones[1].midPrice : currentPrice + atr * 3,
  };

  // ── Pillar summary ──
  const pillarSummary = [
    {
      name: 'Order Flow',
      status: (orderFlow.score > 15 ? 'bullish' : orderFlow.score < -15 ? 'bearish' : 'neutral') as 'bullish' | 'bearish' | 'neutral',
      score: orderFlow.score,
      detail: `CVD ${orderFlow.cvdTrend}, ${orderFlow.netFlow} flow, ${orderFlow.buyPressure.toFixed(0)}/${orderFlow.sellPressure.toFixed(0)} pressure`,
    },
    {
      name: 'Liquidity',
      status: (liquidity.score > 15 ? 'bullish' : liquidity.score < -15 ? 'bearish' : 'neutral') as 'bullish' | 'bearish' | 'neutral',
      score: liquidity.score,
      detail: `Sup: ${keyLevels.nearSupport.toFixed(1)} | Res: ${keyLevels.nearResistance.toFixed(1)} | ${liquidity.zones.length} zones`,
    },
    {
      name: 'Structure',
      status: (structure.trend === 'bullish' ? 'bullish' : structure.trend === 'bearish' ? 'bearish' : 'neutral') as 'bullish' | 'bearish' | 'neutral',
      score: structure.score,
      detail: `${structure.trend} (${structure.trendStrength.toFixed(0)}%) • ${structure.phase} • ${structure.premiumDiscount}`,
    },
    {
      name: 'MTF Alignment',
      status: (mtf.htfBias === 'bullish' ? 'bullish' : mtf.htfBias === 'bearish' ? 'bearish' : 'neutral') as 'bullish' | 'bearish' | 'neutral',
      score: mtf.htfScore,
      detail: `${mtf.alignment} • ${mtf.timeframes.map(t => `${t.tf}:${t.trend[0].toUpperCase()}`).join(' ')}`,
    },
    {
      name: 'Risk',
      status: (risk.heatIndex < 30 ? 'bullish' : risk.heatIndex > 60 ? 'bearish' : 'neutral') as 'bullish' | 'bearish' | 'neutral',
      score: 50 - risk.heatIndex,
      detail: `Heat: ${risk.heatIndex.toFixed(0)} | WR: ${risk.recentWinRate.toFixed(0)}% | DD: ${risk.drawdownCurrent.toFixed(1)}%`,
    },
  ];

  // ── Summary text ──
  let summary: string;
  if (masterDirection !== 'WAIT') {
    summary = `${execution.setupGrade} ${masterDirection} — ${execution.confluenceScore.toFixed(0)}% confluence, ${conviction.toFixed(0)}% conviction`;
  } else {
    const leanDir = masterScore > 5 ? 'bullish' : masterScore < -5 ? 'bearish' : 'neutral';
    const bestSetup = pendingSetups.length > 0 ? pendingSetups[0] : null;
    if (bestSetup) {
      summary = `Leaning ${leanDir} — Best pending: ${bestSetup.type.toUpperCase()} at ${bestSetup.entryZone.low.toFixed(1)}–${bestSetup.entryZone.high.toFixed(1)} (${bestSetup.confidence}% conf)`;
    } else {
      summary = `No setup — market ${leanDir}, ${mtf.alignment} across timeframes`;
    }
  }

  // ── Action advice ──
  let actionAdvice: string;
  if (risk.shouldStop) {
    actionAdvice = '⛔ STOP TRADING — Risk limits reached. Step away.';
  } else if (masterDirection === 'LONG') {
    actionAdvice = `🟢 ENTER LONG at ${execution.entry.toFixed(1)} | SL: ${execution.stopLoss.toFixed(1)} | TP1: ${execution.takeProfit1.toFixed(1)} | R:R ${execution.riskReward.toFixed(1)}`;
  } else if (masterDirection === 'SHORT') {
    actionAdvice = `🔴 ENTER SHORT at ${execution.entry.toFixed(1)} | SL: ${execution.stopLoss.toFixed(1)} | TP1: ${execution.takeProfit1.toFixed(1)} | R:R ${execution.riskReward.toFixed(1)}`;
  } else if (pendingSetups.length > 0) {
    const best = pendingSetups[0];
    actionAdvice = `⏳ WAIT — Set alert at ${best.entryZone.low.toFixed(1)}–${best.entryZone.high.toFixed(1)} for ${best.type.toUpperCase()} setup`;
  } else {
    actionAdvice = '👀 WAIT — No high-probability setup. Protect capital.';
  }

  return {
    direction,
    conviction,
    summary,
    keyLevels,
    pillarSummary,
    actionAdvice,
    pendingSetups,
    mtfAlignment: mtf,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MASTER STRATEGY ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════════

export function runAdvancedStrategy(
  candles: CandlestickData[],
  trades: Trade[],
  orderBook: OrderBook | null,
  tradeHistory: TradeRecord[],
  config: AdvancedConfig = DEFAULT_ADVANCED_CONFIG,
  symbol: string = '',
): AdvancedStrategyResult | null {
  if (candles.length < 50) return null;

  // Calculate indicators
  const indicators = calculateIndicatorSnapshot(candles);
  if (!indicators) return null;

  // Price action analysis
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
    // May fail with insufficient data
  }

  // ── Run all 5 pillars + shadow analysis ──
  const orderFlow = analyzeOrderFlow(candles, trades, orderBook);
  const liquidity = analyzeLiquidity(candles, pa, orderBook);
  const structure = analyzeStructure(candles, indicators, pa);
  const shadows = analyzeShadows(candles, { lookback: 50, clusterLookback: 100 });
  const execution = analyzeExecution(candles, indicators, orderFlow, liquidity, structure, shadows, config);
  const risk = analyzeRisk(execution, config, tradeHistory);

  // ── Multi-Timeframe Analysis ──
  const mtf = analyzeMultiTimeframe(candles);

  // ── Master Score (now includes MTF + shadows) ──
  const mtfBonus = mtf.htfScore * 0.15; // add 15% weight for MTF alignment
  const shadowBonus = shadows.score * 0.10; // add 10% weight for shadow bias
  const masterScore =
    orderFlow.score * config.weights.orderFlow +
    liquidity.score * config.weights.liquidity +
    structure.score * config.weights.structure +
    (execution.confluenceScore - 50) * config.weights.execution +
    (50 - risk.heatIndex) * config.weights.risk +
    mtfBonus +
    shadowBonus;

  // ── Master Direction ──
  let masterDirection: 'LONG' | 'SHORT' | 'WAIT' = execution.direction;
  if (risk.shouldStop || execution.setupGrade === 'NO-TRADE') {
    masterDirection = 'WAIT';
  }

  // ── Master Grade ──
  let masterGrade = execution.setupGrade;
  if (masterDirection === 'WAIT') masterGrade = 'NO-TRADE';

  // ── Confidence (now includes MTF) ──
  let confidence = Math.max(0, Math.min(100,
    execution.confluenceScore * 0.4 +
    (100 - risk.heatIndex) * 0.15 +
    Math.abs(masterScore) * 0.25 +
    (mtf.alignment === 'aligned-bull' || mtf.alignment === 'aligned-bear' ? 20 : 0)
  ));

  // Reduce confidence if MTF conflicts with direction
  if (masterDirection === 'LONG' && mtf.htfBias === 'bearish') confidence *= 0.7;
  if (masterDirection === 'SHORT' && mtf.htfBias === 'bullish') confidence *= 0.7;

  // Boost/reduce confidence based on shadow analysis
  if (masterDirection === 'LONG' && shadows.bias === 'bullish') confidence = Math.min(100, confidence + 5);
  if (masterDirection === 'SHORT' && shadows.bias === 'bearish') confidence = Math.min(100, confidence + 5);
  if (masterDirection === 'LONG' && shadows.bias === 'bearish') confidence *= 0.9;
  if (masterDirection === 'SHORT' && shadows.bias === 'bullish') confidence *= 0.9;

  // ── Pending Setups ──
  const currentPrice = candles[candles.length - 1].close;
  const pendingSetups = generatePendingSetups(
    candles, orderFlow, liquidity, structure, mtf, currentPrice, indicators.atr
  );

  // ── Unified Signal ──
  const unifiedSignal = buildUnifiedSignal(
    currentPrice, orderFlow, liquidity, structure, execution, risk,
    mtf, masterScore, masterDirection, confidence, pendingSetups, indicators.atr
  );

  return {
    timestamp: Date.now(),
    symbol,
    orderFlow,
    liquidity,
    structure,
    execution,
    risk,
    shadows,
    masterScore,
    masterDirection,
    masterGrade,
    confidence,
    unifiedSignal,
    mtf,
  };
}

