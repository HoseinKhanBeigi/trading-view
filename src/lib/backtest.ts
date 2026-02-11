import type { CandlestickData } from "lightweight-charts";
import { calculateCompositeScore, type StrategyWeight, type CompositeScore, DEFAULT_STRATEGY_WEIGHTS } from "./quant-strategy";

// ─── Backtest Types ──────────────────────────────────────────────────────────

export type BacktestTrade = {
  id: number;
  direction: 'LONG' | 'SHORT';
  entry: number;
  exit: number;
  stopLoss: number;
  takeProfit: number;
  entryTime: number;
  exitTime: number;
  entryBar: number;
  exitBar: number;
  pnl: number; // absolute P&L
  pnlPct: number; // % P&L
  riskReward: number;
  result: 'win' | 'loss' | 'breakeven';
  strategy: string;
  holdingBars: number;
};

export type BacktestResult = {
  trades: BacktestTrade[];
  summary: BacktestSummary;
  equityCurve: { bar: number; equity: number; drawdown: number }[];
  monthlyReturns: { month: string; pnlPct: number; trades: number }[];
};

export type BacktestSummary = {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  avgRR: number;
  profitFactor: number;
  expectancy: number;
  totalPnlPct: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  avgHoldingBars: number;
  bestTrade: number;
  worstTrade: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
};

export type BacktestConfig = {
  initialCapital: number;
  positionSizePct: number; // % of capital per trade
  maxOpenPositions: number;
  signalThreshold: number; // minimum composite score to enter
  stopLossMultiplier: number; // ATR multiplier for SL
  takeProfitMultiplier: number; // ATR multiplier for TP
  maxHoldingBars: number; // max bars before forced exit
  commission: number; // % per trade (round trip)
  slippage: number; // % slippage per trade
  strategyWeights: StrategyWeight[];
};

const DEFAULT_CONFIG: BacktestConfig = {
  initialCapital: 10000,
  positionSizePct: 2,
  maxOpenPositions: 1,
  signalThreshold: 25,
  stopLossMultiplier: 2,
  takeProfitMultiplier: 4,
  maxHoldingBars: 50,
  commission: 0.1,
  slippage: 0.05,
  strategyWeights: DEFAULT_STRATEGY_WEIGHTS,
};

// ─── Backtest Engine ─────────────────────────────────────────────────────────

