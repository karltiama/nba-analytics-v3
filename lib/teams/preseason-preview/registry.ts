import type { TeamPreseasonPreviewContent } from './types';
import { detroitPreseasonPreview } from './content/detroit';
import { bostonPreseasonPreview } from './content/boston';

import { charlottePreseasonPreview } from './content/charlotte';
/** All curated previews — add a module + entry here for each team. */
const PREVIEWS: TeamPreseasonPreviewContent[] = [
  detroitPreseasonPreview,
  bostonPreseasonPreview,
  charlottePreseasonPreview,
];

const bySlug = new Map(
  PREVIEWS.map((p) => [p.slug.toUpperCase(), p] as const)
);

export function listPreseasonPreviewSlugs(): string[] {
  return PREVIEWS.map((p) => p.slug.toUpperCase());
}

export function getPreseasonPreviewContentBySlug(
  slug: string
): TeamPreseasonPreviewContent | null {
  return bySlug.get(slug.trim().toUpperCase()) ?? null;
}

/** Match curated content after resolving analytics team (abbr or explicit teamId). */
export function getPreseasonPreviewContentForTeam(args: {
  abbreviation: string;
  teamId: string;
}): TeamPreseasonPreviewContent | null {
  const byAbbr = getPreseasonPreviewContentBySlug(args.abbreviation);
  if (byAbbr) return byAbbr;
  return (
    PREVIEWS.find((p) => p.teamId != null && p.teamId === args.teamId) ?? null
  );
}
