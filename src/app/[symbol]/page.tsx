"use client";
import { useEffect } from "react";
import CandlesChart from "@/components/candles-chart";
import OrderBookPanel from "@/components/OrderBook";
import OrderTicket from "@/components/OrderTicket";
import OrdersList from "@/components/OrdersList";
import FuturesTicket from "@/components/FuturesTicket";
import PositionsPanel from "@/components/PositionsPanel";
import OrdersTable from "@/components/OrdersTable";
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
        <div className="xl:col-span-2 order-2 xl:order-none">
          <SymbolsList />
        </div>
        <div className="xl:col-span-6 space-y-6">
          <CandlesChart />
          <OrderTicket />
          <FuturesTicket />
          <OrdersTable />
          <OrdersList />
        </div>
        <div className="xl:col-span-4 space-y-6">
          <OrderBookPanel />
          <PositionsPanel />
        </div>
      </div>
    </div>
  );
}
