"use client";

import { useMarketStore } from "@/store";
import { toast } from "sonner";

export default function OrdersList() {
  const orders = useMarketStore((s) => s.orders);
  const cancelOrder = useMarketStore((s) => s.cancelOrder);

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 dark-mode-bg overflow-hidden">
      <header className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 dark-mode-bg">
        <h3 className="text-sm font-semibold dark-mode-text">Recent Orders</h3>
      </header>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800 text-sm">
        {orders.length === 0 && (
          <div className="px-3 py-3 text-zinc-500 dark:text-zinc-400">No orders yet.</div>
        )}
        {orders.map((o) => (
          <div key={o.id} className="px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`px-2 py-0.5 rounded text-xs ${o.side==='buy'?'bg-emerald-600 text-white':'bg-rose-600 text-white'}`}>{o.side.toUpperCase()}</span>
              <span className="font-mono tabular-nums dark-mode-text">{o.qty.toFixed(6)} {o.symbol.slice(0,3)}</span>
              <span className={`text-xs px-2 py-0.5 rounded ${o.status==='cancelled'?'bg-zinc-700 text-white':'bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200'}`}>{o.status}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="font-mono tabular-nums dark-mode-text">{o.price.toFixed(2)}</div>
                <div className="text-xs dark-mode-text-secondary">{new Date(o.time).toLocaleTimeString()}</div>
              </div>
              <button
                className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                onClick={() => { cancelOrder(o.id); toast.info('Order cancelled'); }}
                disabled={o.status==='cancelled'}
              >
                Cancel
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}


