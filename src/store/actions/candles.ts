import { useMarketStore } from "@/store";
import { toUTCTimestamp } from "@/utils/time";
import type { CandlestickData } from "lightweight-charts";

function klineWsUrl(symbol: string, interval: string): string {
  return `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@kline_${interval}`;
}

function klineRestUrl(symbol: string, interval: string, limit = 500): string {
  const u = new URL("https://fapi.binance.com/fapi/v1/klines");
  u.searchParams.set("symbol", symbol.toUpperCase());
  u.searchParams.set("interval", interval);
  u.searchParams.set("limit", String(limit));
  return u.toString();
}

export async function startKlines(symbol?: string, interval?: string) {
  const state = useMarketStore.getState();
  const sym = (symbol || state.symbol).toUpperCase();
  const intv = (interval || state.interval);

  useMarketStore.getState().setConnectionState('connecting');
  useMarketStore.getState().setReconnectAttempts(0);
  useMarketStore.getState().setError(null);
  // bump session and clear any scheduled reconnect
  useMarketStore.getState().bumpSession();
  const existingTimeout = useMarketStore.getState().reconnectTimeoutId;
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    useMarketStore.getState().setReconnectTimeoutId(null);
  }
  // clear previous candles so UI can show loading state
  useMarketStore.getState().clearCandles();
  await seedKlines(sym, intv);
  openKlinesWs(sym, intv);
}

export function stopKlines() {
  const ws = useMarketStore.getState().klineSocket;
  try { ws?.close(); } catch {}
  useMarketStore.getState().setKlineSocket(null);
  const t = useMarketStore.getState().reconnectTimeoutId;
  if (t) {
    clearTimeout(t);
    useMarketStore.getState().setReconnectTimeoutId(null);
  }
  useMarketStore.getState().setConnectionState('disconnected');
}

async function seedKlines(symbol: string, interval: string) {
  try {
    const res = await fetch(klineRestUrl(symbol, interval, 500));
    if (!res.ok) {
      useMarketStore.getState().setError(`Seed failed: ${res.status}`);
      return;
    }
    const raw: any[] = await res.json();
    const data: CandlestickData[] = raw.map((k) => ({
      time: toUTCTimestamp(Math.floor(k[0] / 1000)),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
    }));
    useMarketStore.getState().setCandles(data);
  } catch (err: any) {
    useMarketStore.getState().setError('Seed error');
  }
}

function openKlinesWs(symbol: string, interval: string) {
  stopKlines();
  const session = useMarketStore.getState().sessionId;
  const ws = new WebSocket(klineWsUrl(symbol, interval));
  ws.onopen = () => {
    useMarketStore.getState().setConnectionState('connected');
    useMarketStore.getState().setReconnectAttempts(0);
    useMarketStore.getState().setError(null);
  };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      const k = msg.k;
      if (!k) return;
      const candle: CandlestickData = {
        time: toUTCTimestamp(Math.floor(k.t / 1000)),
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
      };
      const eventTime = typeof msg.E === 'number' ? msg.E : Date.now();
      useMarketStore.getState().setLatencyMs(Date.now() - eventTime);
      const prev = useMarketStore.getState().candles;
      const lastIdx = prev.length - 1;
      if (lastIdx < 0) {
        useMarketStore.getState().setCandles([candle]);
        return;
      }
      const ct = candle.time as unknown as number;
      const lastt = prev[lastIdx].time as unknown as number;

      if (ct === lastt) {
        const next = prev.slice();
        next[lastIdx] = candle;
        useMarketStore.getState().setCandles(next);
      } else if (ct > lastt) {
        useMarketStore.getState().setCandles([...prev, candle].slice(-500));
      } else {
        // Out-of-order update: replace if exists, else insert and re-sort once
        const existingIdx = prev.findIndex((c) => (c.time as unknown as number) === ct);
        if (existingIdx !== -1) {
          const next = prev.slice();
          next[existingIdx] = candle;
          useMarketStore.getState().setCandles(next);
        } else {
          const merged = [...prev, candle];
          merged.sort((a, b) => (a.time as unknown as number) - (b.time as unknown as number));
          useMarketStore.getState().setCandles(merged.slice(-500));
        }
      }
    } catch {}
  };
  ws.onerror = () => {
    useMarketStore.getState().setError('WebSocket error');
  };
  ws.onclose = () => {
    // only reconnect if session hasn't changed
    if (session !== useMarketStore.getState().sessionId) return;
    const attempts = useMarketStore.getState().reconnectAttempts + 1;
    useMarketStore.getState().setReconnectAttempts(attempts);
    useMarketStore.getState().setConnectionState('reconnecting');
    const delay = Math.min(30000, 500 * Math.pow(2, attempts));
    const id = setTimeout(() => {
      // verify session again before reconnect
      if (session === useMarketStore.getState().sessionId) {
        openKlinesWs(symbol, interval);
      }
    }, delay) as unknown as number;
    useMarketStore.getState().setReconnectTimeoutId(id);
  };
  useMarketStore.getState().setKlineSocket(ws);
}


