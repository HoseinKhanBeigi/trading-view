import type { QuantState, StrategyWeight, CompositeScore, QuantSignal } from "@/lib/quant-strategy";
import type { IndicatorSnapshot } from "@/lib/indicators";
import type { BacktestResult } from "@/lib/backtest";
import { DEFAULT_STRATEGY_WEIGHTS } from "@/lib/quant-strategy";

export type QuantSlice = {
  quantState: QuantState | null;
  backtestResult: BacktestResult | null;
  isAutoTrading: boolean;
  strategyWeights: StrategyWeight[];
  setQuantState: (state: QuantState) => void;
  setBacktestResult: (result: BacktestResult | null) => void;
  setAutoTrading: (enabled: boolean) => void;
  setStrategyWeights: (weights: StrategyWeight[]) => void;
  toggleStrategy: (id: string) => void;
};

export const createQuantSlice = (): QuantSlice => ({
  quantState: null,
  backtestResult: null,
  isAutoTrading: false,
  strategyWeights: DEFAULT_STRATEGY_WEIGHTS,
  setQuantState: () => {},
  setBacktestResult: () => {},
  setAutoTrading: () => {},
  setStrategyWeights: () => {},
  toggleStrategy: () => {},
});

