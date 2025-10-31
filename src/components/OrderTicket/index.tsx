"use client";

import { useEffect, useMemo, useState } from "react";
import { useMarketStore } from "@/store";
import type { Order } from "@/store/slices/orders";
import { toast } from "sonner";
import { estimateFillPrice, estimatePnL, OrderSide, validateOrder } from "@/lib/risk";

export default function OrderTicket() {
  const [qtyBuy, setQtyBuy] = useState<string>('0.01');
  const [qtySell, setQtySell] = useState<string>('0.01');
  const [priceBuy, setPriceBuy] = useState<string>('');
  const [priceSell, setPriceSell] = useState<string>('');
  const [balances, setBalances] = useState({ USD: 10000, BTC: 0.25 });

  // Persist balances
  useEffect(() => {
    try {
      const raw = localStorage.getItem('balances');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.USD === 'number' && typeof parsed?.BTC === 'number') {
          setBalances({ USD: parsed.USD, BTC: parsed.BTC });
        }
      }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('balances', JSON.stringify(balances)); } catch {}
  }, [balances]);
  const candles = useMarketStore((s) => s.candles);
  const last = candles[candles.length - 1];
  const lastPrice = last?.close ?? 0;

  // Approximate best bid/ask around last
  const bestBid = lastPrice ? lastPrice * 0.999 : 0;
  const bestAsk = lastPrice ? lastPrice * 1.001 : 0;

  const symbol = useMarketStore((s) => s.symbol);
  const addOrder = useMarketStore((s) => s.addOrder);

  function place(side: OrderSide, qtyStr: string, priceStr: string) {
    const qty = Number(qtyStr);
    const manual = Number(priceStr);
    const entry = Number.isFinite(manual) && manual > 0 ? manual : estimateFillPrice(side, bestBid, bestAsk);
    const err = validateOrder(side, qty, balances, bestBid, bestAsk);
    if (err) { toast.error(err); return; }
    if (side === 'buy') setBalances((b) => ({ USD: b.USD - qty * entry, BTC: b.BTC + qty }));
    else setBalances((b) => ({ USD: b.USD + qty * entry, BTC: b.BTC - qty }));
    const order: Order = { id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`, time: Date.now(), symbol, side, qty, price: entry, status: 'filled' };
    addOrder(order);
    toast.success('Order placed successfully', { description: `${side.toUpperCase()} ${qty} @ ${entry.toFixed(2)}` });
  }

  return (
    <section className="relative rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 dark-mode-bg dark-mode-text overflow-hidden">
      <header className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between dark-mode-bg">
        <h3 className="text-sm font-semibold dark-mode-text">Order Ticket</h3>
        <div className="text-xs dark-mode-text-secondary">Balances: ${balances.USD.toFixed(2)} / {balances.BTC.toFixed(4)} BTC</div>
      </header>
      <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <FormCard
          title="Buy"
          side="buy"
          qty={qtyBuy}
          setQty={setQtyBuy}
          price={priceBuy}
          setPrice={setPriceBuy}
          bestBid={bestBid}
          bestAsk={bestAsk}
          place={place}
        />
        <FormCard
          title="Sell"
          side="sell"
          qty={qtySell}
          setQty={setQtySell}
          price={priceSell}
          setPrice={setPriceSell}
          bestBid={bestBid}
          bestAsk={bestAsk}
          place={place}
        />
      </div>
    </section>
  );
}

function FormCard({ title, side, qty, setQty, price, setPrice, bestBid, bestAsk, place }: {
  title: string;
  side: OrderSide;
  qty: string;
  setQty: (v: string) => void;
  price: string;
  setPrice: (v: string) => void;
  bestBid: number;
  bestAsk: number;
  place: (side: OrderSide, qty: string, price: string) => void;
}) {
  const parsedQty = Number(qty);
  const manual = Number(price);
  const entry = Number.isFinite(manual) && manual > 0 ? manual : estimateFillPrice(side, bestBid, bestAsk);
  const pnl = estimatePnL(parsedQty || 0, entry, 0.005);
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 bg-white dark:bg-zinc-950 dark-mode-bg dark-mode-text">
      <div className="flex items-center justify-between mb-2">
        <h4 className={`text-sm font-semibold ${side==='buy'?'text-emerald-600':'text-rose-600'}`}>{title}</h4>
      </div>
      <label className="block">
        <span className="dark-mode-text">Quantity (BTC)</span>
        <input value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 w-full px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100" />
      </label>
      <label className="block mt-2">
        <span className="dark-mode-text">Price (optional)</span>
        <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder={`auto (${(side==='buy'?bestAsk:bestBid).toFixed(2)})`} className="mt-1 w-full px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100" />
      </label>
      <div className="text-xs dark-mode-text-secondary grid grid-cols-2 gap-2 mt-2">
        <div>Best Bid: {bestBid.toFixed(2)}</div>
        <div>Best Ask: {bestAsk.toFixed(2)}</div>
        <div>Fill Price: {entry.toFixed(2)}</div>
        <div>Est. PnL ±0.5%: {pnl.up.toFixed(2)} / {pnl.down.toFixed(2)}</div>
        <div className="col-span-2">
          {side==='buy' ? (
            <span>Estimated Cost: <span className="font-mono tabular-nums">{(parsedQty * entry || 0).toFixed(2)}</span> USD</span>
          ) : (
            <span>Estimated Proceeds: <span className="font-mono tabular-nums">{(parsedQty * entry || 0).toFixed(2)}</span> USD</span>
          )}
        </div>
      </div>
      <button onClick={() => place(side, qty, price)} className={`mt-3 w-full py-2 rounded ${side==='buy' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'} text-white`}>
        {title}
      </button>
    </div>
  );
}

