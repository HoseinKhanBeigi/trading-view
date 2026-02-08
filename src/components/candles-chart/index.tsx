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
import { analyzeMirrorPatterns, type PatternAnalysis, type PatternSignal } from "@/lib/mirror-patterns";
import { analyzePriceAction, type PriceActionAnalysis, type PriceActionSignal } from "@/lib/price-action";
import { detectAllCandlestickPatterns, getRecentPatterns, type CandlestickPattern } from "@/lib/candlestick-patterns";
import { generateTradeEntries, type TradeSetup, type TradeEntry } from "@/lib/trade-entries";

export default function CandlesChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const seededRef = useRef(false);
  const candles = useMarketStore((s) => s.candles);
  const symbol = useMarketStore((s) => s.symbol);
  const [patternAnalysis, setPatternAnalysis] = useState<PatternAnalysis | null>(null);
  const [priceAction, setPriceAction] = useState<PriceActionAnalysis | null>(null);
  const [candlePatterns, setCandlePatterns] = useState<CandlestickPattern[]>([]);
  const [tradeSetup, setTradeSetup] = useState<TradeSetup | null>(null);
  const last = candles[candles.length - 1];
  const first = candles[0];
  const lastPrice = last?.close;
  const changePct = last && first ? ((last.close - first.open) / first.open) * 100 : undefined;
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const orderBlockLinesRef = useRef<IPriceLine[]>([]);
  const signalLinesRef = useRef<IPriceLine[]>([]);
  const priceActionLinesRef = useRef<IPriceLine[]>([]);
  const tradeEntryLinesRef = useRef<IPriceLine[]>([]);

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
    // Global mirrored price line (mirror of close around first candle open)
    const mirrorSeries: ISeriesApi<'Line'> = chart.addSeries(LineSeries, { 
      color: "#f97316",
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
    });
    // Local mirrored price line (mirror around recent candles - rolling window)
    const localMirrorSeries: ISeriesApi<'Line'> = chart.addSeries(LineSeries, { 
      color: "#a855f7",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
    });

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
            color: index === 0 ? '#10b981' : '#34d399',
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
            color: index === 0 ? '#ef4444' : '#f87171',
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
        minBlockSize: 0.3,
        volumeThreshold: 1.5,
      });

      const currentPrice = candles[candles.length - 1]?.close || 0;
      const active = getActiveOrderBlocks(blocks, currentPrice);

      active.bullish.slice(0, 5).forEach((block: OrderBlock) => {
        const lowLine = series.createPriceLine({
          price: block.low,
          color: block.strength === 'strong' ? '#22c55e' : block.strength === 'medium' ? '#4ade80' : '#86efac',
          lineWidth: block.strength === 'strong' ? 4 : block.strength === 'medium' ? 3 : 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `OB Support ${block.low.toFixed(2)} (${block.strength})`,
        });
        orderBlockLinesRef.current.push(lowLine);

        const highLine = series.createPriceLine({
          price: block.high,
          color: block.strength === 'strong' ? '#22c55e' : block.strength === 'medium' ? '#4ade80' : '#86efac',
          lineWidth: block.strength === 'strong' ? 2 : block.strength === 'medium' ? 1 : 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
        });
        orderBlockLinesRef.current.push(highLine);
      });

      active.bearish.slice(0, 5).forEach((block: OrderBlock) => {
        const highLine = series.createPriceLine({
          price: block.high,
          color: block.strength === 'strong' ? '#dc2626' : block.strength === 'medium' ? '#f87171' : '#fca5a5',
          lineWidth: block.strength === 'strong' ? 4 : block.strength === 'medium' ? 3 : 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `OB Resistance ${block.high.toFixed(2)} (${block.strength})`,
        });
        orderBlockLinesRef.current.push(highLine);

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

    // Function to update price action overlays on the chart
    function updatePriceActionOverlays(analysis: PriceActionAnalysis) {
      // Remove existing price action lines
      priceActionLinesRef.current.forEach(line => {
        try { series.removePriceLine(line); } catch {}
      });
      priceActionLinesRef.current = [];

      // --- Fibonacci levels ---
      analysis.fibLevels.forEach(fib => {
        const color = fib.level === 0.618 ? '#fbbf24' : fib.level === 0.5 ? '#f59e0b' : '#d4a017';
        const line = series.createPriceLine({
          price: fib.price,
          color,
          lineWidth: fib.level === 0.618 || fib.level === 0.5 ? 2 : 1,
          lineStyle: LineStyle.SparseDotted,
          axisLabelVisible: true,
          title: `Fib ${fib.label}`,
        });
        priceActionLinesRef.current.push(line);
      });

      // --- Unfilled FVGs as price lines (top & bottom) ---
      const unfilledFVGs = analysis.fairValueGaps.filter(g => !g.filled).slice(-4);
      unfilledFVGs.forEach(fvg => {
        const color = fvg.type === 'bullish' ? '#22d3ee' : '#f472b6'; // cyan for bullish, pink for bearish
        const highLine = series.createPriceLine({
          price: fvg.high,
          color,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
          title: '',
        });
        priceActionLinesRef.current.push(highLine);
        const lowLine = series.createPriceLine({
          price: fvg.low,
          color,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
          title: '',
        });
        priceActionLinesRef.current.push(lowLine);
        // Midpoint label
        const midLine = series.createPriceLine({
          price: fvg.midpoint,
          color,
          lineWidth: 1,
          lineStyle: LineStyle.LargeDashed,
          axisLabelVisible: true,
          title: `FVG ${fvg.type === 'bullish' ? '▲' : '▼'}`,
        });
        priceActionLinesRef.current.push(midLine);
      });

      // --- Equal levels (liquidity pools) ---
      analysis.equalLevels.filter(l => l.liquidityPool).slice(0, 4).forEach(level => {
        const color = level.type === 'equal-highs' ? '#fb923c' : '#a78bfa'; // orange / purple
        const line = series.createPriceLine({
          price: level.avgPrice,
          color,
          lineWidth: 2,
          lineStyle: LineStyle.LargeDashed,
          axisLabelVisible: true,
          title: `${level.type === 'equal-highs' ? 'EQH' : 'EQL'} x${level.count}`,
        });
        priceActionLinesRef.current.push(line);
      });

      // --- Structure break levels (BOS/CHoCH) from recent breaks ---
      analysis.structureBreaks.slice(-6).forEach(brk => {
        const color = brk.type === 'CHoCH'
          ? (brk.direction === 'bullish' ? '#4ade80' : '#f87171')
          : (brk.direction === 'bullish' ? '#86efac' : '#fca5a5');
        const line = series.createPriceLine({
          price: brk.brokenLevel,
          color,
          lineWidth: brk.type === 'CHoCH' ? 2 : 1,
          lineStyle: brk.type === 'CHoCH' ? LineStyle.Solid : LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${brk.type} ${brk.direction === 'bullish' ? '▲' : '▼'}`,
        });
        priceActionLinesRef.current.push(line);
      });

      // --- Price action signals as price lines ---
      analysis.signals.slice(0, 5).forEach(sig => {
        const color = sig.type === 'BUY'
          ? (sig.strength === 'strong' ? '#10b981' : '#34d399')
          : sig.type === 'SELL'
          ? (sig.strength === 'strong' ? '#ef4444' : '#f87171')
          : '#94a3b8';
        const line = series.createPriceLine({
          price: sig.price,
          color,
          lineWidth: sig.strength === 'strong' ? 3 : sig.strength === 'medium' ? 2 : 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: `${sig.type} ${sig.pattern}`,
        });
        priceActionLinesRef.current.push(line);
      });
    }

    // Function to draw trade entry/SL/TP lines on the chart
    function updateTradeEntryOverlays(setup: TradeSetup) {
      // Remove existing trade entry lines
      tradeEntryLinesRef.current.forEach(line => {
        try { series.removePriceLine(line); } catch {}
      });
      tradeEntryLinesRef.current = [];

      const allEntries = [setup.bestEntry, ...setup.alternativeEntries].filter(Boolean) as TradeEntry[];
      allEntries.forEach((te, idx) => {
        const isBest = idx === 0;
        const isLong = te.direction === 'LONG';

        // Entry line
        const entryLine = series.createPriceLine({
          price: te.entry,
          color: isLong ? '#22c55e' : '#ef4444',
          lineWidth: isBest ? 3 : 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `${isBest ? '★ ' : ''}${te.direction} Entry`,
        });
        tradeEntryLinesRef.current.push(entryLine);

        // Stop Loss line
        const slLine = series.createPriceLine({
          price: te.stopLoss,
          color: '#dc2626',
          lineWidth: isBest ? 2 : 1,
          lineStyle: LineStyle.LargeDashed,
          axisLabelVisible: true,
          title: `${isBest ? '★ ' : ''}SL ${te.stopLoss.toFixed(2)}`,
        });
        tradeEntryLinesRef.current.push(slLine);

        // TP1 line
        const tp1Line = series.createPriceLine({
          price: te.takeProfit1,
          color: '#16a34a',
          lineWidth: isBest ? 2 : 1,
          lineStyle: LineStyle.LargeDashed,
          axisLabelVisible: true,
          title: `${isBest ? '★ ' : ''}TP1 ${te.takeProfit1.toFixed(2)}`,
        });
        tradeEntryLinesRef.current.push(tp1Line);

        // TP2 line (only for best entry)
        if (isBest) {
          const tp2Line = series.createPriceLine({
            price: te.takeProfit2,
            color: '#15803d',
            lineWidth: 1,
            lineStyle: LineStyle.SparseDotted,
            axisLabelVisible: true,
            title: `TP2 ${te.takeProfit2.toFixed(2)}`,
          });
          tradeEntryLinesRef.current.push(tp2Line);
        }
      });
    }

    // Initial load and periodic updates
    updateSupportResistanceLines();
    const supportResistanceInterval = setInterval(updateSupportResistanceLines, 10000);
    
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
      
      // mirrored price series around first candle open (global mirror)
      if (candles.length > 0) {
        const baseOpen = candles[0].open;
        const mirrored = candles.map(c => ({
          time: c.time as any,
          value: 2 * baseOpen - c.close,
        }));
        mirrorSeries.setData(mirrored as any);

        // Local mirror: rolling window around recent candles (last 10 candles)
        const localWindow = 10;
        const localMirrored: { time: any; value: number }[] = [];
        for (let i = 0; i < candles.length; i++) {
          const startIdx = Math.max(0, i - localWindow + 1);
          const recentCandles = candles.slice(startIdx, i + 1);
          const avgOpen = recentCandles.reduce((sum, c) => sum + c.open, 0) / recentCandles.length;
          const currentCandle = candles[i];
          const localMirrorValue = 2 * avgOpen - currentCandle.close;
          localMirrored.push({
            time: currentCandle.time as any,
            value: localMirrorValue,
          });
        }
        localMirrorSeries.setData(localMirrored as any);

        // Analyze patterns between price and global mirror
        const mirrorValues = mirrored.map(m => m.value);
        const analysis = analyzeMirrorPatterns(candles, mirrorValues);
        setPatternAnalysis(analysis);

        // Remove existing signal lines
        signalLinesRef.current.forEach(line => {
          try {
            series.removePriceLine(line);
          } catch {}
        });
        signalLinesRef.current = [];

        // Add price lines for mirror signals
        if (analysis.signals.length > 0) {
          analysis.signals.forEach((signal: PatternSignal) => {
            const lineColor = signal.type === 'BUY' 
              ? signal.strength === 'strong' ? '#10b981' : signal.strength === 'medium' ? '#34d399' : '#86efac'
              : signal.strength === 'strong' ? '#ef4444' : signal.strength === 'medium' ? '#f87171' : '#fca5a5';
            
            const line = series.createPriceLine({
              price: signal.price,
              color: lineColor,
              lineWidth: signal.strength === 'strong' ? 3 : signal.strength === 'medium' ? 2 : 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: true,
              title: `${signal.type} - ${signal.pattern}`,
            });
            signalLinesRef.current.push(line);
          });
        }
      }

      // ── Advanced Price Action Analysis ──
      if (candles.length >= 15) {
        const pa = analyzePriceAction(candles, {
          swingLeftBars: 3,
          swingRightBars: 3,
          fvgMinGapPct: 0.03,
          equalLevelTolerance: 0.12,
          displacementMinPct: 0.4,
        });
        setPriceAction(pa);
        updatePriceActionOverlays(pa);

        // Candlestick pattern detection
        const allPatterns = detectAllCandlestickPatterns(candles, 30);
        const recent = getRecentPatterns(allPatterns, 8);
        setCandlePatterns(recent);

        // ── Trade Entry Generation ──
        const mirrorValues2 = candles.length > 0
          ? candles.map(c => 2 * candles[0].open - c.close)
          : [];
        const mirrorAnalysis2 = candles.length > 0
          ? analyzeMirrorPatterns(candles, mirrorValues2)
          : null;
        const setup = generateTradeEntries(candles, pa, recent, mirrorAnalysis2, '4h');
        setTradeSetup(setup);
        updateTradeEntryOverlays(setup);
      }

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
      priceLinesRef.current.forEach(line => { try { series.removePriceLine(line); } catch {} });
      orderBlockLinesRef.current.forEach(line => { try { series.removePriceLine(line); } catch {} });
      signalLinesRef.current.forEach(line => { try { series.removePriceLine(line); } catch {} });
      priceActionLinesRef.current.forEach(line => { try { series.removePriceLine(line); } catch {} });
      tradeEntryLinesRef.current.forEach(line => { try { series.removePriceLine(line); } catch {} });
      priceLinesRef.current = [];
      orderBlockLinesRef.current = [];
      signalLinesRef.current = [];
      priceActionLinesRef.current = [];
      tradeEntryLinesRef.current = [];
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

        {/* ════════ TRADE ENTRY PANEL ════════ */}
        {tradeSetup && (
          <div className="border-t-2 border-indigo-400 dark:border-indigo-600">
            {/* Header with bias */}
            <div className="px-3 sm:px-4 py-3 bg-gradient-to-r from-indigo-50 via-white to-indigo-50 dark:from-indigo-950/40 dark:via-zinc-900 dark:to-indigo-950/40 flex flex-wrap items-center gap-3 text-xs">
              <span className="font-black text-sm tracking-wide uppercase text-indigo-700 dark:text-indigo-300">
                📍 Trade Entry
              </span>
              <span className={`px-2.5 py-1 rounded-full font-bold text-[11px] uppercase tracking-wider ${
                tradeSetup.bias === 'LONG'
                  ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30'
                  : tradeSetup.bias === 'SHORT'
                  ? 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/30'
                  : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
              }`}>
                Bias: {tradeSetup.bias} {tradeSetup.biasStrength > 0 ? `(${tradeSetup.biasStrength}%)` : ''}
              </span>
            </div>

            {/* Best Entry */}
            {tradeSetup.bestEntry ? (
              <div className={`px-3 sm:px-4 py-3 border-t ${
                tradeSetup.bestEntry.direction === 'LONG'
                  ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40'
                  : 'bg-rose-50/60 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800/40'
              }`}>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className={`text-lg font-black ${
                    tradeSetup.bestEntry.direction === 'LONG'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}>
                    {tradeSetup.bestEntry.direction === 'LONG' ? '🟢' : '🔴'} {tradeSetup.bestEntry.direction}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-semibold">
                    {tradeSetup.bestEntry.pattern}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded font-semibold ${
                    tradeSetup.bestEntry.confidence >= 70
                      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                      : tradeSetup.bestEntry.confidence >= 50
                      ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                      : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                  }`}>
                    {tradeSetup.bestEntry.confidence}% confidence
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded font-semibold ${
                    tradeSetup.bestEntry.status === 'active'
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                      : tradeSetup.bestEntry.status === 'triggered'
                      ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                      : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500'
                  }`}>
                    {tradeSetup.bestEntry.status === 'active' ? '⏳ Pending' : tradeSetup.bestEntry.status === 'triggered' ? '⚡ At Market' : '✗ Invalid'}
                  </span>
                </div>

                {/* Entry / SL / TP grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className={`rounded-lg p-2 text-center ${
                    tradeSetup.bestEntry.direction === 'LONG'
                      ? 'bg-emerald-100 dark:bg-emerald-900/30'
                      : 'bg-rose-100 dark:bg-rose-900/30'
                  }`}>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Entry</div>
                    <div className="font-mono font-black text-base tabular-nums dark-mode-text">
                      {tradeSetup.bestEntry.entry.toFixed(2)}
                    </div>
                  </div>
                  <div className="rounded-lg p-2 text-center bg-red-100 dark:bg-red-900/30">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Stop Loss</div>
                    <div className="font-mono font-black text-base tabular-nums text-red-600 dark:text-red-400">
                      {tradeSetup.bestEntry.stopLoss.toFixed(2)}
                    </div>
                    <div className="text-[10px] text-red-500/80 dark:text-red-400/60">-{tradeSetup.bestEntry.riskPct.toFixed(2)}%</div>
                  </div>
                  <div className="rounded-lg p-2 text-center bg-green-100 dark:bg-green-900/30">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">TP1</div>
                    <div className="font-mono font-black text-base tabular-nums text-green-600 dark:text-green-400">
                      {tradeSetup.bestEntry.takeProfit1.toFixed(2)}
                    </div>
                    <div className="text-[10px] text-green-500/80 dark:text-green-400/60">R:R {tradeSetup.bestEntry.riskReward.toFixed(1)}</div>
                  </div>
                  <div className="rounded-lg p-2 text-center bg-green-50 dark:bg-green-900/20">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">TP2</div>
                    <div className="font-mono font-black text-base tabular-nums text-green-700 dark:text-green-300">
                      {tradeSetup.bestEntry.takeProfit2.toFixed(2)}
                    </div>
                    <div className="text-[10px] text-green-500/80 dark:text-green-400/60">R:R {tradeSetup.bestEntry.riskReward2.toFixed(1)}</div>
                  </div>
                </div>

                {/* Confluences */}
                <div className="mt-2 flex flex-wrap gap-1">
                  {tradeSetup.bestEntry.confluences.map((c, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded text-[9px] bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-medium">
                      ✦ {c}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="px-3 sm:px-4 py-4 border-t border-zinc-100 dark:border-zinc-800 text-center">
                <span className="text-sm text-zinc-400 dark:text-zinc-500 font-medium">
                  ⏸ No high-confidence entry — waiting for setup
                </span>
              </div>
            )}

            {/* Alternative Entries */}
            {tradeSetup.alternativeEntries.length > 0 && (
              <div className="px-3 sm:px-4 py-2 border-t border-zinc-100/60 dark:border-zinc-800/60 bg-zinc-50/40 dark:bg-zinc-900/20">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1">Alternative Entries</div>
                <div className="flex flex-wrap gap-2">
                  {tradeSetup.alternativeEntries.map((alt, idx) => (
                    <div key={idx} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs ${
                      alt.direction === 'LONG'
                        ? 'bg-emerald-50 dark:bg-emerald-950/20 ring-1 ring-emerald-200 dark:ring-emerald-800/40'
                        : 'bg-rose-50 dark:bg-rose-950/20 ring-1 ring-rose-200 dark:ring-rose-800/40'
                    }`}>
                      <span className={`font-bold ${alt.direction === 'LONG' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {alt.direction}
                      </span>
                      <span className="font-mono tabular-nums dark-mode-text">{alt.entry.toFixed(2)}</span>
                      <span className="text-zinc-400">→</span>
                      <span className="text-red-500 font-mono text-[10px]">SL {alt.stopLoss.toFixed(2)}</span>
                      <span className="text-green-500 font-mono text-[10px]">TP {alt.takeProfit1.toFixed(2)}</span>
                      <span className="text-zinc-400 text-[10px]">R:R {alt.riskReward.toFixed(1)} | {alt.confidence}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Mirror Pattern Analysis Panel */}
        {patternAnalysis && patternAnalysis.signals.length > 0 && (
          <div className="px-3 sm:px-4 py-2 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold dark-mode-text">Mirror:</span>
              {patternAnalysis.signals.map((signal, idx) => (
                <span
                  key={idx}
                  className={`px-2 py-1 rounded ${
                    signal.type === 'BUY'
                      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                      : 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400'
                  }`}
                  title={signal.reason}
                >
                  {signal.type} ({signal.pattern})
                </span>
              ))}
              <span className="ml-auto text-zinc-500 dark:text-zinc-400">
                Symmetry: {(patternAnalysis.symmetry * 100).toFixed(0)}% | 
                Trend: {patternAnalysis.trend}
              </span>
            </div>
          </div>
        )}

        {/* ────── Advanced Price Action Panel ────── */}
        {priceAction && (
          <div className="border-t border-zinc-100 dark:border-zinc-800">
            {/* Market Structure Summary */}
            <div className="px-3 sm:px-4 py-2.5 bg-zinc-50/80 dark:bg-zinc-900/40 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold dark-mode-text text-sm">Price Action</span>
              <span className={`px-2 py-0.5 rounded-full font-semibold text-[10px] uppercase tracking-wide ${
                priceAction.trend === 'bullish'
                  ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400'
                  : priceAction.trend === 'bearish'
                  ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-400'
                  : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
              }`}>
                {priceAction.trend} {priceAction.trendStrength.toFixed(0)}%
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${
                priceAction.marketPhase === 'markup' || priceAction.marketPhase === 'accumulation'
                  ? 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400'
                  : priceAction.marketPhase === 'markdown' || priceAction.marketPhase === 'distribution'
                  ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                  : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'
              }`}>
                {priceAction.marketPhase}
              </span>

              {/* Structure summary */}
              <span className="text-zinc-400 dark:text-zinc-500 ml-1">|</span>
              <span className="text-zinc-500 dark:text-zinc-400">
                Swings: {priceAction.swingPoints.length}
              </span>
              <span className="text-zinc-500 dark:text-zinc-400">
                FVG: {priceAction.fairValueGaps.filter(g => !g.filled).length} unfilled
              </span>
              <span className="text-zinc-500 dark:text-zinc-400">
                Sweeps: {priceAction.liquiditySweeps.length}
              </span>
            </div>

            {/* Structure Breaks (BOS/CHoCH) */}
            {priceAction.structureBreaks.length > 0 && (
              <div className="px-3 sm:px-4 py-2 border-t border-zinc-100/60 dark:border-zinc-800/60 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-semibold dark-mode-text">Structure:</span>
                {priceAction.structureBreaks.slice(-5).map((brk, idx) => (
                  <span
                    key={idx}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      brk.type === 'CHoCH'
                        ? brk.direction === 'bullish'
                          ? 'bg-emerald-200 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 ring-1 ring-emerald-400/30'
                          : 'bg-rose-200 dark:bg-rose-900/50 text-rose-800 dark:text-rose-300 ring-1 ring-rose-400/30'
                        : brk.direction === 'bullish'
                          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                          : 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400'
                    }`}
                    title={`${brk.type} ${brk.direction} at ${brk.brokenLevel.toFixed(2)} (${brk.strength})`}
                  >
                    {brk.type} {brk.direction === 'bullish' ? '▲' : '▼'} {brk.brokenLevel.toFixed(2)}
                  </span>
                ))}
              </div>
            )}

            {/* FVGs (Fair Value Gaps) */}
            {priceAction.fairValueGaps.filter(g => !g.filled).length > 0 && (
              <div className="px-3 sm:px-4 py-2 border-t border-zinc-100/60 dark:border-zinc-800/60 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-semibold dark-mode-text">FVG:</span>
                {priceAction.fairValueGaps.filter(g => !g.filled).slice(-5).map((fvg, idx) => (
                  <span
                    key={idx}
                    className={`px-2 py-0.5 rounded text-[10px] ${
                      fvg.type === 'bullish'
                        ? 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400'
                        : 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-400'
                    }`}
                    title={`${fvg.type} FVG: ${fvg.low.toFixed(2)} - ${fvg.high.toFixed(2)} (${fvg.fillPercentage.toFixed(0)}% filled)`}
                  >
                    {fvg.type === 'bullish' ? '▲' : '▼'} {fvg.low.toFixed(2)}–{fvg.high.toFixed(2)}
                  </span>
                ))}
              </div>
            )}

            {/* Liquidity Sweeps */}
            {priceAction.liquiditySweeps.length > 0 && (
              <div className="px-3 sm:px-4 py-2 border-t border-zinc-100/60 dark:border-zinc-800/60 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-semibold dark-mode-text">Sweeps:</span>
                {priceAction.liquiditySweeps.slice(-4).map((sweep, idx) => (
                  <span
                    key={idx}
                    className={`px-2 py-0.5 rounded text-[10px] ${
                      sweep.type === 'sell-side'
                        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                        : 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400'
                    }`}
                    title={`${sweep.type} sweep at ${sweep.sweptLevel.toFixed(2)}, recovered: ${sweep.recovered ? 'yes' : 'no'}`}
                  >
                    {sweep.type === 'sell-side' ? '🔻' : '🔺'} {sweep.sweptLevel.toFixed(2)} ({sweep.strength})
                    {sweep.recovered && ' ✓'}
                  </span>
                ))}
              </div>
            )}

            {/* Equal Levels (Liquidity Pools) */}
            {priceAction.equalLevels.filter(l => l.liquidityPool).length > 0 && (
              <div className="px-3 sm:px-4 py-2 border-t border-zinc-100/60 dark:border-zinc-800/60 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-semibold dark-mode-text">Liquidity:</span>
                {priceAction.equalLevels.filter(l => l.liquidityPool).slice(0, 4).map((level, idx) => (
                  <span
                    key={idx}
                    className={`px-2 py-0.5 rounded text-[10px] ${
                      level.type === 'equal-highs'
                        ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                        : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                    }`}
                  >
                    {level.type === 'equal-highs' ? 'EQH' : 'EQL'} {level.avgPrice.toFixed(2)} x{level.count}
                  </span>
                ))}
              </div>
            )}

            {/* Fibonacci Levels */}
            {priceAction.fibLevels.length > 0 && (
              <div className="px-3 sm:px-4 py-2 border-t border-zinc-100/60 dark:border-zinc-800/60 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-semibold dark-mode-text">Fib:</span>
                {priceAction.fibLevels.filter(f => [0.382, 0.5, 0.618, 0.786].includes(f.level)).map((fib, idx) => (
                  <span key={idx} className="px-2 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 text-[10px]">
                    {fib.label}: {fib.price.toFixed(2)}
                  </span>
                ))}
              </div>
            )}

            {/* Displacements */}
            {priceAction.displacements.length > 0 && (
              <div className="px-3 sm:px-4 py-2 border-t border-zinc-100/60 dark:border-zinc-800/60 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-semibold dark-mode-text">Displacements:</span>
                {priceAction.displacements.slice(-4).map((d, idx) => (
                  <span
                    key={idx}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      d.direction === 'bullish'
                        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                        : 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {d.direction === 'bullish' ? '⚡▲' : '⚡▼'} {d.sizePct.toFixed(2)}% ({d.candles} candles, {d.strength})
                  </span>
                ))}
              </div>
            )}

            {/* Price Action Signals */}
            {priceAction.signals.length > 0 && (
              <div className="px-3 sm:px-4 py-2 border-t border-zinc-100/60 dark:border-zinc-800/60 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-semibold dark-mode-text">PA Signals:</span>
                {priceAction.signals.map((sig, idx) => (
                  <span
                    key={idx}
                    className={`px-2 py-1 rounded font-medium ${
                      sig.type === 'BUY'
                        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                        : sig.type === 'SELL'
                        ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400'
                        : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                    }`}
                    title={sig.reason}
                  >
                    {sig.type} {sig.pattern} ({sig.confidence}%)
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ────── Candlestick Patterns Panel ────── */}
        {candlePatterns.length > 0 && (
          <div className="px-3 sm:px-4 py-2 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-semibold dark-mode-text">Candles:</span>
              {candlePatterns.map((pat, idx) => (
                <span
                  key={idx}
                  className={`px-2 py-1 rounded text-[10px] font-medium ${
                    pat.type === 'bullish'
                      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                      : pat.type === 'bearish'
                      ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400'
                      : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                  }`}
                  title={pat.description}
                >
                  {pat.name} ({pat.strength})
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
