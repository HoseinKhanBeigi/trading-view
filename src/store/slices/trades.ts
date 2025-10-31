import type { Trade } from "@/store/types";

export type TradesSlice = {
  trades: Trade[];
  tradeSocket?: WebSocket | null;
  setTrades: (updater: (prev: Trade[]) => Trade[]) => void;
  setTradeSocket: (ws: WebSocket | null) => void;
  clearTrades: () => void;
};

export const createTradesSlice = (): TradesSlice => ({
  trades: [],
  tradeSocket: null,
  setTrades: function () { throw new Error("setTrades not bound"); },
  setTradeSocket: function () { throw new Error("setTradeSocket not bound"); },
  clearTrades: function () { throw new Error("clearTrades not bound"); },
});


