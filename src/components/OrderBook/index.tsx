"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMarketStore } from "@/store";
import { startDepth, stopDepth } from "@/store/actions/depth";
import { tryApplyDiff, fromSnapshot, OrderBook, topN, spreadMid, vwapTop20 } from "@/lib/orderbook";
import { fetchDepthSnapshot } from "@/lib/binance";

export default function OrderBookPanel() {
  const symbol = useMarketStore((s) => s.symbol);
  const [book, setBook] = useState<OrderBook | null>(null);
  const [lastChangedPrice, setLastChangedPrice] = useState<number | null>(null);
  const bufferRef = useRef<any[]>([]);
  const syncingRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    syncingRef.current = true;
    setBook(null);
    bufferRef.current = [];

    // subscribe depth diffs into buffer until snapshot sync
    stopDepth();
    startDepth(symbol, '100ms', (diff) => {
      if (!mounted) return;
      if (syncingRef.current) {
        bufferRef.current.push(diff);
        return;
      }
      setBook((prev) => {
        if (!prev) return prev;
        const res = tryApplyDiff(prev, diff);
        if (!res.ok) {
          if (res.reason === 'sequence_desync') {
            syncingRef.current = true;
            seed();
          }
          return prev;
        }
        const next = res.next;
        const chPrice = changedPrice(prev, next);
        if (chPrice != null) setLastChangedPrice(chPrice);
        return next;
      });
    });

    async function seed() {
      try {
        const snap = await fetchDepthSnapshot(symbol, 1000);
        const base = fromSnapshot(snap);
        // apply buffered diffs that bridge to snapshot
        let curr = base;
        for (const d of bufferRef.current) {
          const res = tryApplyDiff(curr, d);
          if (res.ok) curr = res.next;
        }
        if (!mounted) return;
        setBook(curr);
        bufferRef.current = [];
        syncingRef.current = false;
      } catch {
        // retry snapshot later
        setTimeout(() => mounted && seed(), 1000);
      }
    }
    seed();

    return () => {
      mounted = false;
      stopDepth();
    };
  }, [symbol]);

  const display = useMemo(() => (book ? topN(book, 20) : { bids: [], asks: [] }), [book]);
  const heat = useMemo(() => {
    if (!book) return { bids: { cum: [], max: 0 }, asks: { cum: [], max: 0 } } as any;
    const bids = topN(book, 20).bids;
    const asks = topN(book, 20).asks;
    const cumBids: number[] = [];
    const cumAsks: number[] = [];
    let acc = 0;
    for (const l of bids) { acc += l.size; cumBids.push(acc); }
    acc = 0;
    for (const l of asks) { acc += l.size; cumAsks.push(acc); }
    const maxB = cumBids[cumBids.length - 1] || 0;
    const maxA = cumAsks[cumAsks.length - 1] || 0;
    return { bids: { cum: cumBids, max: maxB }, asks: { cum: cumAsks, max: maxA } };
  }, [book]);
  const meta = useMemo(() => (book ? { ...spreadMid(book), vwap: vwapTop20(book) } : null), [book]);

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 dark-mode-bg overflow-hidden">
      <header className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between dark-mode-bg">
        <h3 className="text-sm font-semibold dark-mode-text">Order Book</h3>
        {meta && (
          <div className="text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-3">
            <span>Spread: {meta.spread.toFixed(2)}</span>
            <span>Mid: {meta.mid.toFixed(2)}</span>
            <span>VWAP20: {meta.vwap.bid.toFixed(2)} / {meta.vwap.ask.toFixed(2)}</span>
          </div>
        )}
      </header>

      <div className="grid grid-cols-2 text-xs">
        <div className="p-2 space-y-1">
          <div className="flex justify-between text-zinc-500">
            <span>Bid Size</span>
            <span>Bid Price</span>
          </div>
          {display.bids.map((l, i) => (
            <Row key={`b-${l.price}`} price={l.price} size={l.size} side="bid" highlight={lastChangedPrice === l.price} heatPct={heat.bids.max ? (heat.bids.cum[i] / heat.bids.max) : 0} />
          ))}
        </div>
        <div className="p-2 space-y-1">
          <div className="flex justify-between text-zinc-500">
            <span>Ask Price</span>
            <span>Ask Size</span>
          </div>
          {display.asks.map((l, i) => (
            <Row key={`a-${l.price}`} price={l.price} size={l.size} side="ask" highlight={lastChangedPrice === l.price} heatPct={heat.asks.max ? (heat.asks.cum[i] / heat.asks.max) : 0} />)
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ price, size, side, highlight, heatPct }: { price: number; size: number; side: 'bid' | 'ask'; highlight: boolean; heatPct: number }) {
  return (
    <div className={`relative flex justify-between px-2 py-1 rounded overflow-hidden ${highlight ? (side === 'bid' ? 'bg-emerald-500/10' : 'bg-rose-500/10') : ''}`}>
      <span
        className={`absolute inset-y-0 ${side==='bid' ? 'left-0 bg-emerald-500/15' : 'right-0 bg-rose-500/15'}`}
        style={{ width: `${Math.max(0, Math.min(100, Math.round(heatPct * 100)))}%` }}
        aria-hidden="true"
      />
      {side === 'bid' ? (
        <>
          <span className="font-mono tabular-nums text-emerald-500">{size.toFixed(6)}</span>
          <span className="font-mono tabular-nums text-emerald-600">{price.toFixed(2)}</span>
        </>
      ) : (
        <>
          <span className="font-mono tabular-nums text-rose-600">{price.toFixed(2)}</span>
          <span className="font-mono tabular-nums text-rose-500">{size.toFixed(6)}</span>
        </>
      )}
    </div>
  );
}

function changedPrice(prev: OrderBook, next: OrderBook): number | null {
  const pb = prev.bids[0]?.price, nb = next.bids[0]?.price;
  if (pb !== nb && nb != null) return nb;
  const pa = prev.asks[0]?.price, na = next.asks[0]?.price;
  if (pa !== na && na != null) return na;
  return null;
}


