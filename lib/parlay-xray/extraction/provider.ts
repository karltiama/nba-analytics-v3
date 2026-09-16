import { xrayVisionOutputSchema, type XrayVisionOutput } from './schema';
import { XRAY_EXTRACTION_SYSTEM_PROMPT, XRAY_EXTRACTION_USER_PROMPT } from './prompt';
import type { XrayVisionDetail } from './config';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export type XrayProviderSuccess = {
  output: XrayVisionOutput;
  requestId: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

export type XrayProviderFailure = {
  category: 'timeout' | 'rate_limited' | 'provider_5xx' | 'malformed_output' | 'network';
};

export class XrayProviderError extends Error {
  readonly category: XrayProviderFailure['category'];
  constructor(category: XrayProviderFailure['category'], message: string) {
    super(message);
    this.category = category;
  }
}

export type XrayVisionProvider = (input: {
  apiKey: string;
  model: string;
  detail: XrayVisionDetail;
  dataUrl: string;
  maxOutputTokens: number;
}) => Promise<XrayProviderSuccess>;

function extractJsonObject(text: string): unknown {
  const t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t);
  const body = fence ? fence[1]?.trim() ?? t : t;
  return JSON.parse(body);
}

function tokensOf(raw: unknown): { prompt: number | null; completion: number | null; total: number | null } {
  if (!raw || typeof raw !== 'object' || !('usage' in raw)) {
    return { prompt: null, completion: null, total: null };
  }
  const usage = (raw as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage;
  return {
    prompt: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : null,
    completion: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : null,
    total: typeof usage?.total_tokens === 'number' ? usage.total_tokens : null,
  };
}

/**
 * One provider attempt. No automatic retries.
 * Uses the same Chat Completions + json_object pattern as other AI routes.
 * Does not share or wrap the leftover bet-slip parser.
 */
export const fetchXrayVisionFromOpenAi: XrayVisionProvider = async (input) => {
  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model,
        temperature: 0,
        max_tokens: input.maxOutputTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: XRAY_EXTRACTION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: XRAY_EXTRACTION_USER_PROMPT },
              { type: 'image_url', image_url: { url: input.dataUrl, detail: input.detail } },
            ],
          },
        ],
      }),
    });
  } catch {
    throw new XrayProviderError('network', 'provider_network');
  }

  const requestId = res.headers.get('x-request-id');
  const raw = await res.json().catch(() => null);

  if (res.status === 429) {
    throw new XrayProviderError('rate_limited', 'provider_429');
  }
  if (res.status >= 500) {
    throw new XrayProviderError('provider_5xx', 'provider_5xx');
  }
  if (!res.ok) {
    throw new XrayProviderError('provider_5xx', 'provider_error');
  }

  const text =
    raw && typeof raw === 'object' && 'choices' in raw && Array.isArray((raw as { choices?: unknown }).choices)
      ? String((raw as { choices: Array<{ message?: { content?: string } }> }).choices[0]?.message?.content ?? '').trim()
      : '';

  if (!text) {
    throw new XrayProviderError('malformed_output', 'empty_response');
  }

  let parsed: unknown;
  try {
    parsed = extractJsonObject(text);
  } catch {
    throw new XrayProviderError('malformed_output', 'invalid_json');
  }

  const safe = xrayVisionOutputSchema.safeParse(parsed);
  if (!safe.success) {
    throw new XrayProviderError('malformed_output', 'schema_mismatch');
  }

  const usage = tokensOf(raw);
  return {
    output: safe.data,
    requestId,
    promptTokens: usage.prompt,
    completionTokens: usage.completion,
    totalTokens: usage.total,
  };
};
