import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { z } from 'zod';

const bodySchema = z.object({
  homeTeamName: z.string().min(1),
  awayTeamName: z.string().min(1),
  bullets: z.array(z.string()).min(1).max(8),
  injuryIntro: z.string().optional(),
  injuryParagraphs: z.array(z.string()).max(12).optional(),
  injuryReportLines: z.array(z.string()).max(40).optional(),
  usageShiftLines: z.array(z.string()).max(24).optional(),
  expectedStarterLines: z.array(z.string()).max(4).optional(),
  oddsHint: z.string().max(500).nullable().optional(),
});

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

function buildUserContent(input: z.infer<typeof bodySchema>): string {
  const parts: string[] = [
    `Matchup: ${input.awayTeamName} @ ${input.homeTeamName}`,
    'Summary signals (bullets from the app):',
    ...input.bullets.map((b, i) => `${i + 1}. ${b}`),
  ];
  if (input.oddsHint) {
    parts.push(`Odds snapshot: ${input.oddsHint}`);
  }
  if (input.injuryReportLines?.length) {
    parts.push('Injury report (names and statuses from the app feed):');
    for (const line of input.injuryReportLines) {
      parts.push(`- ${line}`);
    }
  }
  if (input.expectedStarterLines?.length) {
    parts.push('Typical starting lineups (recent games; not a guarantee for this game):');
    for (const line of input.expectedStarterLines) {
      parts.push(`- ${line}`);
    }
  }
  if (input.usageShiftLines?.length) {
    parts.push(
      'When listed players had no minutes in past games, teammate minutes/scoring splits (descriptive only; small samples can mislead):'
    );
    for (const line of input.usageShiftLines) {
      parts.push(`- ${line}`);
    }
  }
  if (input.injuryIntro) {
    parts.push('Additional injury / game context (from box-score splits):');
    parts.push(input.injuryIntro);
    if (input.injuryParagraphs?.length) {
      for (const p of input.injuryParagraphs) {
        parts.push(p);
      }
    }
  }
  return parts.join('\n');
}

function hashPayload(data: z.infer<typeof bodySchema>): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

async function fetchOpenAiSummaryText(
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
      max_tokens: 320,
      messages: [
        {
          role: 'system',
          content:
            'You are a concise NBA analytics assistant. Write 3 to 5 sentences summarizing the matchup context provided. When an injury report is included, briefly name the most relevant players and their listed status. When usage-shift or minutes-split lines are included, mention which teammates tended to see higher minutes (or scoring load) in past games when the injured player did not play—only for names given in the data. When expected starter lines are included, you may reference them as the usual starting group, not a guarantee for tonight. Use only facts from the user message. Do not invent statistics, injuries, or line movement. Do not give betting picks or recommendations; describe context only. If samples are described as small or uncertain, say so briefly.',
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
 * POST /api/betting/games/[gameId]/ai-projection-summary
 * Body: structured matchup context already shown on the game page; returns a short LLM summary.
 * Identical gameId + body reuses a cached OpenAI result (see AI_PROJECTION_SUMMARY_CACHE_SECONDS).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    return NextResponse.json(
      { error: 'OpenAI is not configured', code: 'NO_OPENAI_KEY' as const },
      { status: 503 }
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { gameId } = await params;
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const userContent = `Game id: ${gameId}\n\n${buildUserContent(parsed.data)}`;
  const payloadHash = hashPayload(parsed.data);
  const cacheSeconds = Math.max(
    60,
    Math.min(
      86400,
      parseInt(process.env.AI_PROJECTION_SUMMARY_CACHE_SECONDS ?? '900', 10) || 900
    )
  );

  try {
    const text = await unstable_cache(
      () => fetchOpenAiSummaryText(apiKey, model, userContent),
      ['ai-projection-summary', gameId, payloadHash, model],
      { revalidate: cacheSeconds }
    )();

    return NextResponse.json({ summary: text });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json(
      { error: `OpenAI request failed: ${message}`, code: 'OPENAI_ERROR' as const },
      { status: 502 }
    );
  }
}
