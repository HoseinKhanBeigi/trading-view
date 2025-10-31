export type Balances = { USD: number; BTC: number };

export type OrderSide = 'buy' | 'sell';

export function validateOrder(side: OrderSide, qty: number, balances: Balances, bestBid: number, bestAsk: number): string | null {
  if (!Number.isFinite(qty) || qty <= 0) return 'Quantity must be > 0';
  if (side === 'buy') {
    const cost = qty * bestAsk;
    if (cost > balances.USD) return 'Insufficient USD balance';
  } else {
    if (qty > balances.BTC) return 'Insufficient BTC balance';
  }
  return null;
}

export function estimateFillPrice(side: OrderSide, bestBid: number, bestAsk: number): number {
  return side === 'buy' ? bestAsk : bestBid;
}

export function estimatePnL(qty: number, entryPrice: number, movePct: number): { up: number; down: number } {
  const upPrice = entryPrice * (1 + movePct);
  const downPrice = entryPrice * (1 - movePct);
  return {
    up: (upPrice - entryPrice) * qty,
    down: (downPrice - entryPrice) * qty,
  };
}


