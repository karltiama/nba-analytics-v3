import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { buildAiSlateUserContent } from '@/lib/betting/ai-slate-context';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

async function fetchOpenAiSlateText(
  apiKey: string,
  model: string,
  userContent: string
): Promise<string> {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      max_tokens: 400,
      messages: [
        {
          role: 'system',
          content:
            'You are a concise NBA analytics assistant. Write 3 to 6 short paragraphs OR bullet-style sentences summarizing the slate context provided. Use only facts from the user message. Do not invent injuries, line movement, or statistics not given. Do not give betting picks, recommendations, or gambling advice; describe matchup and trend context only. If there are no games on the date, say so briefly and still comment on league snapshots and trending players if present. Mention that team stats are season aggregates when relevant.',
        },
        { role: 'user', content: userContent },
      ],
    }),
  });

  const raw = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      raw && typeof raw === 'object' && raw !== null && 'error' in raw
        ? String((raw as { error?: { message?: string } }).error?.message ?? res.statusText)
        : res.statusText;
    throw new Error(msg);
  }

  const text =
    raw &&
    typeof raw === 'object' &&
    raw !== null &&
    'choices' in raw &&
    Array.isArray((raw as { choices?: unknown }).choices)
      ? String(
          (raw as { choices: Array<{ message?: { content?: string } }> }).choices[0]?.message
            ?.content ?? ''
        ).trim()
      : '';

  if (!text) {
    throw new Error('Empty model response');
  }

  return text;
}

/**
 * GET /api/betting/ai-slate-insights?date=YYYY-MM-DD
 * Returns an LLM-written slate summary from analytics + odds context (cached).
 */
export async function GET(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    return NextResponse.json({
      summary: null,
      code: 'NO_OPENAI_KEY' as const,
      message: 'Set OPENAI_API_KEY on the server to enable AI slate summaries.',
    });
  }

  const dateParam = request.nextUrl.searchParams.get('date');
  const dateEt =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const cacheSeconds = Math.max(
    60,
    Math.min(
      86400,
      parseInt(process.env.AI_SLATE_INSIGHTS_CACHE_SECONDS ?? '900', 10) || 900
    )
  );

  try {
    const { userContent, payloadHash } = await buildAiSlateUserContent(dateEt);

    const text = await unstable_cache(
      () => fetchOpenAiSlateText(apiKey, model, userContent),
      ['ai-slate-insights', dateEt, payloadHash, model],
      { revalidate: cacheSeconds }
    )();

    return NextResponse.json({
      summary: text,
      code: null,
      meta: { date: dateEt, model },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json(
      {
        summary: null,
        code: 'OPENAI_ERROR' as const,
        message,
      },
      { status: 502 }
    );
  }
}
