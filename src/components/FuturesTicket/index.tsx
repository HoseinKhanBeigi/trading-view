"use client";

import { useEffect, useState } from "react";
import { useMarketStore } from "@/store";
import type { Position } from "@/store/slices/positions";
import { toast } from "sonner";

type OrderType = 'market' | 'limit' | 'trigger';

export default function FuturesTicket() {
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [size, setSize] = useState<string>('0.01');
  const [value, setValue] = useState<string>(''); // USDT value input
  const [limitPrice, setLimitPrice] = useState<string>('');
  const [triggerPrice, setTriggerPrice] = useState<string>('');
  const [leverage, setLeverage] = useState<number>(10);
  const [balances, setBalances] = useState({ USD: 10000 });
  const [walletBalance, setWalletBalance] = useState<string>('10000');
  const symbol = useMarketStore((s) => s.symbol);
  const addPosition = useMarketStore((s) => s.addPosition);
  const candles = useMarketStore((s) => s.candles);
  const last = candles[candles.length - 1];
  const lastPrice = last?.close ?? 0;

  useEffect(() => {
    try {
      const raw = localStorage.getItem('futures-balances');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.USD === 'number') {
          setBalances({ USD: parsed.USD });
          setWalletBalance(parsed.USD.toString());
        }
      }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('futures-balances', JSON.stringify(balances)); } catch {}
  }, [balances]);

  const parsedSize = Number(size);
  const parsedValue = Number(value);
  const parsedLimit = Number(limitPrice);
  const parsedTrigger = Number(triggerPrice);
  const entryPrice = orderType === 'market' 
    ? lastPrice 
    : orderType === 'limit' && parsedLimit > 0 
      ? parsedLimit 
      : orderType === 'trigger' && parsedTrigger > 0 
        ? parsedTrigger 
        : lastPrice;
  const finalSize = value && entryPrice > 0 ? (parsedValue / entryPrice) : parsedSize;
  const margin = entryPrice > 0 ? (finalSize * entryPrice / leverage) : 0;
  const notional = entryPrice > 0 ? (finalSize * entryPrice) : 0;
  // Liquidation price calculation
  const liquidationPrice = entryPrice > 0 && leverage > 0
    ? side === 'long'
      ? entryPrice * (1 - 1 / leverage) // Long liquidates when price drops
      : entryPrice * (1 + 1 / leverage)  // Short liquidates when price rises
    : 0;

  function openPosition() {
    if (lastPrice <= 0) {
      toast.error('Waiting for price data...');
      return;
    }
    if (value && (!Number.isFinite(parsedValue) || parsedValue <= 0)) {
      toast.error('Invalid value');
      return;
    }
    if (!value && (!Number.isFinite(parsedSize) || parsedSize <= 0)) {
      toast.error('Invalid size');
      return;
    }
    if (finalSize <= 0) {
      toast.error('Invalid size calculation');
      return;
    }
    if (orderType === 'limit' && (!Number.isFinite(parsedLimit) || parsedLimit <= 0)) {
      toast.error('Invalid limit price');
      return;
    }
    if (orderType === 'trigger' && (!Number.isFinite(parsedTrigger) || parsedTrigger <= 0)) {
      toast.error('Invalid trigger price');
      return;
    }
    if (margin > balances.USD) {
      toast.error('Insufficient margin');
      return;
    }
    const pos: Position = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      symbol,
      side,
      size: finalSize,
      entryPrice: orderType === 'market' ? lastPrice : entryPrice,
      orderPrice: orderType === 'limit' ? parsedLimit : undefined,
      triggerPrice: orderType === 'trigger' ? parsedTrigger : undefined,
      leverage,
      margin,
      orderType,
      time: Date.now(),
      status: orderType === 'market' ? 'filled' : 'pending',
      filled: orderType === 'market' ? finalSize : 0,
      fee: notional * 0.001, // 0.1% fee
    };
    addPosition(pos);
    setBalances((b) => ({ USD: b.USD - margin }));
    toast.success('Position opened', { 
      description: `${side.toUpperCase()} ${parsedSize} @ ${entryPrice.toFixed(2)} (${leverage}x, ${orderType})` 
    });
  }

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 dark-mode-bg dark-mode-text overflow-hidden">
      <header className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between dark-mode-bg">
        <h3 className="text-sm font-semibold dark-mode-text">Futures (Mock)</h3>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={walletBalance}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (val >= 0) {
                setWalletBalance(e.target.value);
                setBalances({ USD: val });
              }
            }}
            className="w-24 px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
            placeholder="USDT"
          />
          <span className="text-xs dark-mode-text-secondary">Balance: ${balances.USD.toFixed(2)}</span>
        </div>
      </header>
      <div className="p-3 space-y-3 text-sm">
        <div className="flex gap-2">
          <button
            className={`px-3 py-1 rounded border transition-colors ${side==='long'
              ? 'bg-emerald-600 text-white border-emerald-600'
              : 'bg-white/90 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
            onClick={() => setSide('long')}
          >
            Long
          </button>
          <button
            className={`px-3 py-1 rounded border transition-colors ${side==='short'
              ? 'bg-rose-600 text-white border-rose-600'
              : 'bg-white/90 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
            onClick={() => setSide('short')}
          >
            Short
          </button>
        </div>
        <div className="flex gap-2">
          <button
            className={`px-2 py-1 rounded text-xs border transition-colors ${orderType==='market'
              ? 'bg-sky-600 text-white border-sky-600'
              : 'bg-white/90 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
            onClick={() => setOrderType('market')}
          >
            قیمت بازار
          </button>
          <button
            className={`px-2 py-1 rounded text-xs border transition-colors ${orderType==='limit'
              ? 'bg-sky-600 text-white border-sky-600'
              : 'bg-white/90 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
            onClick={() => setOrderType('limit')}
          >
            لیمیت
          </button>
          <button
            className={`px-2 py-1 rounded text-xs border transition-colors ${orderType==='trigger'
              ? 'bg-sky-600 text-white border-sky-600'
              : 'bg-white/90 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
            onClick={() => setOrderType('trigger')}
          >
            تریگر
          </button>
        </div>
        {orderType === 'limit' && (
          <label className="block">
            <span className="dark-mode-text">قیمت (Limit Price)</span>
            <input 
              value={limitPrice} 
              onChange={(e) => setLimitPrice(e.target.value)} 
              placeholder={lastPrice > 0 ? lastPrice.toFixed(2) : ''}
              className="mt-1 w-full px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100" 
            />
          </label>
        )}
        {orderType === 'trigger' && (
          <label className="block">
            <span className="dark-mode-text">تریگر (Trigger Price)</span>
            <input 
              value={triggerPrice} 
              onChange={(e) => setTriggerPrice(e.target.value)} 
              placeholder={lastPrice > 0 ? lastPrice.toFixed(2) : ''}
              className="mt-1 w-full px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100" 
            />
          </label>
        )}
        <label className="block">
          <span className="dark-mode-text">مقدار (Value in USDT)</span>
          <input 
            value={value} 
            onChange={(e) => {
              setValue(e.target.value);
              if (entryPrice > 0 && e.target.value) {
                const calcSize = Number(e.target.value) / entryPrice;
                setSize(calcSize.toFixed(6));
              }
            }} 
            placeholder="Enter USDT value"
            className="mt-1 w-full px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100" 
          />
        </label>
        <label className="block">
          <span className="dark-mode-text">مقدار (Size in contracts)</span>
          <input 
            value={size} 
            onChange={(e) => {
              setSize(e.target.value);
              setValue('');
            }} 
            className="mt-1 w-full px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100" 
          />
        </label>
        <label className="block">
          <span className="dark-mode-text">Leverage</span>
          <select
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            className="mt-1 w-full px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
          >
            {[1, 2, 3, 5, 10, 20, 50, 100].map((x) => (
              <option key={x} value={x}>{x}x</option>
            ))}
          </select>
        </label>
        <div className="text-xs dark-mode-text-secondary space-y-1">
          <div>قیمت: {entryPrice > 0 ? entryPrice.toFixed(2) : lastPrice.toFixed(2)}</div>
          <div>هزینه (Notional): {notional.toFixed(2)} USD</div>
          <div>Required Margin: {margin.toFixed(2)} USD</div>
          {liquidationPrice > 0 && (
            <div className={`mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-700 ${side === 'long' && lastPrice <= liquidationPrice * 1.05 ? 'text-rose-600' : side === 'short' && lastPrice >= liquidationPrice * 0.95 ? 'text-rose-600' : 'text-amber-600'}`}>
              <div className="font-semibold">Liquidation Price: {liquidationPrice.toFixed(2)}</div>
              {lastPrice > 0 && (
                <div className="text-xs mt-1">
                  {side === 'long' 
                    ? `Price drop: ${((entryPrice - liquidationPrice) / entryPrice * 100).toFixed(2)}%`
                    : `Price rise: ${((liquidationPrice - entryPrice) / entryPrice * 100).toFixed(2)}%`
                  }
                </div>
              )}
            </div>
          )}
        </div>
        <button 
          onClick={openPosition} 
          disabled={lastPrice <= 0 || margin > balances.USD || finalSize <= 0 || !Number.isFinite(finalSize) || (orderType === 'limit' && parsedLimit <= 0) || (orderType === 'trigger' && parsedTrigger <= 0)}
          className={`w-full py-2 rounded ${side==='long' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'} text-white disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {lastPrice <= 0 ? 'Waiting for price...' : `سفارش فقط-ثبت (${orderType === 'market' ? 'Market' : orderType === 'limit' ? 'Limit' : 'Trigger'})`}
        </button>
      </div>
    </section>
  );
}

