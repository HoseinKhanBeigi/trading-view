"use client";
import { useEffect } from "react";
import Link from "next/link";
import CandlesChart from "@/components/candles-chart";
import OrderBookPanel from "@/components/OrderBook";
import OrderTicket from "@/components/OrderTicket";
import OrdersList from "@/components/OrdersList";
import FuturesTicket from "@/components/FuturesTicket";
import PositionsPanel from "@/components/PositionsPanel";
import OrdersTable from "@/components/OrdersTable";

import QuantPanel from "@/components/QuantPanel";
import ScalpDashboard from "@/components/ScalpDashboard";
import { useMarketStore } from "@/store";
import { useParams } from "next/navigation";
import { startKlines, stopKlines } from "@/store/actions/candles";
import { SymbolsList } from "@/components/SymbolsList";

export default function SymbolPage() {
  const params = useParams();
  const sym:any = params.symbol
  const setSymbol:any = useMarketStore((s) => s.setSymbol);
  const interval = useMarketStore((s) => s.interval);

  useEffect(() => {
    setSymbol(sym);
    stopKlines();
    startKlines(sym, interval);
  }, [sym]);

  return (
    <div className="bg-white dark-mode-bg dark-mode-text">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-2 order-2 xl:order-none flex flex-col gap-4">
          <Link
            href={`/${(sym || "").toString().toLowerCase()}/orderflow`}
            className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-3 py-2.5 text-sm font-medium dark-mode-text text-center transition-colors"
          >
            Order Flow (ATAS)
          </Link>
          <Link
            href={`/${(sym || "").toString().toLowerCase()}/brr`}
            className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-3 py-2.5 text-sm font-medium dark-mode-text text-center transition-colors"
          >
            CME BRR
          </Link>
          <SymbolsList />
        </div>
        <div className="xl:col-span-6 space-y-6">
          <CandlesChart />
          <QuantPanel />
          <OrderTicket />
          <FuturesTicket />
          <OrdersTable />
          <OrdersList />
        </div>
        <div className="xl:col-span-4 space-y-6">
          <ScalpDashboard />
          <OrderBookPanel />
          <PositionsPanel />

        </div>
      </div>
    </div>
  );
}
