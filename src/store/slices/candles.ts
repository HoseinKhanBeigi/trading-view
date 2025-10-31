import type { CandlestickData } from "lightweight-charts";

export type CandlesSlice = {
  interval: string;
  candles: CandlestickData[];
  klineSocket?: WebSocket | null;
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  latencyMs?: number;
  reconnectAttempts: number;
  error?: string | null;
  reconnectTimeoutId?: number | null;
  sessionId: number;
  setInterval: (interval: string) => void;
  setCandles: (candles: CandlestickData[]) => void;
  setKlineSocket: (ws: WebSocket | null) => void;
  setConnectionState: (state: CandlesSlice['connectionState']) => void;
  setLatencyMs: (ms?: number) => void;
  setReconnectAttempts: (n: number) => void;
  setReconnectTimeoutId: (id: number | null) => void;
  bumpSession: () => void;
  setError: (err: string | null) => void;
  clearCandles: () => void;
};

export const createCandlesSlice = (): CandlesSlice => ({
  interval: "1m",
  candles: [],
  klineSocket: null,
  connectionState: 'disconnected',
  latencyMs: undefined,
  reconnectAttempts: 0,
  error: null,
  reconnectTimeoutId: null,
  sessionId: 0,
  setInterval: function () { throw new Error("setInterval not bound"); },
  setCandles: function () { throw new Error("setCandles not bound"); },
  setKlineSocket: function () { throw new Error("setKlineSocket not bound"); },
  setConnectionState: function () { throw new Error("setConnectionState not bound"); },
  setLatencyMs: function () { throw new Error("setLatencyMs not bound"); },
  setReconnectAttempts: function () { throw new Error("setReconnectAttempts not bound"); },
  setReconnectTimeoutId: function () { throw new Error("setReconnectTimeoutId not bound"); },
  bumpSession: function () { throw new Error("bumpSession not bound"); },
  setError: function () { throw new Error("setError not bound"); },
  clearCandles: function () { throw new Error("clearCandles not bound"); },
});


