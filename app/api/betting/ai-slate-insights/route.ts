import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { buildAiSlateUserContent } from '@/lib/betting/ai-slate-context';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

type OpenAiChoice = {
  message?: { content?: string };
  finish_reason?: string;
};

type OpenAiResponse = {
  choices?: OpenAiChoice[];
  error?: { message?: string };
};

function hasCompleteSentenceEnding(text: string): boolean {
  return /[.!?]["')\]]?\s*$/.test(text);
}

function isLikelyTruncated(text: string, finishReason: string | null): boolean {
  if (!text) return true;
  if (finishReason === 'length') return true;
  if (!hasCompleteSentenceEnding(text)) return true;
  return /[(\[,:;\-]\s*$/.test(text);
}

async function callOpenAiOnce(
  apiKey: string,
  model: string,
  userContent: string,
  maxTokens: number
): Promise<{ text: string; finishReason: string | null }> {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'system',
          content:
            'You are a concise NBA slate context assistant for prop research. Write 2 to 4 short paragraphs and keep it under 170 words total. Use only facts from the user message. Prioritize: (1) likely player uptick opportunities based on the provided trending section, and (2) late-season rest/rotation uncertainty framing when context suggests regular-season wind-down. De-prioritize generic recitation of pace/offensive/defensive rating unless directly needed for one matchup point. Do not invent injuries, line movement, or stats not provided. Do not give betting picks or gambling advice; provide context only. End with one short caveat sentence about monitoring confirmed lineups/active status near tip. Ensure the response ends with a complete sentence and never ends mid-word or mid-parenthesis.',
        },
        { role: 'user', content: userContent },
      ],
    }),
  });

  const raw = (await res.json().catch(() => null)) as OpenAiResponse | null;
  if (!res.ok) {
    const msg =
      raw && typeof raw === 'object' && raw.error
        ? String(raw.error.message ?? res.statusText)
        : res.statusText;
    throw new Error(msg);
  }

  const choice = raw?.choices?.[0];
  const text = String(choice?.message?.content ?? '').trim();
  const finishReason = choice?.finish_reason ?? null;

  if (!text) {
    throw new Error('Empty model response');
  }

  return { text, finishReason };
}

async function fetchOpenAiSlateText(
  apiKey: string,
  model: string,
  userContent: string
): Promise<string> {
  const first = await callOpenAiOnce(apiKey, model, userContent, 320);
  if (!isLikelyTruncated(first.text, first.finishReason)) {
    return first.text;
  }

  const retryPrompt = `${userContent}\n\nReturn a complete response. Do not stop mid-sentence.`;
  const second = await callOpenAiOnce(apiKey, model, retryPrompt, 320);
  return second.text;
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
  const promptVersion = 'v3-finish-reason-retry';
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
      ['ai-slate-insights', promptVersion, dateEt, payloadHash, model],
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
