import { shouldSkipLiveMutations } from '@/lib/runtime/ingestion-mode';

export function isAiSlateBriefingEligible(input: {
  frozen: boolean;
  gameCount: number;
}): boolean {
  return !input.frozen && input.gameCount > 0;
}

export function isAiGameBriefingEligible(input: { frozen: boolean }): boolean {
  return !input.frozen;
}

export function aiBriefingUnavailableCopy(frozen: boolean): string {
  return frozen
    ? 'Slate briefing unavailable during offseason freeze. Live analysis is paused until current-game inputs resume.'
    : 'No current slate to summarize for this date.';
}

export function isIngestionFrozen(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): boolean {
  return shouldSkipLiveMutations(env);
}
