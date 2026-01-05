export type BookLevel = { price: number; size: number };
export type OrderBook = {
  lastUpdateId: number;
  bids: BookLevel[]; // sorted desc by price
  asks: BookLevel[]; // sorted asc by price
};

export type DepthDiff = {
  U?: number; // first update id in event
  u?: number; // final update id in event
  pu?: number; // prev final update id (sometimes present)
  b: [string, string][];
  a: [string, string][];
};

export function fromSnapshot(snapshot: { lastUpdateId: number; bids: [string, string][]; asks: [string, string][] }): OrderBook {
  return {
    lastUpdateId: snapshot.lastUpdateId,
    bids: normalizeSide(snapshot.bids, 'bids'),
    asks: normalizeSide(snapshot.asks, 'asks'),
  };
}

export function applyDiff(book: OrderBook, diff: DepthDiff): OrderBook {
  if (diff.u == null) return book;
  // Binance rules:
  // - Discard any event where u <= lastUpdateId (already applied/old)
  if (diff.u <= book.lastUpdateId) return book;
  // - Apply if (U <= lastUpdateId + 1) and (u >= lastUpdateId + 1)
  const first = diff.U ?? diff.u; // some streams may omit U
  if (!(first <= book.lastUpdateId + 1 && diff.u >= book.lastUpdateId + 1)) {
    // Alternatively accept if prev final id matches
    if (!(diff.pu != null && diff.pu === book.lastUpdateId)) {
      throw new Error('sequence_desync');
    }
  }

  const nextBids = mergeSide(book.bids, diff.b, 'bids');
  const nextAsks = mergeSide(book.asks, diff.a, 'asks');
  return {
    lastUpdateId: diff.u,
    bids: nextBids,
    asks: nextAsks,
  };
}

export function tryApplyDiff(book: OrderBook, diff: DepthDiff): { ok: true; next: OrderBook } | { ok: false; reason: 'sequence_desync' | 'invalid' } {
  if (diff.u == null) return { ok: false, reason: 'invalid' };
  if (diff.u <= book.lastUpdateId) return { ok: true, next: book };
  const first = diff.U ?? diff.u;
  const bridges = first <= book.lastUpdateId + 1 && diff.u >= book.lastUpdateId + 1;
  const contiguous = diff.pu != null && diff.pu === book.lastUpdateId;
  if (!bridges && !contiguous) return { ok: false, reason: 'sequence_desync' };
  const nextBids = mergeSide(book.bids, diff.b, 'bids');
  const nextAsks = mergeSide(book.asks, diff.a, 'asks');
  return { ok: true, next: { lastUpdateId: diff.u, bids: nextBids, asks: nextAsks } };
}

export function topN(book: OrderBook, n = 20) {
  return { bids: book.bids.slice(0, n), asks: book.asks.slice(0, n) };
}

export function spreadMid(book: OrderBook) {
  const bestBid = book.bids[0]?.price ?? 0;
  const bestAsk = book.asks[0]?.price ?? 0;
  const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
  const mid = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : 0;
  return { spread, mid, bestBid, bestAsk };
}

export function vwapTop20(book: OrderBook) {
  const bids = book.bids.slice(0, 20);
  const asks = book.asks.slice(0, 20);
  const vwap = (levels: BookLevel[]) => {
    let notional = 0;
    let amount = 0;
    for (const l of levels) {
      notional += l.price * l.size;
      amount += l.size;
    }
    return amount > 0 ? notional / amount : 0;
  };
  return { bid: vwap(bids), ask: vwap(asks) };
}

export type SupportResistanceLevel = {
  price: number;
  size: number;
  notional: number; // price * size
  type: 'support' | 'resistance';
  strength: 'weak' | 'medium' | 'strong'; // based on size relative to average
  percentile: number; // 0-100, how large this order is compared to others
};

/**
 * Identify support and resistance levels from large orders in the order book
 * @param book The order book
 * @param options Configuration options
 * @returns Array of support/resistance levels sorted by strength
 */
