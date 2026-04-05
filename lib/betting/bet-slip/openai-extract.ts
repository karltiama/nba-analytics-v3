import { betSlipExtractionSchema, type BetSlipExtraction } from '@/lib/betting/bet-slip/schema';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * System + user instructions for bet slip JSON extraction.
 * Keep in sync with BetSlipExtraction Zod schema.
 */
export const BET_SLIP_EXTRACTION_SYSTEM = `You extract structured data from NBA betting screenshots (sportsbook or social).
Return ONLY a single JSON object. No markdown, no code fences.

Schema (all keys required; use null where unknown):
- bet_type: "single" | "parlay"
- sportsbook: string | null
- total_odds_american: number | null  (American odds for the whole slip if shown, e.g. +800 or -150)
- total_odds_decimal: number | null     (decimal odds for whole slip if shown, e.g. 9.0)
- legs: array of {
    player_name: string,
    prop_type: string (e.g. points, rebounds, threes, PRA — use short labels),
    side: "over" | "under",
    line: number,
    odds_american: number | null
  }
- image_quality: "good" | "medium" | "poor" | null
- needs_review: boolean

Rules:
- Parlay-first: every pick is one leg; single bet has one leg.
- Do not invent player names, lines, or odds. If unreadable, omit with null or empty legs and needs_review true.
- If per-leg odds are not visible, set odds_american to null for that leg.
- If total slip odds are visible but leg odds are missing, fill total_odds_* and null leg odds.
- Use needs_review true when uncertain, blurry, or partially visible.
- side must be over or under for player props only (this tool does not support moneyline-only slips without a clear O/U stat line).`;

function extractJsonObject(text: string): unknown {
  const t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t);
  const body = fence ? fence[1]?.trim() ?? t : t;
  return JSON.parse(body);
}

export async function fetchBetSlipExtractionFromOpenAi(
  apiKey: string,
  model: string,
  imageDataUrl: string
): Promise<BetSlipExtraction> {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: BET_SLIP_EXTRACTION_SYSTEM },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract the bet slip JSON from this image per the schema.',
            },
            {
              type: 'image_url',
              image_url: { url: imageDataUrl, detail: 'high' },
            },
          ],
        },
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
          (raw as { choices: Array<{ message?: { content?: string } }> }).choices[0]?.message?.content ??
            ''
        ).trim()
      : '';

  if (!text) {
    throw new Error('Empty model response');
  }

  let parsed: unknown;
  try {
    parsed = extractJsonObject(text);
  } catch {
    throw new Error('Model did not return valid JSON');
  }

  const safe = betSlipExtractionSchema.safeParse(parsed);
  if (!safe.success) {
    throw new Error(`Extraction JSON failed validation: ${safe.error.message}`);
  }

  return safe.data;
}
