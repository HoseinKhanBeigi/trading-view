import { estimateFillPrice, estimatePnL, validateOrder } from '@/lib/risk';

describe('risk checks', () => {
  test('validate buy/sell vs balances', () => {
    const balances = { USD: 1000, BTC: 0.5 };
    // buy ok
    expect(validateOrder('buy', 0.1, balances, 100, 100)).toBeNull();
    // buy insufficient USD
    expect(validateOrder('buy', 20, balances, 100, 100)).toMatch(/Insufficient USD/);
    // sell ok
    expect(validateOrder('sell', 0.1, balances, 100, 100)).toBeNull();
    // sell insufficient BTC
    expect(validateOrder('sell', 1, balances, 100, 100)).toMatch(/Insufficient BTC/);
  });

  test('estimate fill and pnl', () => {
    expect(estimateFillPrice('buy', 99, 101)).toBe(101);
    expect(estimateFillPrice('sell', 99, 101)).toBe(99);
    const pnl = estimatePnL(1, 100, 0.005);
    expect(pnl.up).toBeCloseTo(0.5);
    expect(pnl.down).toBeCloseTo(-0.5);
  });
});


