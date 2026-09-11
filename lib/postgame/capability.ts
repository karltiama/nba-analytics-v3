/**
 * Known orchestration stages vs executable workers (13F.3).
 * Scanner must not enqueue NOT_IMPLEMENTED stages even if GOAT is active.
 */

import type { PostgameStage } from './types';

export const POSTGAME_IMPLEMENTED_STAGES = ['box', 'starters'] as const;
export type PostgameImplementedStage = (typeof POSTGAME_IMPLEMENTED_STAGES)[number];

export function isImplementedPostgameStage(stage: PostgameStage): stage is PostgameImplementedStage {
  return (POSTGAME_IMPLEMENTED_STAGES as readonly string[]).includes(stage);
}
