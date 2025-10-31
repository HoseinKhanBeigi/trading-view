This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

### Trading micro-app (Binance)

- Live candlestick chart using `lightweight-charts`, seeded via Binance REST and updated via WebSocket klines.
- Level-2 order book (top 20) with REST snapshot + WS diffs, spread/mid/VWAP, and heatmap shading.
- Order ticket (market-style) with client-side risk checks and balances simulation; orders list with cancel.

Supported intervals: `1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`.

## Getting Started

First, install dependencies and run the dev server:

```bash
npm i
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/[symbol]/page.tsx`. The page auto-updates as you edit the file.

## Tests

Run unit tests (Jest + ts-jest):

```bash
npm test
# or
yarn test
```

Covered:
- `src/lib/orderbook.ts` reducer/helpers (sequence handling, pruning, spread/mid/VWAP)
- `src/lib/candles.ts` trades → 1m OHLC
- `src/lib/risk.ts` validations & PnL calc

## Exchange choice & tradeoffs

- Exchange: Binance — robust public REST/WS, simple klines/depth streams, reliable docs.
- Tradeoffs/assumptions:
  - VWAP bands on chart are SMA-based approximations for visual guidance (not session VWAP).
  - Order ticket simulates best bid/ask around last price; not a full matching engine.
  - Balances are simulated and persisted in localStorage.
  - Order book shows top 20 levels; list rendering optimized for low row count.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# trading-view
