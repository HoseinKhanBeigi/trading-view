"use client";
import { useMarketStore } from "@/store";

export function ErrorBanner() {
  const error = useMarketStore((s) => s.error);
  if (!error) return null;
  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20">
      <div className="flex items-center gap-2 rounded-md bg-red-600 text-white shadow px-3 py-1.5 text-xs" role="status" aria-live="polite">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
        <span>{error}</span>
      </div>
    </div>
  );
}


