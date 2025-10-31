import { aggregateTradesTo1m } from '@/lib/candles';

describe('candles aggregator', () => {
  test('aggregates trades into 1m OHLC', () => {
    const base = new Date('2024-01-01T00:00:00Z').getTime();
    const trades = [
      { price: 100, qty: 0.1, time: base + 5_000 },
      { price: 105, qty: 0.2, time: base + 30_000 },
      { price: 102, qty: 0.1, time: base + 59_000 },
      { price: 101, qty: 0.1, time: base + 61_000 }, // next minute
    ];
    const ohlc = aggregateTradesTo1m(trades);
    expect(ohlc.length).toBe(2);
    expect(ohlc[0]).toEqual({ time: Math.floor(base/60000)*60, open: 100, high: 105, low: 100, close: 102 });
    expect(ohlc[1].open).toBe(101);
  });
});


