export type WebSocketHandlers = {
  onOpen?: (ev: Event) => void;
  onMessage?: (data: MessageEvent) => void;
  onError?: (ev: Event) => void;
  onClose?: (ev: CloseEvent) => void;
};

export function openWebSocket(url: string, handlers: WebSocketHandlers = {}): WebSocket {
  const ws = new WebSocket(url);
  if (handlers.onOpen) ws.onopen = handlers.onOpen;
  if (handlers.onMessage) ws.onmessage = handlers.onMessage;
  if (handlers.onError) ws.onerror = handlers.onError as (this: WebSocket, ev: Event) => any;
  if (handlers.onClose) ws.onclose = handlers.onClose;
  return ws;
}


