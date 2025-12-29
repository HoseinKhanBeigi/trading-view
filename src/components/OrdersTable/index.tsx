"use client";

import { useMarketStore } from "@/store";
import type { Position } from "@/store/slices/positions";

export default function OrdersTable() {
  const positions = useMarketStore((s) => s.positions);

  const formatTime = (time: number) => {
    const d = new Date(time);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  };

  const getOrderTypeLabel = (type: string) => {
    if (type === 'market') return 'قیمت بازار';
    if (type === 'limit') return 'لیمیت';
    if (type === 'trigger') return 'تریگر';
    return type;
  };

  const getSideLabel = (side: string) => {
    if (side === 'long') return 'باز کردن لانگ';
    if (side === 'short') return 'باز کردن شورت';
    return side;
  };

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 dark-mode-bg overflow-hidden">
      <header className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 dark-mode-bg">
        <h3 className="text-sm font-semibold dark-mode-text">سفارشات (Orders)</h3>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-2 py-2 text-left dark-mode-text">جفت‌های ارزی</th>
              <th className="px-2 py-2 text-left dark-mode-text">زمان</th>
              <th className="px-2 py-2 text-left dark-mode-text">نوع سفارش</th>
              <th className="px-2 py-2 text-left dark-mode-text">جهت</th>
              <th className="px-2 py-2 text-right dark-mode-text">قیمت میانگین</th>
              <th className="px-2 py-2 text-right dark-mode-text">پر شده | مقدار</th>
              <th className="px-2 py-2 text-right dark-mode-text">قیمت تریگر</th>
              <th className="px-2 py-2 text-right dark-mode-text">قیمت سفارش</th>
              <th className="px-2 py-2 text-right dark-mode-text">مارجین مسدود شده</th>
              <th className="px-2 py-2 text-right dark-mode-text">کارمزد</th>
              <th className="px-2 py-2 text-center dark-mode-text">وضعیت</th>
              <th className="px-2 py-2 text-right dark-mode-text">شماره سفارش</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {positions.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-4 text-center text-zinc-500 dark:text-zinc-400">
                  هیچ سفارشی وجود ندارد
                </td>
              </tr>
            )}
            {positions.map((p) => (
              <tr key={p.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <td className="px-2 py-2 font-mono tabular-nums dark-mode-text">{p.symbol}</td>
                <td className="px-2 py-2 dark-mode-text text-xs">{formatTime(p.time)}</td>
                <td className="px-2 py-2 dark-mode-text">{getOrderTypeLabel(p.orderType)}</td>
                <td className="px-2 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-xs ${p.side==='long'?'bg-emerald-600 text-white':'bg-rose-600 text-white'}`}>
                    {getSideLabel(p.side)}
                  </span>
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums dark-mode-text">
                  {p.status === 'filled' ? p.entryPrice.toFixed(2) : '--'}
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums dark-mode-text">
                  {p.filled?.toFixed(4) || '0.0000'} | {p.size.toFixed(4)}
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums dark-mode-text">
                  {p.triggerPrice?.toFixed(2) || '--'}
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums dark-mode-text">
                  {p.orderPrice?.toFixed(2) || '--'}
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums dark-mode-text">
                  {p.margin.toFixed(2)} USDT
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums dark-mode-text">
                  {p.fee?.toFixed(4) || '0.0000'} USDT
                </td>
                <td className="px-2 py-2 text-center">
                  <span className={`px-1.5 py-0.5 rounded text-xs ${
                    p.status === 'filled' ? 'bg-emerald-600 text-white' :
                    p.status === 'pending' ? 'bg-amber-600 text-white' :
                    'bg-zinc-600 text-white'
                  }`}>
                    {p.status === 'filled' ? 'پرنشده' : p.status === 'pending' ? 'در انتظار' : p.status}
                  </span>
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-zinc-500 dark:text-zinc-400 text-xs">
                  {p.id.slice(-8)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