export function identifySupportResistance(
  book: OrderBook,
  options: {
    minSizePercentile?: number; // Minimum percentile to consider (default: 75th percentile)
    maxLevels?: number; // Maximum number of levels to return per side (default: 10)
    lookbackLevels?: number; // How many levels to analyze (default: 100)
  } = {}
): { support: SupportResistanceLevel[]; resistance: SupportResistanceLevel[] } {
  const {
    minSizePercentile = 75,
    maxLevels = 10,
    lookbackLevels = 100,
  } = options;

  // Analyze bids (support) and asks (resistance)
  const analyzeSide = (
    levels: BookLevel[],
    type: 'support' | 'resistance'
  ): SupportResistanceLevel[] => {
    const analyzed = levels.slice(0, lookbackLevels);
    
    if (analyzed.length === 0) return [];

    // Calculate size statistics
    const sizes = analyzed.map(l => l.size);
    const sortedSizes = [...sizes].sort((a, b) => a - b);
    const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    const medianSize = sortedSizes[Math.floor(sortedSizes.length / 2)];
    const percentileIndex = Math.floor((minSizePercentile / 100) * sortedSizes.length);
    const minSizeThreshold = sortedSizes[percentileIndex] || 0;

    // Identify large orders
    const largeOrders: SupportResistanceLevel[] = analyzed
      .map((level) => {
        const notional = level.price * level.size;
        const percentile = (sortedSizes.filter(s => s <= level.size).length / sortedSizes.length) * 100;
        
        // Determine strength based on size relative to average
        const sizeRatio = level.size / avgSize;
        let strength: 'weak' | 'medium' | 'strong';
        if (sizeRatio >= 3) strength = 'strong';
        else if (sizeRatio >= 1.5) strength = 'medium';
        else strength = 'weak';

        return {
          price: level.price,
          size: level.size,
          notional,
          type,
          strength,
          percentile: Math.round(percentile),
        };
      })
      .filter((level) => level.size >= minSizeThreshold)
      .sort((a, b) => b.size - a.size) // Sort by size descending
      .slice(0, maxLevels)
      .sort((a, b) => (type === 'support' ? b.price - a.price : a.price - b.price)); // Sort by price

    return largeOrders;
  };

  return {
    support: analyzeSide(book.bids, 'support'),
    resistance: analyzeSide(book.asks, 'resistance'),
  };
}

/**
 * Get cumulative order size at a specific price level (including nearby levels within a threshold)
 * Useful for identifying price zones with concentrated orders
 */
export function getCumulativeSizeAtLevel(
  book: OrderBook,
  targetPrice: number,
  priceThreshold: number = 0.001 // 0.1% price difference threshold
): { bidSize: number; askSize: number; totalSize: number } {
  let bidSize = 0;
  let askSize = 0;

  for (const level of book.bids) {
    if (Math.abs(level.price - targetPrice) / targetPrice <= priceThreshold) {
      bidSize += level.size;
    }
  }

  for (const level of book.asks) {
    if (Math.abs(level.price - targetPrice) / targetPrice <= priceThreshold) {
      askSize += level.size;
    }
  }

  return {
    bidSize,
    askSize,
    totalSize: bidSize + askSize,
  };
}

function normalizeSide(levels: [string, string][], side: 'bids' | 'asks'): BookLevel[] {
  const arr = levels
    .map(([p, s]) => ({ price: parseFloat(p), size: parseFloat(s) }))
    .filter((l) => l.size > 0);
  arr.sort((a, b) => (side === 'bids' ? b.price - a.price : a.price - b.price));
  return arr;
}

function mergeSide(existing: BookLevel[], updates: [string, string][], side: 'bids' | 'asks'): BookLevel[] {
  const byPrice = new Map<number, number>();
  for (const l of existing) byPrice.set(l.price, l.size);
  for (const [p, s] of updates) {
    const price = parseFloat(p);
    const size = parseFloat(s);
    if (size === 0) byPrice.delete(price);
    else byPrice.set(price, size);
  }
  const merged: BookLevel[] = Array.from(byPrice.entries()).map(([price, size]) => ({ price, size }));
  merged.sort((a, b) => (side === 'bids' ? b.price - a.price : a.price - b.price));
  return merged;
}


