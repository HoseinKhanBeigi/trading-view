import { NextRequest, NextResponse } from 'next/server';
import { fetchDepthSnapshot } from '@/lib/binance';
import { fromSnapshot, topN, spreadMid, vwapTop20, identifySupportResistance } from '@/lib/orderbook';
import { predictPriceFromOrderBook, findNearestLevels } from '@/lib/price-prediction';

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
    systemMessage += `\n\nCRITICAL: Use order book data (support/resistance levels, BUY/SELL strength) to predict price direction. Stronger BUY side suggests upward price movement, stronger SELL side suggests downward movement.`;
    
    // Fetch order book data for support/resistance and strength analysis
    let orderBookData = null;
    try {
      if (symbol) {
        const snapshot = await fetchDepthSnapshot(symbol.toUpperCase(), 100);
        const book = fromSnapshot(snapshot);
        const top20 = topN(book, 20);
        const meta = spreadMid(book);
        const vwap = vwapTop20(book);
        const supportResistance = identifySupportResistance(book, {
          minSizePercentile: 70,
          maxLevels: 10,
          lookbackLevels: 100,
        });
        
        // Calculate BUY vs SELL strength from top 20 levels
        const totalBidVolume = top20.bids.reduce((sum, level) => sum + (level.size * level.price), 0);
        const totalAskVolume = top20.asks.reduce((sum, level) => sum + (level.size * level.price), 0);
        const totalVolume = totalBidVolume + totalAskVolume;
        const bidStrength = totalVolume > 0 ? (totalBidVolume / totalVolume) * 100 : 50;
        const askStrength = totalVolume > 0 ? (totalAskVolume / totalVolume) * 100 : 50;
        const dominantSide = bidStrength > askStrength ? 'BUY' : 'SELL';
        const strengthDiff = Math.abs(bidStrength - askStrength);
        
        // Calculate price prediction if we have current price from candles
        let pricePrediction = null;
        if (candles && candles.length > 0) {
          const currentPrice = candles[candles.length - 1]?.close;
          if (currentPrice) {
            pricePrediction = predictPriceFromOrderBook(
              currentPrice,
              book,
              supportResistance.support,
              supportResistance.resistance
            );
            
            // Add distance calculations
            const { nearestSupport, nearestResistance, supportDistance, resistanceDistance } = 
              findNearestLevels(currentPrice, supportResistance.support, supportResistance.resistance);
            
            pricePrediction.factors.nearestSupport = nearestSupport ? {
              price: nearestSupport.price,
              distance: supportDistance,
              strength: nearestSupport.strength,
            } : null;
            pricePrediction.factors.nearestResistance = nearestResistance ? {
              price: nearestResistance.price,
              distance: resistanceDistance,
              strength: nearestResistance.strength,
            } : null;
          }
        }
        
        orderBookData = {
          spread: meta.spread,
          mid: meta.mid,
          vwap: {
            bid: vwap.bid,
            ask: vwap.ask,
          },
          topBids: top20.bids.slice(0, 10).map(l => ({ price: l.price, size: l.size, notional: l.price * l.size })),
          topAsks: top20.asks.slice(0, 10).map(l => ({ price: l.price, size: l.size, notional: l.price * l.size })),
          support: supportResistance.support.slice(0, 5).map(l => ({ price: l.price, notional: l.notional, strength: l.strength })),
          resistance: supportResistance.resistance.slice(0, 5).map(l => ({ price: l.price, notional: l.notional, strength: l.strength })),
          strength: {
            dominantSide,
            bidStrength: bidStrength.toFixed(1),
            askStrength: askStrength.toFixed(1),
            strengthDiff: strengthDiff.toFixed(1),
          },
          prediction: pricePrediction,
        };
      }
    } catch (error) {
      console.error('Error fetching order book:', error);
      // Continue without order book data
    }
    
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
    
    if (orderBookData) {
      contextData += `\n\nORDER BOOK ANALYSIS (Real-time liquidity and support/resistance):\n`;
      contextData += `Current Price Context:\n`;
      contextData += `- Spread: ${orderBookData.spread.toFixed(2)}\n`;
      contextData += `- Mid Price: ${orderBookData.mid.toFixed(2)}\n`;
      contextData += `- VWAP (Top 20): Bid ${orderBookData.vwap.bid.toFixed(2)} / Ask ${orderBookData.vwap.ask.toFixed(2)}\n\n`;
      contextData += `BUY vs SELL Strength:\n`;
      contextData += `- Dominant Side: ${orderBookData.strength.dominantSide} (${orderBookData.strength.strengthDiff}% stronger)\n`;
      contextData += `- BUY Strength: ${orderBookData.strength.bidStrength}% of total volume\n`;
      contextData += `- SELL Strength: ${orderBookData.strength.askStrength}% of total volume\n\n`;
      contextData += `Top Support Levels (Strongest Bids - Price floors):\n`;
      orderBookData.support.forEach((level, i) => {
        contextData += `${i + 1}. ${level.price.toFixed(2)} - ${level.strength} support (${level.notional.toFixed(0)} USD liquidity)\n`;
      });
      contextData += `\nTop Resistance Levels (Strongest Asks - Price ceilings):\n`;
      orderBookData.resistance.forEach((level, i) => {
        contextData += `${i + 1}. ${level.price.toFixed(2)} - ${level.strength} resistance (${level.notional.toFixed(0)} USD liquidity)\n`;
      });
      contextData += `\nTop 10 Bid Levels (Buy orders):\n`;
      orderBookData.topBids.forEach((level, i) => {
        contextData += `${i + 1}. Price: ${level.price.toFixed(2)}, Size: ${level.size.toFixed(4)}, Notional: ${level.notional.toFixed(2)} USD\n`;
      });
      contextData += `\nTop 10 Ask Levels (Sell orders):\n`;
      orderBookData.topAsks.forEach((level, i) => {
        contextData += `${i + 1}. Price: ${level.price.toFixed(2)}, Size: ${level.size.toFixed(4)}, Notional: ${level.notional.toFixed(2)} USD\n`;
      });
      contextData += `\nPRICE PREDICTION ANALYSIS:\n`;
      if (orderBookData.prediction) {
        const pred = orderBookData.prediction;
        contextData += `\nPREDICTED DIRECTION: ${pred.direction} (${pred.confidence}% confidence)\n`;
        contextData += `Reasoning:\n`;
        pred.reasoning.forEach((reason, i) => {
          contextData += `${i + 1}. ${reason}\n`;
        });
        if (pred.targetPrice) {
          contextData += `\nTarget Price: ${pred.targetPrice.toFixed(2)}\n`;
        }
        if (pred.stopLoss) {
          contextData += `Stop Loss: ${pred.stopLoss.toFixed(2)}\n`;
        }
        contextData += `\nKey Factors:\n`;
        contextData += `- Order Book Imbalance: ${pred.factors.orderBookImbalance > 0 ? '+' : ''}${pred.factors.orderBookImbalance.toFixed(1)}% (positive = BUY stronger, negative = SELL stronger)\n`;
        contextData += `- Imbalance Trend: ${pred.factors.imbalanceTrend}\n`;
        if (pred.factors.nearestSupport) {
          contextData += `- Nearest Support: ${pred.factors.nearestSupport.price.toFixed(2)} (${pred.factors.nearestSupport.distance.toFixed(2)}% away, ${pred.factors.nearestSupport.strength} strength)\n`;
        }
        if (pred.factors.nearestResistance) {
          contextData += `- Nearest Resistance: ${pred.factors.nearestResistance.price.toFixed(2)} (${pred.factors.nearestResistance.distance.toFixed(2)}% away, ${pred.factors.nearestResistance.strength} strength)\n`;
        }
      } else {
        contextData += `- If BUY side is stronger (${orderBookData.strength.bidStrength}% > ${orderBookData.strength.askStrength}%), expect upward price movement toward resistance levels\n`;
        contextData += `- If SELL side is stronger (${orderBookData.strength.askStrength}% > ${orderBookData.strength.bidStrength}%), expect downward price movement toward support levels\n`;
        contextData += `- Support levels act as price floors - price may bounce up from these levels\n`;
        contextData += `- Resistance levels act as price ceilings - price may bounce down from these levels\n`;
        contextData += `- Stronger support/resistance (with more liquidity) are more likely to hold\n`;
      }
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

