import { applyDiff, tryApplyDiff, fromSnapshot, spreadMid, vwapTop20 } from '@/lib/orderbook';

describe('orderbook reducer', () => {
  const snapshot = {
    lastUpdateId: 100,
    bids: [['100.0','1.0'], ['99.5','2.0']],
    asks: [['100.5','1.5'], ['101.0','3.0']],
  };

  test('fromSnapshot sorts and filters', () => {
    const book = fromSnapshot(snapshot as any);
    expect(book.bids[0].price).toBe(100.0);
    expect(book.asks[0].price).toBe(100.5);
  });

  test('apply bridged diff', () => {
    const book = fromSnapshot(snapshot as any);
    const diff = { U: 100, u: 101, b: [['100.0','0.5']], a: [] };
    const next = applyDiff(book, diff as any);
    expect(next.lastUpdateId).toBe(101);
    expect(next.bids[0].size).toBeCloseTo(0.5);
  });

  test('prune to zero removes level', () => {
    const book = fromSnapshot(snapshot as any);
    const diff = { U: 101, u: 102, b: [['99.5','0']], a: [] };
    const next = applyDiff(book, diff as any);
    expect(next.bids.find(l => l.price === 99.5)).toBeUndefined();
  });

  test('bridging across multiple u advances correctly', () => {
    let book = fromSnapshot(snapshot as any);
    // first diff bridges our lastUpdateId (100) to 102
    book = applyDiff(book, { U: 100, u: 102, b: [['100.0','0.9']], a: [] } as any);
    expect(book.lastUpdateId).toBe(102);
    // contiguous diff based on previous u
    const res = tryApplyDiff(book, { pu: 102, u: 103, b: [['100.5','1']], a: [] } as any);
    expect(res.ok).toBe(true);
    expect(res.ok && res.next.lastUpdateId).toBe(103);
  });

  test('tryApplyDiff returns desync when out-of-order', () => {
    const book = fromSnapshot(snapshot as any);
    const res = tryApplyDiff(book, { U: 200, u: 200, b: [], a: [] } as any);
    expect(res.ok).toBe(false);
  });

  test('spread and VWAP', () => {
    const book = fromSnapshot(snapshot as any);
    const s = spreadMid(book);
    expect(s.spread).toBeCloseTo(0.5);
    const v = vwapTop20(book);
    expect(v.bid).toBeGreaterThan(0);
    expect(v.ask).toBeGreaterThan(0);
  });
});


