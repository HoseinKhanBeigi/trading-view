'use client';

import { clsx } from 'clsx';
import { useMarketStore } from '@/store';
import { useRouter } from 'next/navigation';

interface SymbolsListProps {
  className?: string;
}

export function SymbolsList({ className = '' }: SymbolsListProps) {
  const { symbol, setSymbol } = useMarketStore();
  const router = useRouter();
  function handleSymbolClick(s: string) {
    setSymbol(s);
    router.push(`/${s.toLowerCase()}`)
  }

  return (
    <div className={`dark-mode-bg-secondary rounded-lg ${className}`}>
      <div className="p-3 border-b dark-mode-border flex items-center justify-between">
        <h2 className="text-sm font-semibold dark-mode-text">Markets</h2>
      </div>
      <div className="divide-y dark-mode-border">
        {['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','TONUSDT','TRXUSDT','DOTUSDT'].map((s) => {
          const isActive = symbol.toUpperCase() === s.toUpperCase();
          return (
            <button
              key={s}
              onClick={() => handleSymbolClick(s)}
              className={clsx(
                'w-full px-3 py-2 text-left flex items-center justify-between transition-colors',
                'hover:bg-zinc-100 dark:hover:bg-zinc-800/50',
                isActive && 'bg-zinc-100 dark:bg-zinc-800'
              )}
            >
              <div className="flex flex-col">
                <span className={clsx('text-sm font-medium', isActive ? 'text-zinc-900 dark:text-white' : 'dark-mode-text')}>{s}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}


