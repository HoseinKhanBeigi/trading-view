import { openWebSocket } from "@/lib/websocket";
import { tradeWsUrl } from "@/lib/binance";
import { useMarketStore } from "@/store";
import type { Trade } from "@/store/types";

export function startTrades(symbol?: string) {
  const state = useMarketStore.getState();
  const sym = (symbol || state.symbol).toUpperCase();
  stopTrades();
  const ws = openWebSocket(tradeWsUrl(sym), {
    onMessage: (e) => {
      try {
        const msg = JSON.parse((e as MessageEvent).data as string);
        const trade: Trade = {
          id: msg.t,
          price: parseFloat(msg.p),
          qty: parseFloat(msg.q),
          isBuyerMaker: Boolean(msg.m),
          time: msg.T,
        };
        useMarketStore.getState().setTrades((prev) => [trade, ...prev].slice(0, 200));
      } catch {}
    },
  });
  useMarketStore.getState().setTradeSocket(ws);
}

export function stopTrades() {
  const ws = useMarketStore.getState().tradeSocket;
  try { ws?.close(); } catch {}
  useMarketStore.getState().setTradeSocket(null);
}