export function runBacktest(
  candles: CandlestickData[],
  config: Partial<BacktestConfig> = {}
): BacktestResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const trades: BacktestTrade[] = [];
  const equityCurve: { bar: number; equity: number; drawdown: number }[] = [];

  let equity = cfg.initialCapital;
  let peakEquity = equity;
  let tradeId = 0;

  // We need a lookback of at least 50 candles for indicators
  const startBar = 60;
  const openPositions: {
    direction: 'LONG' | 'SHORT';
    entry: number;
    stopLoss: number;
    takeProfit: number;
    entryBar: number;
    entryTime: number;
    strategy: string;
    positionSize: number;
  }[] = [];

  for (let bar = startBar; bar < candles.length; bar++) {
    const current = candles[bar];
    const currentPrice = current.close;
    const currentHigh = current.high;
    const currentLow = current.low;

    // ─── Check exits for open positions ──
    for (let i = openPositions.length - 1; i >= 0; i--) {
      const pos = openPositions[i];
      let exitPrice: number | null = null;
      let exitReason = '';

      if (pos.direction === 'LONG') {
        if (currentLow <= pos.stopLoss) {
          exitPrice = pos.stopLoss;
          exitReason = 'SL hit';
        } else if (currentHigh >= pos.takeProfit) {
          exitPrice = pos.takeProfit;
          exitReason = 'TP hit';
        } else if (bar - pos.entryBar >= cfg.maxHoldingBars) {
          exitPrice = currentPrice;
          exitReason = 'Max hold';
        }
      } else {
        if (currentHigh >= pos.stopLoss) {
          exitPrice = pos.stopLoss;
          exitReason = 'SL hit';
        } else if (currentLow <= pos.takeProfit) {
          exitPrice = pos.takeProfit;
          exitReason = 'TP hit';
        } else if (bar - pos.entryBar >= cfg.maxHoldingBars) {
          exitPrice = currentPrice;
          exitReason = 'Max hold';
        }
      }

      if (exitPrice !== null) {
        // Apply slippage
        if (pos.direction === 'LONG') {
          exitPrice *= (1 - cfg.slippage / 100);
        } else {
          exitPrice *= (1 + cfg.slippage / 100);
        }

        const pnl = pos.direction === 'LONG'
          ? (exitPrice - pos.entry) * pos.positionSize
          : (pos.entry - exitPrice) * pos.positionSize;
        const pnlPct = (pnl / (pos.entry * pos.positionSize)) * 100;
        const commission = pos.entry * pos.positionSize * cfg.commission / 100 * 2;
        const netPnl = pnl - commission;
        const netPnlPct = (netPnl / (pos.entry * pos.positionSize)) * 100;

        const risk = Math.abs(pos.entry - pos.stopLoss);
        const rr = risk > 0 ? Math.abs(exitPrice - pos.entry) / risk : 0;

        trades.push({
          id: ++tradeId,
          direction: pos.direction,
          entry: pos.entry,
          exit: exitPrice,
          stopLoss: pos.stopLoss,
          takeProfit: pos.takeProfit,
          entryTime: pos.entryTime,
          exitTime: current.time as number,
          entryBar: pos.entryBar,
          exitBar: bar,
          pnl: netPnl,
          pnlPct: netPnlPct,
          riskReward: rr,
          result: netPnl > 0 ? 'win' : netPnl < 0 ? 'loss' : 'breakeven',
          strategy: pos.strategy,
          holdingBars: bar - pos.entryBar,
        });

        equity += netPnl;
        openPositions.splice(i, 1);
      }
    }

    // ─── Check for new entries ──
    if (openPositions.length < cfg.maxOpenPositions) {
      // Use a sliding window of candles up to current bar
      const windowSize = Math.min(bar + 1, 200);
      const window = candles.slice(bar - windowSize + 1, bar + 1);

      if (window.length >= 50) {
        const composite = calculateCompositeScore(window, cfg.strategyWeights);

        if (composite && Math.abs(composite.score) >= cfg.signalThreshold && composite.direction !== 'NEUTRAL') {
          const positionValue = equity * (cfg.positionSizePct / 100);
          const positionSize = positionValue / currentPrice;

          // Apply slippage to entry
          const entryPrice = composite.direction === 'LONG'
            ? currentPrice * (1 + cfg.slippage / 100)
            : currentPrice * (1 - cfg.slippage / 100);

          // Use the best signal's SL/TP or compute from composite
          const bestSignal = composite.signals.sort((a, b) => b.strength - a.strength)[0];
          const stopLoss = bestSignal?.stopLoss ?? (
            composite.direction === 'LONG'
              ? entryPrice * (1 - cfg.stopLossMultiplier / 100)
              : entryPrice * (1 + cfg.stopLossMultiplier / 100)
          );
          const takeProfit = bestSignal?.takeProfit ?? (
            composite.direction === 'LONG'
              ? entryPrice * (1 + cfg.takeProfitMultiplier / 100)
              : entryPrice * (1 - cfg.takeProfitMultiplier / 100)
          );

          openPositions.push({
            direction: composite.direction,
            entry: entryPrice,
            stopLoss,
            takeProfit,
            entryBar: bar,
            entryTime: current.time as number,
            strategy: bestSignal?.strategy ?? 'composite',
            positionSize,
          });
        }
      }
    }

    // Update equity curve
    peakEquity = Math.max(peakEquity, equity);
    const drawdown = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    equityCurve.push({ bar, equity, drawdown });
  }

  // ── Calculate Summary ──
  const summary = calculateSummary(trades, cfg.initialCapital, equityCurve);

  // ── Monthly Returns (simplified by bars) ──
  const monthlyReturns = calculateMonthlyReturns(trades);

  return { trades, summary, equityCurve, monthlyReturns };
}

