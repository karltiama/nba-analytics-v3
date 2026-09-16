/**
 * Estimated USD from provider token usage. Labeled estimated.
 * Do not invent cost from file size. Unknown models → null.
 */
const GPT_4O_MINI_INPUT_PER_MILLION = 0.15;
const GPT_4O_MINI_OUTPUT_PER_MILLION = 0.6;

export function estimateCostUsd(input: {
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
}): number | null {
  if (input.model !== 'gpt-4o-mini') return null;
  if (input.promptTokens == null || input.completionTokens == null) return null;
  if (!Number.isFinite(input.promptTokens) || !Number.isFinite(input.completionTokens)) return null;
  const usd =
    (input.promptTokens / 1_000_000) * GPT_4O_MINI_INPUT_PER_MILLION +
    (input.completionTokens / 1_000_000) * GPT_4O_MINI_OUTPUT_PER_MILLION;
  return Number(usd.toFixed(6));
}
