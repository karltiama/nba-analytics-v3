/**
 * End-to-end pipeline helpers for CLI.
 */

import { assemblePreseasonDraft } from './assemble';
import { rankPlayerWatchCandidates } from './candidates';
import {
  createOpenAiEditorialGenerator,
  generateEditorialDry,
  type GenerateTeamPreseasonPreview,
} from './generate';
import { deriveRoleWatch } from './role-watch';
import { derivePreseasonContextSignals } from './signals';
import {
  writePreseasonDraft,
  writePreseasonPacket,
} from './storage';
import { validatePreseasonPreviewDraft } from './validate';
import { buildPreseasonTeamPacket } from './build-team-packet';
import type { PreseasonTeamPacket, TeamPreseasonPreviewDraft } from './types';

export async function runPreseasonPacket(args: {
  team: string;
  season: string;
  write?: boolean;
}): Promise<{ packet: PreseasonTeamPacket; path: string | null }> {
  const packet = await buildPreseasonTeamPacket(args.team, args.season);
  let dest: string | null = null;
  if (args.write !== false) {
    dest = await writePreseasonPacket(packet);
  }
  return { packet, path: dest };
}

export async function runPreseasonGenerate(args: {
  team: string;
  season: string;
  dryRun?: boolean;
  write?: boolean;
  /** Fail loud on OpenAI errors (default true when not dry-run). */
  strictEditorial?: boolean;
}): Promise<{
  packet: PreseasonTeamPacket;
  draft: TeamPreseasonPreviewDraft;
  validationErrors: string[];
  path: string | null;
}> {
  const packet = await buildPreseasonTeamPacket(args.team, args.season);
  await writePreseasonPacket(packet);

  const signals = derivePreseasonContextSignals(packet);
  const candidates = rankPlayerWatchCandidates(packet, signals);
  const roleWatch = deriveRoleWatch(signals);

  const strict =
    args.strictEditorial ?? (args.dryRun ? false : true);

  const generator: GenerateTeamPreseasonPreview = args.dryRun
    ? generateEditorialDry
    : createOpenAiEditorialGenerator({ strict });

  const editorial = await generator({
    packet,
    signals,
    candidates,
    roleWatch,
  });

  let draft = assemblePreseasonDraft({ packet, editorial });
  const validated = validatePreseasonPreviewDraft(draft, packet);
  draft = validated.draft;

  let dest: string | null = null;
  if (args.write !== false && validated.ok) {
    dest = await writePreseasonDraft(draft);
  } else if (args.write !== false && !validated.ok) {
    draft = {
      ...draft,
      review: {
        ...draft.review,
        status: 'NEEDS_REVIEW',
        warnings: [
          ...draft.review.warnings,
          ...validated.errors.map((e) => `VALIDATION: ${e}`),
        ],
      },
    };
    dest = await writePreseasonDraft(draft);
  }

  return {
    packet,
    draft,
    validationErrors: validated.ok ? [] : validated.errors,
    path: dest,
  };
}
