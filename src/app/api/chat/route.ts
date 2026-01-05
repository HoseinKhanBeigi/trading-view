import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { messages, positions, candles, trades, interval, symbol } = await req.json();

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY not configured' },
        { status: 500 }
      );
    }

    // Prepare system message with position, candle, and trade data context
    let systemMessage = `You are a professional trading assistant specializing in technical analysis. `;
    
    if (candles && candles.length > 0) {
      systemMessage += `Analyze the last ${candles.length} candlestick candles (${interval || '5m'} timeframe) for ${symbol || 'the trading pair'} and perform technical analysis. `;
    }
    
    if (trades && trades.length > 0) {
      systemMessage += `Also analyze recent trade data to assess market momentum, buying/selling pressure, and volume patterns. `;
    }
    
    if (positions && positions.length > 0) {
      systemMessage += `IMPORTANT: All positions shown are MOCK/SIMULATED positions for testing purposes only. `;
      systemMessage += `Based on the technical analysis of the candles, trade momentum, and the current mock positions, provide entry position recommendations. `;
    } else {
      systemMessage += `Based on the technical analysis of the candles and trade momentum, provide entry position recommendations. `;
    }
    
    systemMessage += `\n\nProvide clear, concise analysis focusing on:\n`;
    systemMessage += `1. Technical indicators and patterns (support/resistance, trend, momentum, etc.)\n`;
    if (trades && trades.length > 0) {
      systemMessage += `2. Market momentum analysis from recent trades (buying vs selling pressure, volume patterns, price action)\n`;
    }
    systemMessage += `${trades && trades.length > 0 ? '3' : '2'}. Entry recommendations (LONG or SHORT) with reasoning\n`;
    systemMessage += `${trades && trades.length > 0 ? '4' : '3'}. Suggested entry price levels\n`;
    systemMessage += `${trades && trades.length > 0 ? '5' : '4'}. Risk/reward assessment\n`;
    
    if (positions && positions.length > 0) {
      systemMessage += `${trades && trades.length > 0 ? '6' : '5'}. Comparison with existing mock positions\n`;
      systemMessage += `${trades && trades.length > 0 ? '7' : '6'}. Suggested actions for existing positions (hold, exit, or adjust)\n`;
    }
    
    systemMessage += `\nBe professional, data-driven, and focus on technical analysis fundamentals. Use trade data to validate momentum and confirm price movements.`;
    
    // Build the context data for the system message
    let contextData = '';
    
    if (candles && candles.length > 0) {
      contextData += `\n\nCANDLE DATA (Last ${candles.length} candles, ${interval || '5m'} timeframe):\n`;
      contextData += `Format: [time, open, high, low, close]\n`;
      // Send candles in a compact format
      const candlesFormatted = candles.map((c: { time: number | string; open: number; high: number; low: number; close: number }) => [
        c.time,
        c.open.toFixed(2),
        c.high.toFixed(2),
        c.low.toFixed(2),
        c.close.toFixed(2)
      ]);
      contextData += JSON.stringify(candlesFormatted, null, 2);
    }
    
    if (trades && trades.length > 0) {
      contextData += `\n\nRECENT TRADES DATA (Last ${trades.length} trades for momentum analysis):\n`;
      contextData += `Format: [price, quantity, isBuyerMaker (true=buyer was maker/seller was aggressive, false=seller was maker/buyer was aggressive), time]\n`;
      contextData += `Note: isBuyerMaker=true indicates selling pressure (aggressive sellers), isBuyerMaker=false indicates buying pressure (aggressive buyers)\n`;
      const tradesFormatted = trades.map((t: { price: number; qty: number; isBuyerMaker: boolean; time: number }) => [
        t.price.toFixed(2),
        t.qty.toFixed(4),
        t.isBuyerMaker,
        t.time
      ]);
      contextData += JSON.stringify(tradesFormatted, null, 2);
    }
    
    if (positions && positions.length > 0) {
      contextData += `\n\nMOCK POSITIONS (Simulated for testing):\n`;
      contextData += JSON.stringify(positions, null, 2);
    }
    
    systemMessage += contextData;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemMessage },
          ...messages,
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI API error:', error);
      return NextResponse.json(
        { error: 'Failed to get response from OpenAI' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({ 
      message: data.choices[0]?.message?.content || 'No response from AI' 
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