function calculateSummary(
  trades: BacktestTrade[],
  initialCapital: number,
  equityCurve: { bar: number; equity: number; drawdown: number }[]
): BacktestSummary {
  if (trades.length === 0) {
    return {
      totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0,
      avgWin: 0, avgLoss: 0, avgRR: 0, profitFactor: 0, expectancy: 0,
      totalPnlPct: 0, maxDrawdown: 0, maxDrawdownPct: 0,
      sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0,
      avgHoldingBars: 0, bestTrade: 0, worstTrade: 0,
      maxConsecutiveWins: 0, maxConsecutiveLosses: 0,
    };
  }

  const wins = trades.filter(t => t.result === 'win');
  const losses = trades.filter(t => t.result === 'loss');

  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const totalPnlPct = (totalPnl / initialCapital) * 100;

  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + Math.abs(t.pnlPct), 0) / losses.length : 0;

  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const avgRR = trades.reduce((s, t) => s + t.riskReward, 0) / trades.length;

  // Expectancy = (win% × avg win) - (loss% × avg loss)
  const expectancy = (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss;

  // Max drawdown
  const maxDrawdownPct = equityCurve.length > 0
    ? Math.max(...equityCurve.map(e => e.drawdown))
    : 0;
  const maxDrawdown = maxDrawdownPct * initialCapital / 100;

  // Sharpe Ratio (annualized, assuming daily returns)
  const returns = trades.map(t => t.pnlPct);
  const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const stdReturn = Math.sqrt(
    returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length
  );
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

  // Sortino Ratio (only downside deviation)
  const negReturns = returns.filter(r => r < 0);
  const downsideDev = negReturns.length > 0
    ? Math.sqrt(negReturns.reduce((s, r) => s + r * r, 0) / negReturns.length)
    : 0;
  const sortinoRatio = downsideDev > 0 ? (avgReturn / downsideDev) * Math.sqrt(252) : 0;

  // Calmar Ratio
  const annualizedReturn = totalPnlPct; // Simplified
  const calmarRatio = maxDrawdownPct > 0 ? annualizedReturn / maxDrawdownPct : 0;

  // Consecutive wins/losses
  let maxConsecWins = 0, maxConsecLosses = 0;
  let currentConsecWins = 0, currentConsecLosses = 0;
  for (const t of trades) {
    if (t.result === 'win') {
      currentConsecWins++;
      currentConsecLosses = 0;
      maxConsecWins = Math.max(maxConsecWins, currentConsecWins);
    } else {
      currentConsecLosses++;
      currentConsecWins = 0;
      maxConsecLosses = Math.max(maxConsecLosses, currentConsecLosses);
    }
  }

  return {
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate,
    avgWin,
    avgLoss,
    avgRR,
    profitFactor,
    expectancy,
    totalPnlPct,
    maxDrawdown,
    maxDrawdownPct,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    avgHoldingBars: trades.reduce((s, t) => s + t.holdingBars, 0) / trades.length,
    bestTrade: Math.max(...trades.map(t => t.pnlPct)),
    worstTrade: Math.min(...trades.map(t => t.pnlPct)),
    maxConsecutiveWins: maxConsecWins,
    maxConsecutiveLosses: maxConsecLosses,
  };
}

function calculateMonthlyReturns(trades: BacktestTrade[]): { month: string; pnlPct: number; trades: number }[] {
  const monthMap = new Map<string, { pnlPct: number; trades: number }>();

  for (const trade of trades) {
    const date = new Date(trade.exitTime * 1000);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const existing = monthMap.get(key) ?? { pnlPct: 0, trades: 0 };
    existing.pnlPct += trade.pnlPct;
    existing.trades += 1;
    monthMap.set(key, existing);
  }

  return Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({ month, ...data }));
}

