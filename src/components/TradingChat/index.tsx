"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useMarketStore } from "@/store";

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export default function TradingChat() {
  const positions = useMarketStore((s) => s.positions);
  const candles = useMarketStore((s) => s.candles);
  const trades = useMarketStore((s) => s.trades);
  const interval = useMarketStore((s) => s.interval);
  const symbol = useMarketStore((s) => s.symbol);
  const lastPrice = candles[candles.length - 1]?.close ?? 0;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const analyzePositions = useCallback(async () => {
    if (positions.length === 0) return;
    
    setIsLoading(true);
    const userMessage: Message = {
      role: 'user',
      content: 'Based on the last 100 candles and my current mock positions, perform technical analysis and give me entry position recommendations.',
      timestamp: Date.now(),
    };
    
    setMessages(prev => [...prev, userMessage]);

    try {
      // Prepare position data with current market context
      const positionsWithContext = positions.map(pos => ({
        symbol: pos.symbol,
        side: pos.side,
        size: pos.size,
        entryPrice: pos.entryPrice,
        leverage: pos.leverage,
        margin: pos.margin,
        currentPrice: lastPrice,
        pnl: pos.side === 'long' 
          ? (lastPrice - pos.entryPrice) * pos.size * pos.leverage
          : (pos.entryPrice - lastPrice) * pos.size * pos.leverage,
        pnlPct: pos.side === 'long'
          ? ((lastPrice - pos.entryPrice) / pos.entryPrice) * 100 * pos.leverage
          : ((pos.entryPrice - lastPrice) / pos.entryPrice) * 100 * pos.leverage,
      }));

      // Get last 100 candles (or all if less than 100)
      const last100Candles = candles.slice(-100).map(c => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      // Get last 100 trades for momentum analysis
      const last100Trades = trades.slice(0, 100).map(t => ({
        price: t.price,
        qty: t.qty,
        isBuyerMaker: t.isBuyerMaker,
        time: t.time,
      }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: userMessage.content }],
          positions: positionsWithContext,
          candles: last100Candles,
          trades: last100Trades,
          interval: interval,
          symbol: symbol,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get analysis');
      }

      const data = await response.json();
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.message,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error analyzing positions:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please make sure OPENAI_API_KEY is set in your environment variables.',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [positions, lastPrice, candles, trades, interval, symbol]);

  // Auto-analyze when positions change
  useEffect(() => {
    if (positions.length > 0 && messages.length === 0) {
      // Only auto-analyze if chat is empty (first time opening with positions)
      analyzePositions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions.length]); // Only trigger on position count change

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };
    
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      // Include position context if available
      const positionsWithContext = positions.length > 0
        ? positions.map(pos => ({
            symbol: pos.symbol,
            side: pos.side,
            size: pos.size,
            entryPrice: pos.entryPrice,
            leverage: pos.leverage,
            margin: pos.margin,
            currentPrice: lastPrice,
          }))
        : undefined;

      // Get last 100 candles for context
      const last100Candles = candles.slice(-100).map(c => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      // Get last 100 trades for momentum analysis
      const last100Trades = trades.slice(0, 100).map(t => ({
        price: t.price,
        qty: t.qty,
        isBuyerMaker: t.isBuyerMaker,
        time: t.time,
      }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages.map(m => ({ role: m.role, content: m.content })).concat([
            { role: 'user', content: input }
          ]),
          positions: positionsWithContext,
          candles: last100Candles,
          trades: last100Trades,
          interval: interval,
          symbol: symbol,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.message,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 dark-mode-bg overflow-hidden flex flex-col h-[600px]">
      <header className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 dark-mode-bg flex items-center justify-between">
        <h3 className="text-sm font-semibold dark-mode-text">Trading Assistant</h3>
        {positions.length > 0 && (
          <button
            onClick={analyzePositions}
            disabled={isLoading}
            className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed dark-mode-text"
          >
            {isLoading ? 'Analyzing...' : 'Analyze Positions'}
          </button>
        )}
      </header>
      
      <div 
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {messages.length === 0 && (
          <div className="text-center text-zinc-500 dark:text-zinc-400 text-sm py-8">
            <p className="mb-2">Ask me about your positions or trading strategy.</p>
            {positions.length > 0 && (
              <p className="text-xs">I can analyze your {positions.length} open position{positions.length > 1 ? 's' : ''}.</p>
            )}
          </div>
        )}
        
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-100 dark:bg-zinc-800 dark-mode-text border border-zinc-200 dark:border-zinc-700'
              }`}
            >
              <div className="whitespace-pre-wrap wrap-break-word">{msg.content}</div>
            </div>
          </div>
        ))}
        
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-zinc-100 dark:bg-zinc-800 dark-mode-text border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>
      
      <form onSubmit={handleSend} className="border-t border-zinc-100 dark:border-zinc-800 p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your positions..."
            className="flex-1 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 dark-mode-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}

