import { create } from "zustand";
import { createTradesSlice, TradesSlice } from "@/store/slices/trades";
import { createDepthSlice, DepthSlice } from "@/store/slices/depth";
import { createSymbolSlice, SymbolSlice } from "@/store/slices/symbol";
import { createCandlesSlice, CandlesSlice } from "@/store/slices/candles";
import { createOrdersSlice, OrdersSlice } from "@/store/slices/orders";
import { createPositionsSlice, PositionsSlice } from "@/store/slices/positions";
import { createQuantSlice, QuantSlice } from "@/store/slices/quant";
import { DEFAULT_STRATEGY_WEIGHTS } from "@/lib/quant-strategy";

export type RootState = TradesSlice & DepthSlice & SymbolSlice & CandlesSlice & OrdersSlice & PositionsSlice & QuantSlice;

export const useMarketStore = create<RootState>((set, get) => {
  const trades = createTradesSlice();
  const depth = createDepthSlice();
  const symbol = createSymbolSlice();
  const candles = createCandlesSlice();
  const orders = createOrdersSlice();
  const positions = createPositionsSlice();
  const quant = createQuantSlice();

  return {
    ...trades,
    ...depth,
    ...symbol,
    ...candles,
    ...orders,
    ...positions,
    ...quant,

    // bind setters to Zustand set API
    setTrades: (updater) => set((s) => ({ trades: updater(s.trades) })),
    setTradeSocket: (ws) => set({ tradeSocket: ws }),
    clearTrades: () => set({ trades: [] }),

    setDepth: (upd) => set({ depth: upd }),
    setDepthSocket: (ws) => set({ depthSocket: ws }),
    clearDepth: () => set({ depth: null }),

    setSymbol: (sym: string) => set({ symbol: sym.toUpperCase() }),

    setInterval: (interval: string) => set({ interval }),
    setCandles: (candles) => set({ candles }),
    setKlineSocket: (ws) => set({ klineSocket: ws }),
    clearCandles: () => set({ candles: [] }),

    setConnectionState: (state) => set({ connectionState: state }),
    setLatencyMs: (ms) => set({ latencyMs: ms }),
    setReconnectAttempts: (n) => set({ reconnectAttempts: n }),
    setReconnectTimeoutId: (id) => set({ reconnectTimeoutId: id ?? null }),
    bumpSession: () => set((s) => ({ sessionId: s.sessionId + 1 })),
    setError: (err) => set({ error: err }),

    // orders actions
    addOrder: (order) => set((s) => ({ orders: [order, ...s.orders].slice(0, 100) })),
    clearOrders: () => set({ orders: [] }),
    cancelOrder: (id) => set((s) => ({ orders: s.orders.map(o => o.id === id ? { ...o, status: 'cancelled' } : o) })),

    // positions actions
    addPosition: (pos) => set((s) => ({ positions: [...s.positions, pos] })),
    closePosition: (id) => set((s) => ({ positions: s.positions.filter(p => p.id !== id) })),
    clearPositions: () => set({ positions: [] }),

    // quant actions
    setQuantState: (state) => set({ quantState: state }),
    setBacktestResult: (result) => set({ backtestResult: result }),
    setAutoTrading: (enabled) => set({ isAutoTrading: enabled }),
    setStrategyWeights: (weights) => set({ strategyWeights: weights }),
    toggleStrategy: (id) => set((s) => ({
      strategyWeights: s.strategyWeights.map(w =>
        w.id === id ? { ...w, enabled: !w.enabled } : w
      ),
    })),
  } as RootState;
});


