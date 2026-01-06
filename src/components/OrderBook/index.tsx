"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMarketStore } from "@/store";
import { startDepth, stopDepth } from "@/store/actions/depth";
import { tryApplyDiff, fromSnapshot, OrderBook, topN, spreadMid, vwapTop20, identifySupportResistance } from "@/lib/orderbook";
import { fetchDepthSnapshot } from "@/lib/binance";
import { OrderBookStrengthTracker, type StrengthMetrics, type PredictionMetrics } from "@/lib/orderbook-strength";
import { predictPriceFromOrderBook, type PricePrediction } from "@/lib/price-prediction";
import { detectOrderBlocks, getActiveOrderBlocks } from "@/lib/order-blocks";

export default function OrderBookPanel() {
  const symbol = useMarketStore((s) => s.symbol);
  const [book, setBook] = useState<OrderBook | null>(null);
  const [updatedPrices, setUpdatedPrices] = useState<Set<number>>(new Set());
  const [strength10s, setStrength10s] = useState<StrengthMetrics | null>(null);
  const [strength30s, setStrength30s] = useState<StrengthMetrics | null>(null);
  const [strength1m, setStrength1m] = useState<StrengthMetrics | null>(null);
  const [prediction1m, setPrediction1m] = useState<PredictionMetrics | null>(null);
  const [prediction3m, setPrediction3m] = useState<PredictionMetrics | null>(null);
  const [prediction5m, setPrediction5m] = useState<PredictionMetrics | null>(null);
  const bufferRef = useRef<any[]>([]);
  const syncingRef = useRef(false);
  const strengthTrackerRef = useRef<OrderBookStrengthTracker | null>(null);
  const candles = useMarketStore((s) => s.candles);
  const lastPrice = candles[candles.length - 1]?.close ?? 0;
  const [stablePrediction, setStablePrediction] = useState<PricePrediction | null>(null);
  const predictionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastStableDirectionRef = useRef<'UP' | 'DOWN' | 'NEUTRAL' | null>(null);

  useEffect(() => {
    let mounted = true;
    syncingRef.current = true;
    setBook(null);
    bufferRef.current = [];
    
    // Initialize strength tracker
    if (!strengthTrackerRef.current) {
      strengthTrackerRef.current = new OrderBookStrengthTracker();
    } else {
      strengthTrackerRef.current.clear();
    }

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
        
        // Track order book snapshot for strength analysis
        if (strengthTrackerRef.current) {
          strengthTrackerRef.current.addSnapshot(next);
          // Update strength metrics periodically (every 500ms to avoid too frequent updates)
          if (strengthTrackerRef.current.shouldUpdate()) {
            setStrength10s(strengthTrackerRef.current.getStrength10s());
            setStrength30s(strengthTrackerRef.current.getStrength30s());
            setStrength1m(strengthTrackerRef.current.getStrength1m());
            setPrediction1m(strengthTrackerRef.current.getPrediction1m());
            setPrediction3m(strengthTrackerRef.current.getPrediction3m());
            setPrediction5m(strengthTrackerRef.current.getPrediction5m());
          }
        }
        
        const prices = new Set<number>();
        (diff.b || []).forEach(([p]: [string, string]) => prices.add(parseFloat(p)));
        (diff.a || []).forEach(([p]: [string, string]) => prices.add(parseFloat(p)));
        if (prices.size > 0) {
          setUpdatedPrices((old) => {
            const merged = new Set(old);
            prices.forEach((p) => merged.add(p));
            return merged;
          });
          setTimeout(() => {
            setUpdatedPrices((old) => {
              const copy = new Set(old);
              prices.forEach((p) => copy.delete(p));
              return copy;
            });
          }, 800);
        }
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
        
        // Add initial snapshot
        if (strengthTrackerRef.current) {
          strengthTrackerRef.current.addSnapshot(curr);
          setStrength10s(strengthTrackerRef.current.getStrength10s());
          setStrength30s(strengthTrackerRef.current.getStrength30s());
          setStrength1m(strengthTrackerRef.current.getStrength1m());
          setPrediction1m(strengthTrackerRef.current.getPrediction1m());
          setPrediction3m(strengthTrackerRef.current.getPrediction3m());
          setPrediction5m(strengthTrackerRef.current.getPrediction5m());
        }
        
        bufferRef.current = [];
        syncingRef.current = false;
      } catch {
        // retry snapshot later
        setTimeout(() => mounted && seed(), 1000);
      }
    }
    seed();

    // Periodic strength update
    const strengthInterval = setInterval(() => {
      if (strengthTrackerRef.current) {
        setStrength10s(strengthTrackerRef.current.getStrength10s());
        setStrength30s(strengthTrackerRef.current.getStrength30s());
        setStrength1m(strengthTrackerRef.current.getStrength1m());
        setPrediction1m(strengthTrackerRef.current.getPrediction1m());
        setPrediction3m(strengthTrackerRef.current.getPrediction3m());
        setPrediction5m(strengthTrackerRef.current.getPrediction5m());
      }
    }, 500);

    return () => {
      mounted = false;
      stopDepth();
      clearInterval(strengthInterval);
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
  const supportResistance = useMemo(() => {
    if (!book) return { support: [], resistance: [] };
    return identifySupportResistance(book, {
      minSizePercentile: 70, // Show top 30% largest orders (more levels)
      maxLevels: 10, // Detect up to 10 support/resistance levels
      lookbackLevels: 100, // Analyze first 100 levels
    });
  }, [book]);

  // Detect order blocks from candles
  const orderBlocks = useMemo(() => {
    if (candles.length < 10) {
      console.log('Not enough candles for order blocks:', candles.length);
      return { bullish: [], bearish: [] };
    }
    try {
      const blocks = detectOrderBlocks(candles, {
        lookback: 50,
        minBlockSize: 0.2, // Lowered from 0.3 to detect more blocks
        volumeThreshold: 1.3, // Lowered from 1.5 to detect more blocks
      });
      const active = getActiveOrderBlocks(blocks, lastPrice);
      // Debug: log if blocks are found
      console.log('Order blocks:', { 
        total: blocks.length, 
        bullish: active.bullish.length, 
        bearish: active.bearish.length,
        lastPrice,
        blocks: blocks.slice(0, 3).map(b => ({ type: b.type, price: b.price, low: b.low, high: b.high }))
      });
      return active;
    } catch (error) {
      console.error('Error detecting order blocks:', error);
      return { bullish: [], bearish: [] };
    }
  }, [candles, lastPrice]);

  // Calculate dominant side strength indicator
  const dominantSide = useMemo(() => {
    if (!prediction1m) return null;
    
    const isBidStronger = prediction1m.dominantSide === 'bid';
    const strengthDiff = Math.abs(prediction1m.bidStrength - prediction1m.askStrength);
    const confidence = prediction1m.confidence;
    
    return {
      side: isBidStronger ? 'BUY' : 'SELL',
      isBidStronger,
      strengthDiff,
      confidence,
      bidStrength: prediction1m.bidStrength,
      askStrength: prediction1m.askStrength,
    };
  }, [prediction1m]);

  // Calculate price prediction from order book
  const pricePrediction = useMemo<PricePrediction | null>(() => {
    if (!book || !lastPrice || lastPrice === 0) return null;
    
    // Calculate prediction (trend will be 'stable' without previous imbalance, but still accurate)
    return predictPriceFromOrderBook(
      lastPrice,
      book,
      supportResistance.support,
      supportResistance.resistance
    );
  }, [book, lastPrice, supportResistance]);

  // Stabilize prediction to prevent flickering - only update if prediction direction is stable for 1.5 seconds
  useEffect(() => {
    if (predictionTimeoutRef.current) {
      clearTimeout(predictionTimeoutRef.current);
    }

    if (!pricePrediction) {
      // If prediction becomes null, keep last stable prediction for a bit, then clear
      predictionTimeoutRef.current = setTimeout(() => {
        setStablePrediction(null);
        lastStableDirectionRef.current = null;
      }, 2000);
      return;
    }

    // Only update if direction changed or if we don't have a stable prediction yet
    const directionChanged = pricePrediction.direction !== lastStableDirectionRef.current;
    const shouldUpdate = directionChanged || !stablePrediction;

    if (shouldUpdate && pricePrediction.direction !== 'NEUTRAL') {
      predictionTimeoutRef.current = setTimeout(() => {
        // Double-check the direction hasn't changed during the delay
        if (pricePrediction.direction === lastStableDirectionRef.current || 
            lastStableDirectionRef.current === null) {
          setStablePrediction(pricePrediction);
          lastStableDirectionRef.current = pricePrediction.direction;
        }
      }, 1500); // Wait 1.5 seconds before updating to prevent flickering
    }

    return () => {
      if (predictionTimeoutRef.current) {
        clearTimeout(predictionTimeoutRef.current);
      }
    };
  }, [pricePrediction, stablePrediction]);

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 dark-mode-bg overflow-hidden">
      <header className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 dark-mode-bg">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold dark-mode-text">Order Book</h3>
          {meta && (
            <div className="text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-3">
              <span>Spread: {meta.spread.toFixed(2)}</span>
              <span>Mid: {meta.mid.toFixed(2)}</span>
              <span>VWAP20: {meta.vwap.bid.toFixed(2)} / {meta.vwap.ask.toFixed(2)}</span>
            </div>
          )}
        </div>
        {/* Real-time Dominant Side Indicator */}
        {dominantSide && (
          <div className="mb-2">
            <div className={`flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border-2 ${
              dominantSide.isBidStronger
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
            }`}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold">
                  {dominantSide.isBidStronger ? '🟢' : '🔴'} {dominantSide.side} SIDE STRONGER
                </span>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  ({dominantSide.strengthDiff.toFixed(1)}% diff • {dominantSide.confidence.toFixed(0)}% confidence)
                </span>
              </div>
            </div>
            <div className="flex items-center justify-center gap-4 mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
              <span className="flex items-center gap-1">
                <span className="text-emerald-500">BUY:</span>
                <span className="font-mono font-semibold">{dominantSide.bidStrength.toFixed(1)}%</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="text-rose-500">SELL:</span>
                <span className="font-mono font-semibold">{dominantSide.askStrength.toFixed(1)}%</span>
              </span>
            </div>
          </div>
        )}
        {/* Price Prediction Indicator */}
        {stablePrediction && stablePrediction.direction !== 'NEUTRAL' && (
          <div className="mb-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
            <div className={`flex flex-col gap-1.5 px-3 py-2 rounded-lg border ${
              stablePrediction.direction === 'UP'
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-rose-500/10 border-rose-500/30'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${
                    stablePrediction.direction === 'UP' 
                      ? 'text-emerald-600 dark:text-emerald-400' 
                      : 'text-rose-600 dark:text-rose-400'
                  }`}>
                    {stablePrediction.direction === 'UP' ? '📈' : '📉'} PRICE PREDICTION: {stablePrediction.direction}
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {stablePrediction.confidence}% confidence
                  </span>
                </div>
              </div>
              {stablePrediction.targetPrice && (
                <div className="text-[10px] text-zinc-600 dark:text-zinc-400">
                  Target: <span className="font-mono font-semibold">{stablePrediction.targetPrice.toFixed(2)}</span>
                  {stablePrediction.stopLoss && (
                    <> • Stop: <span className="font-mono font-semibold">{stablePrediction.stopLoss.toFixed(2)}</span></>
                  )}
                </div>
              )}
              <div className="text-[10px] text-zinc-500 dark:text-zinc-400 italic">
                {stablePrediction.reasoning.slice(0, 2).join(' • ')}
              </div>
            </div>
          </div>
        )}
        {/* Strength Indicators */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <StrengthIndicator label="10s" metrics={strength10s} />
            <StrengthIndicator label="30s" metrics={strength30s} />
            <StrengthIndicator label="1m" metrics={strength1m} />
          </div>
          <div className="text-[10px] text-zinc-400 dark:text-zinc-500 italic">
            Based on volume (top 20 levels) • Percentages show volume distribution, values show USD amounts
          </div>
        </div>
        {/* Predictions */}
        {/* {(prediction1m || prediction3m || prediction5m) && (
          <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
            <div className="text-[10px] text-zinc-500 dark:text-zinc-400 font-semibold mb-1.5">
              Predictions (Trend-based):
            </div>
            <div className="flex items-center gap-3 text-xs flex-wrap">
              <PredictionIndicator label="+1m" prediction={prediction1m} />
              <PredictionIndicator label="+3m" prediction={prediction3m} />
              <PredictionIndicator label="+5m" prediction={prediction5m} />
            </div>
          </div>
        )} */}
        {/* Order Blocks */}
        {(orderBlocks.bullish.length > 0 || orderBlocks.bearish.length > 0) && (
          <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
            <div className="text-[10px] text-zinc-500 dark:text-zinc-400 font-semibold mb-1.5">
              📦 Order Blocks (Institutional Zones):
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div>
                <div className="text-emerald-600 dark:text-emerald-400 font-semibold mb-1">🟢 Bullish OB (Support):</div>
                {orderBlocks.bullish.slice(0, 5).map((block, i) => {
                  const distance = ((lastPrice - block.price) / lastPrice * 100);
                  return (
                    <div key={i} className="flex items-center justify-between mb-1 p-1 rounded bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
                      <div className="flex flex-col">
                        <span className="text-emerald-600 dark:text-emerald-400 font-mono font-semibold">
                          {block.low.toFixed(2)} - {block.high.toFixed(2)}
                        </span>
                        <span className="text-[9px] text-zinc-500">
                          {distance > 0 ? `${distance.toFixed(2)}% below` : `${Math.abs(distance).toFixed(2)}% above`}
                        </span>
                      </div>
                      <span className={`text-[9px] font-semibold ${
                        block.strength === 'strong' ? 'text-emerald-500' : 
                        block.strength === 'medium' ? 'text-yellow-500' : 
                        'text-zinc-400'
                      }`}>
                        {block.strength.toUpperCase()}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div>
                <div className="text-rose-600 dark:text-rose-400 font-semibold mb-1">🔴 Bearish OB (Resistance):</div>
                {orderBlocks.bearish.slice(0, 5).map((block, i) => {
                  const distance = ((block.price - lastPrice) / lastPrice * 100);
                  return (
                    <div key={i} className="flex items-center justify-between mb-1 p-1 rounded bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800">
                      <div className="flex flex-col">
                        <span className="text-rose-600 dark:text-rose-400 font-mono font-semibold">
                          {block.low.toFixed(2)} - {block.high.toFixed(2)}
                        </span>
                        <span className="text-[9px] text-zinc-500">
                          {distance > 0 ? `${distance.toFixed(2)}% above` : `${Math.abs(distance).toFixed(2)}% below`}
                        </span>
                      </div>
                      <span className={`text-[9px] font-semibold ${
                        block.strength === 'strong' ? 'text-rose-500' : 
                        block.strength === 'medium' ? 'text-yellow-500' : 
                        'text-zinc-400'
                      }`}>
                        {block.strength.toUpperCase()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {/* Support/Resistance Levels */}
        {(supportResistance.support.length > 0 || supportResistance.resistance.length > 0) && (
          <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
            <div className="text-[10px] text-zinc-500 dark:text-zinc-400 font-semibold mb-1.5">
              Support/Resistance (Large Orders):
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div>
                <div className="text-emerald-600 dark:text-emerald-400 font-semibold mb-1">Support (Bids):</div>
                {supportResistance.support.slice(0, 5).map((level, i) => (
                  <div key={i} className="flex items-center justify-between mb-0.5">
                    <span className="text-emerald-500 font-mono">{level.price.toFixed(2)}</span>
                    <span className="text-zinc-500">
                      {formatCurrency(level.notional)} 
                      <span className={`ml-1 ${
                        level.strength === 'strong' ? 'text-emerald-400' : 
                        level.strength === 'medium' ? 'text-yellow-500' : 
                        'text-zinc-400'
                      }`}>
                        ({level.strength})
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-rose-600 dark:text-rose-400 font-semibold mb-1">Resistance (Asks):</div>
                {supportResistance.resistance.slice(0, 5).map((level, i) => (
                  <div key={i} className="flex items-center justify-between mb-0.5">
                    <span className="text-rose-500 font-mono">{level.price.toFixed(2)}</span>
                    <span className="text-zinc-500">
                      {formatCurrency(level.notional)}
                      <span className={`ml-1 ${
                        level.strength === 'strong' ? 'text-rose-400' : 
                        level.strength === 'medium' ? 'text-yellow-500' : 
                        'text-zinc-400'
                      }`}>
                        ({level.strength})
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </header>

      <div className="grid grid-cols-2 text-xs">
        <div className="p-2 space-y-1">
          <div className="grid grid-cols-[1.1fr_1.2fr_1fr] items-center gap-3 text-zinc-500 px-3 font-mono tabular-nums whitespace-nowrap">
            <span>Bid Size</span>
            <span>Bid Total</span>
            <span className="text-right">Bid Price</span>
          </div>
          {display.bids.map((l, i) => (
            <Row key={`b-${l.price}`} price={l.price} size={l.size} total={l.size * l.price} side="bid" highlight={updatedPrices.has(l.price)} heatPct={heat.bids.max ? (heat.bids.cum[i] / heat.bids.max) : 0} />
          ))}
        </div>
        <div className="p-2 space-y-1">
          <div className="grid grid-cols-[1fr_1.2fr_1.1fr] items-center gap-3 text-zinc-500 px-3 font-mono tabular-nums whitespace-nowrap">
            <span>Ask Price</span>
            <span>Ask Total</span>
            <span className="text-right">Ask Size</span>
          </div>
          {display.asks.map((l, i) => (
            <Row key={`a-${l.price}`} price={l.price} size={l.size} total={l.size * l.price} side="ask" highlight={updatedPrices.has(l.price)} heatPct={heat.asks.max ? (heat.asks.cum[i] / heat.asks.max) : 0} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Row({ price, size, total, side, highlight, heatPct }: { price: number; size: number; total: number; side: 'bid' | 'ask'; highlight: boolean; heatPct: number }) {
  return (
    <div className={`relative grid grid-cols-[1.1fr_1.2fr_1fr] items-center gap-3 px-3 py-1 rounded overflow-hidden transition-colors font-mono tabular-nums whitespace-nowrap ${highlight ? (side === 'bid' ? 'bg-emerald-500/15' : 'bg-rose-500/15') : ''}`}>
      <span
        className={`absolute inset-y-0 ${side==='bid' ? 'left-0 bg-emerald-500/15' : 'right-0 bg-rose-500/15'} z-0 pointer-events-none`}
        style={{ width: `${Math.max(0, Math.min(100, Math.round(heatPct * 100)))}%` }}
        aria-hidden="true"
      />
      {side === 'bid' ? (
        <>
          <span className="relative z-10 text-emerald-500">{size.toFixed(4)}</span>
          <span className="relative z-10 text-zinc-500 text-center">{total.toFixed(2)}</span>
          <span className="relative z-10 text-right text-emerald-600">{price.toFixed(2)}</span>
        </>
      ) : (
        <>
          <span className="relative z-10 text-rose-600">{price.toFixed(2)}</span>
          <span className="relative z-10 text-zinc-500 text-center">{total.toFixed(2)}</span>
          <span className="relative z-10 text-right text-rose-500">{size.toFixed(4)}</span>
        </>
      )}
    </div>
  );
}

function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(2)}M`;
  } else if (value >= 1000) {
    return `$${(value / 1000).toFixed(2)}K`;
  } else {
    return `$${value.toFixed(2)}`;
  }
}

function PredictionIndicator({ label, prediction }: { label: string; prediction: PredictionMetrics | null }) {
  if (!prediction) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-zinc-500 dark:text-zinc-400">{label}:</span>
        <span className="text-zinc-400 dark:text-zinc-500">-</span>
      </div>
    );
  }

  const isBidStronger = prediction.dominantSide === 'bid';
  const isAskStronger = prediction.dominantSide === 'ask';
  const confidenceColor = prediction.confidence >= 70 
    ? 'text-emerald-500 dark:text-emerald-400' 
    : prediction.confidence >= 40 
    ? 'text-yellow-500 dark:text-yellow-400' 
    : 'text-rose-500 dark:text-rose-400';

  const trendIcon = prediction.trend === 'increasing' 
    ? '↗' 
    : prediction.trend === 'decreasing' 
    ? '↘' 
    : '→';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-zinc-500 dark:text-zinc-400 font-medium text-[11px]">{label}:</span>
        <div className="flex items-center gap-1.5">
          {/* BUY Indicator */}
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded ${
            isBidStronger 
              ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' 
              : 'bg-emerald-500/10 text-emerald-600/70 dark:text-emerald-400/70 border border-emerald-500/10'
          }`} title="Predicted buy volume percentage">
            <span className="font-semibold text-[11px]">BUY</span>
            <span className="text-[10px]">({prediction.bidStrength.toFixed(1)}%)</span>
          </div>
          {/* SELL Indicator */}
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded ${
            isAskStronger
              ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30'
              : 'bg-rose-500/10 text-rose-600/70 dark:text-rose-400/70 border border-rose-500/10'
          }`} title="Predicted sell volume percentage">
            <span className="font-semibold text-[11px]">SELL</span>
            <span className="text-[10px]">({prediction.askStrength.toFixed(1)}%)</span>
          </div>
        </div>
      </div>
      {/* Dollar amounts and confidence */}
      <div className="flex items-center gap-2 pl-8">
        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">
          {formatCurrency(prediction.avgBidNotional)}
        </span>
        <span className="text-[10px] text-zinc-400">/</span>
        <span className="text-[10px] text-rose-600 dark:text-rose-400 font-mono">
          {formatCurrency(prediction.avgAskNotional)}
        </span>
        <span className="text-[9px] text-zinc-400 dark:text-zinc-500 mx-1">•</span>
        <span className={`text-[9px] font-mono ${confidenceColor}`} title="Prediction confidence">
          {prediction.confidence}%
        </span>
        <span className="text-[9px] text-zinc-400 dark:text-zinc-500" title={`Trend: ${prediction.trend}`}>
          {trendIcon}
        </span>
      </div>
    </div>
  );
}

function StrengthIndicator({ label, metrics }: { label: string; metrics: StrengthMetrics | null }) {
  if (!metrics) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-zinc-500 dark:text-zinc-400">{label}:</span>
        <span className="text-zinc-400 dark:text-zinc-500">-</span>
      </div>
    );
  }

  const isBidStronger = metrics.dominantSide === 'bid';
  const isAskStronger = metrics.dominantSide === 'ask';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-zinc-500 dark:text-zinc-400 font-medium text-[11px]">{label}:</span>
        <div className="flex items-center gap-1.5">
          {/* BUY Indicator */}
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded ${
            isBidStronger 
              ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' 
              : 'bg-emerald-500/10 text-emerald-600/70 dark:text-emerald-400/70 border border-emerald-500/10'
          }`} title="Buy volume percentage">
            <span className="font-semibold text-[11px]">BUY</span>
            <span className="text-[10px]">({metrics.bidStrength.toFixed(1)}%)</span>
          </div>
          {/* SELL Indicator */}
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded ${
            isAskStronger
              ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30'
              : 'bg-rose-500/10 text-rose-600/70 dark:text-rose-400/70 border border-rose-500/10'
          }`} title="Sell volume percentage">
            <span className="font-semibold text-[11px]">SELL</span>
            <span className="text-[10px]">({metrics.askStrength.toFixed(1)}%)</span>
          </div>
        </div>
      </div>
      {/* Dollar amounts */}
      <div className="flex items-center gap-2 pl-8">
        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">
          {formatCurrency(metrics.avgBidNotional)}
        </span>
        <span className="text-[10px] text-zinc-400">/</span>
        <span className="text-[10px] text-rose-600 dark:text-rose-400 font-mono">
          {formatCurrency(metrics.avgAskNotional)}
        </span>
      </div>
    </div>
  );
}


