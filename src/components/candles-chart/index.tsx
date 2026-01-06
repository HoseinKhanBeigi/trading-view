"use client";

import { useEffect, useRef, useState } from "react";
import { ColorType, createChart, CandlestickSeries, LineSeries, ISeriesApi, LineStyle, IPriceLine } from "lightweight-charts";
import { localTimeFormatter } from "@/utils/time";
import { startKlines, stopKlines } from "@/store/actions/candles";
import { useMarketStore } from "@/store";
import { StatusBadge } from "../StatusBadge";
import { LatencyBadge } from "../latencyBadge";
import { ErrorBanner } from "../ErrorBanner";
import TimeframeButtons from "../Timeframe";
import { fetchDepthSnapshot } from "@/lib/binance";
import { fromSnapshot, identifySupportResistance } from "@/lib/orderbook";
import { detectOrderBlocks, getActiveOrderBlocks, type OrderBlock } from "@/lib/order-blocks";

export default function CandlesChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const seededRef = useRef(false);
  const candles = useMarketStore((s) => s.candles);
  const symbol = useMarketStore((s) => s.symbol);
  const last = candles[candles.length - 1];
  const first = candles[0];
  const lastPrice = last?.close;
  const changePct = last && first ? ((last.close - first.open) / first.open) * 100 : undefined;
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const orderBlockLinesRef = useRef<IPriceLine[]>([]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const isDark = document.documentElement.classList.contains('dark');
    const chart = createChart(chartContainerRef.current, {
      layout: {
        textColor: isDark ? "#d1d4dc" : "black",
        background: { type: ColorType.Solid, color: isDark ? "#0b0e11" : "white" },
      },
      localization: {
        timeFormatter: localTimeFormatter,
      },
    });
    const series: ISeriesApi<'Candlestick'> = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });
    // VWAP-style bands (approx using SMA of close with +/-0.5%)
    const vwap: ISeriesApi<'Line'> = chart.addSeries(LineSeries, { color: "#3b82f6", lineWidth: 2 });
    const vwapUp: ISeriesApi<'Line'> = chart.addSeries(LineSeries, { color: "#60a5fa", lineStyle: LineStyle.Dotted });
    const vwapDn: ISeriesApi<'Line'> = chart.addSeries(LineSeries, { color: "#60a5fa", lineStyle: LineStyle.Dotted });

    // Function to update support/resistance lines
    async function updateSupportResistanceLines() {
      const currentSymbol = useMarketStore.getState().symbol;
      if (!currentSymbol) return;
      
      try {
        // Remove existing price lines
        priceLinesRef.current.forEach(line => {
          try {
            series.removePriceLine(line);
          } catch {}
        });
        priceLinesRef.current = [];

        // Fetch order book snapshot
        const snapshot = await fetchDepthSnapshot(currentSymbol, 100);
        const book = fromSnapshot(snapshot);
        const supportResistance = identifySupportResistance(book, {
          minSizePercentile: 70,
          maxLevels: 10,
          lookbackLevels: 100,
        });

        // Add support lines (green, below current price)
        const topSupport = supportResistance.support.slice(0, 5);
        topSupport.forEach((level, index) => {
          const line = series.createPriceLine({
            price: level.price,
            color: index === 0 ? '#10b981' : '#34d399', // Stronger support = brighter green
            lineWidth: index === 0 ? 2 : 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `Support ${level.price.toFixed(2)} (${level.strength})`,
          });
          priceLinesRef.current.push(line);
        });

        // Add resistance lines (red, above current price)
        const topResistance = supportResistance.resistance.slice(0, 5);
        topResistance.forEach((level, index) => {
          const line = series.createPriceLine({
            price: level.price,
            color: index === 0 ? '#ef4444' : '#f87171', // Stronger resistance = brighter red
            lineWidth: index === 0 ? 2 : 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `Resistance ${level.price.toFixed(2)} (${level.strength})`,
          });
          priceLinesRef.current.push(line);
        });
      } catch (error) {
        console.error('Error updating support/resistance lines:', error);
      }
    }

    // Function to update order block lines
    function updateOrderBlockLines() {
      if (candles.length < 10) return;

      // Remove existing order block lines
      orderBlockLinesRef.current.forEach(line => {
        try {
          series.removePriceLine(line);
        } catch {}
      });
      orderBlockLinesRef.current = [];

      // Detect order blocks
      const blocks = detectOrderBlocks(candles, {
        lookback: 50,
        minBlockSize: 0.3, // 0.3% minimum block size
        volumeThreshold: 1.5, // 1.5x average volume
      });

      const currentPrice = candles[candles.length - 1]?.close || 0;
      const active = getActiveOrderBlocks(blocks, currentPrice);

      // Add bullish order blocks (support zones) - shown as green zones with high and low lines
      active.bullish.slice(0, 5).forEach((block: OrderBlock) => {
        // Low line (main support level)
        const lowLine = series.createPriceLine({
          price: block.low,
          color: block.strength === 'strong' ? '#22c55e' : block.strength === 'medium' ? '#4ade80' : '#86efac',
          lineWidth: block.strength === 'strong' ? 4 : block.strength === 'medium' ? 3 : 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `OB Support ${block.low.toFixed(2)} (${block.strength})`,
        });
        orderBlockLinesRef.current.push(lowLine);

        // High line (top of the block zone)
        const highLine = series.createPriceLine({
          price: block.high,
          color: block.strength === 'strong' ? '#22c55e' : block.strength === 'medium' ? '#4ade80' : '#86efac',
          lineWidth: block.strength === 'strong' ? 2 : block.strength === 'medium' ? 1 : 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
        });
        orderBlockLinesRef.current.push(highLine);
      });

      // Add bearish order blocks (resistance zones) - shown as red zones with high and low lines
      active.bearish.slice(0, 5).forEach((block: OrderBlock) => {
        // High line (main resistance level)
        const highLine = series.createPriceLine({
          price: block.high,
          color: block.strength === 'strong' ? '#dc2626' : block.strength === 'medium' ? '#f87171' : '#fca5a5',
          lineWidth: block.strength === 'strong' ? 4 : block.strength === 'medium' ? 3 : 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `OB Resistance ${block.high.toFixed(2)} (${block.strength})`,
        });
        orderBlockLinesRef.current.push(highLine);

        // Low line (bottom of the block zone)
        const lowLine = series.createPriceLine({
          price: block.low,
          color: block.strength === 'strong' ? '#dc2626' : block.strength === 'medium' ? '#f87171' : '#fca5a5',
          lineWidth: block.strength === 'strong' ? 2 : block.strength === 'medium' ? 1 : 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
        });
        orderBlockLinesRef.current.push(lowLine);
      });
    }

    // Initial load and periodic updates
    updateSupportResistanceLines();
    const supportResistanceInterval = setInterval(updateSupportResistanceLines, 10000); // Update every 10 seconds
    
    // Update order blocks when candles change
    let lastCandlesLength = candles.length;
    const unsubCandlesForBlocks = useMarketStore.subscribe((state) => {
      if (state.candles.length !== lastCandlesLength && state.candles.length > 0) {
        lastCandlesLength = state.candles.length;
        updateOrderBlockLines();
      }
    });

    // initial size + responsive resize
    function resizeToContainer() {
      const el = chartContainerRef.current as HTMLDivElement;
      if (!el) return;
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) chart.resize(Math.floor(width), Math.floor(height));
    }
    resizeToContainer();
    chart.timeScale().fitContent();

    const unsubCandles = useMarketStore.subscribe((state) => {
      const candles = state.candles;
      if (!candles || candles.length === 0) {
        setLoading(true);
        return;
      }
      series.setData(candles);
      // compute rolling SMA as proxy VWAP bands
      const window = 50;
      const closes = candles.map(c => c.close);
      const times = candles.map(c => c.time);
      const avg: { time: number; value: number }[] = [];
      const up: { time: number; value: number }[] = [];
      const dn: { time: number; value: number }[] = [];
      let sum = 0;
      for (let i = 0; i < closes.length; i++) {
        sum += closes[i];
        if (i >= window) sum -= closes[i - window];
        const count = Math.min(i + 1, window);
        const m = sum / count;
        const t = times[i] as any;
        avg.push({ time: t, value: m });
        up.push({ time: t, value: m * 1.005 });
        dn.push({ time: t, value: m * 0.995 });
      }
      vwap.setData(avg as any);
      vwapUp.setData(up as any);
      vwapDn.setData(dn as any);
      setLoading(false);
      
    });
    chart.timeScale().scrollToRealTime();

    const ro = new ResizeObserver(() => {
      resizeToContainer();
    });
    ro.observe(chartContainerRef.current);

    const onThemeChange = (e: any) => {
      const dark = e?.detail?.theme ? e.detail.theme === 'dark' : document.documentElement.classList.contains('dark');
      chart.applyOptions({
        layout: {
          textColor: dark ? "#d1d4dc" : "black",
          background: { type: ColorType.Solid, color: dark ? "#0b0e11" : "white" },
        },
      });
    };
    // Observe changes to the `dark` class on <html> to sync chart theme
    const themeObserver = new MutationObserver(() => {
      const dark = document.documentElement.classList.contains('dark');
      chart.applyOptions({
        layout: {
          textColor: dark ? "#d1d4dc" : "black",
          background: { type: ColorType.Solid, color: dark ? "#0b0e11" : "white" },
        },
      });
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('themechange', onThemeChange as any);
    return () => {
      unsubCandles();
      unsubCandlesForBlocks();
      stopKlines();
      clearInterval(supportResistanceInterval);
      priceLinesRef.current.forEach(line => {
        try {
          series.removePriceLine(line);
        } catch {}
      });
      orderBlockLinesRef.current.forEach(line => {
        try {
          series.removePriceLine(line);
        } catch {}
      });
      priceLinesRef.current = [];
      orderBlockLinesRef.current = [];
      chart.remove();
      try { ro.disconnect(); } catch {}
      themeObserver.disconnect();
      window.removeEventListener('themechange', onThemeChange as any);
    };
  }, []);

  return (
    <section className="w-full">
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-sm overflow-hidden ">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-3 sm:px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-950 transition-colors duration-200 dark-mode-bg dark-mode-text">
          <div className="flex items-center gap-3">
            {lastPrice != null && (
              <div className="flex items-center gap-2 text-xs sm:text-sm">
                <span className="font-mono tabular-nums dark-mode-text">{lastPrice.toFixed(2)}</span>
                {changePct != null && (
                  <span className={`font-mono tabular-nums ${changePct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
                  </span>
                )}
              </div>
            )}
            <div className="hidden sm:flex items-center gap-2">
              <StatusBadge />
              <LatencyBadge />
            </div>
          </div>
          <div className="w-full sm:w-auto"><TimeframeButtons /></div>
          <div className="sm:hidden flex items-center gap-2" aria-hidden="true">
            <StatusBadge />
            <LatencyBadge />
          </div>
        </header>

        <div className="relative w-full h-[520px]">
          {loading && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-white/60 dark:bg-black/40 backdrop-blur-sm">
              <div className="rounded-xl bg-white/80 dark:bg-zinc-900/70 shadow-lg px-4 py-3 flex items-center gap-3">
                <div
                  className="h-5 w-5 rounded-full border-4 border-zinc-300 dark:border-zinc-700 border-t-zinc-900 dark:border-t-white animate-spin"
                  role="status"
                  aria-label="Loading"
                />
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Loading candles…</span>
              </div>
            </div>
          )}
          <ErrorBanner />
          <div ref={chartContainerRef} className="w-full h-full " />
        </div>

        <footer className="flex items-center justify-between px-3 sm:px-4 py-2 border-t border-zinc-100 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400 bg-white dark:bg-zinc-950 transition-colors duration-200 dark-mode-bg">
          <span aria-live="polite" className="truncate">Data: Binance klines (REST seed + WS live)</span>
          <span className="hidden sm:inline">Local time shown on X‑axis</span>
        </footer>
      </div>
    </section>
  );
}
