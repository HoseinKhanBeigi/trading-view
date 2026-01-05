import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { messages, positions } = await req.json();

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY not configured' },
        { status: 500 }
      );
    }

    // Prepare system message with position context
    const systemMessage = positions && positions.length > 0
      ? `You are a professional trading assistant. Analyze the following open positions and provide recommendations on which position is better for entry or management.

Current positions:
${JSON.stringify(positions, null, 2)}

Provide clear, concise analysis focusing on:
1. Which position has better entry conditions
2. Risk/reward ratios
3. Market conditions affecting each position
4. Suggested actions (enter new, manage existing, or exit)

Be professional and data-driven in your analysis.`
      : `You are a professional trading assistant. Help users with trading questions and position analysis.`;

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
        max_tokens: 1000,
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

