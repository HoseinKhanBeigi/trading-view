import { openWebSocket } from "@/lib/websocket";
import { depthWsUrl } from "@/lib/binance";
import { useMarketStore } from "@/store";

// Allow an optional onDiff callback for the UI reducer path
export function startDepth(symbol?: string, speed: '100ms' | '1000ms' = '100ms', onDiff?: (diff: any) => void) {
  const state = useMarketStore.getState();
  const sym = (symbol || state.symbol).toUpperCase();
  stopDepth();
  const ws = openWebSocket(depthWsUrl(sym, speed), {
    onMessage: (e) => {
      try {
        const msg = JSON.parse((e as MessageEvent).data as string);
        // Binance depth diff event: U (first), u (final), b, a
        if (onDiff) onDiff(msg);
        // Also store last raw update for other consumers if needed
        useMarketStore.getState().setDepth({ bids: msg.b || [], asks: msg.a || [] } as any);
      } catch {}
    },
  });
  useMarketStore.getState().setDepthSocket(ws);
}

export function stopDepth() {
  const ws = useMarketStore.getState().depthSocket;
  try { ws?.close(); } catch {}
  useMarketStore.getState().setDepthSocket(null);
}

