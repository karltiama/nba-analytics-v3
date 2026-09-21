/**
 * Git-backed draft storage under content/preseason/{season}/{slug}.json
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { PreseasonTeamPacket, TeamPreseasonPreviewDraft } from './types';

export function preseasonContentRoot(cwd = process.cwd()): string {
  return path.join(cwd, 'content', 'preseason');
}

export function draftPath(
  season: string,
  slug: string,
  cwd = process.cwd()
): string {
  return path.join(
    preseasonContentRoot(cwd),
    season,
    `${slug.toUpperCase()}.json`
  );
}

export function packetPath(
  season: string,
  slug: string,
  cwd = process.cwd()
): string {
  return path.join(
    preseasonContentRoot(cwd),
    season,
    `${slug.toUpperCase()}.packet.json`
  );
}

export async function writeJsonFile(
  filePath: string,
  data: unknown
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function writePreseasonDraft(
  draft: TeamPreseasonPreviewDraft,
  cwd = process.cwd()
): Promise<string> {
  const dest = draftPath(draft.season, draft.team.slug, cwd);
  await writeJsonFile(dest, draft);
  return dest;
}

export async function writePreseasonPacket(
  packet: PreseasonTeamPacket,
  cwd = process.cwd()
): Promise<string> {
  const dest = packetPath(packet.season, packet.team.slug, cwd);
  await writeJsonFile(dest, packet);
  return dest;
}

export async function readPreseasonDraft(
  season: string,
  slug: string,
  cwd = process.cwd()
): Promise<TeamPreseasonPreviewDraft | null> {
  try {
    const raw = await fs.readFile(draftPath(season, slug, cwd), 'utf8');
    return JSON.parse(raw) as TeamPreseasonPreviewDraft;
  } catch {
    return null;
  }
}

export type DraftIndexRow = {
  slug: string;
  season: string;
  path: string;
  reviewStatus: string | null;
  warningCount: number;
  generatedAt: string | null;
  generated: boolean;
};

export function researchPacketPath(
  season: string,
  slug: string,
  cwd = process.cwd()
): string {
  return path.join(
    preseasonContentRoot(cwd),
    season,
    `${slug.toUpperCase()}.research.json`
  );
}

/** Editable preview scaffold derived from research packet (not curated registry). */
export function previewDraftPath(
  season: string,
  slug: string,
  cwd = process.cwd()
): string {
  return path.join(
    preseasonContentRoot(cwd),
    season,
    `${slug.toUpperCase()}.preview.draft.json`
  );
}

export async function writeResearchPacket(
  packet: import('./research-packet-types').PreseasonResearchPacket,
  cwd = process.cwd()
): Promise<string> {
  const dest = researchPacketPath(packet.season, packet.team.slug, cwd);
  await writeJsonFile(dest, packet);
  return dest;
}

export async function writePreviewDraftContent(
  content: import('../types').TeamPreseasonPreviewContent,
  cwd = process.cwd()
): Promise<string> {
  const dest = previewDraftPath(content.season, content.slug, cwd);
  await writeJsonFile(dest, content);
  return dest;
}

export async function readPreviewDraftContent(
  season: string,
  slug: string,
  cwd = process.cwd()
): Promise<import('../types').TeamPreseasonPreviewContent | null> {
  try {
    const raw = await fs.readFile(previewDraftPath(season, slug, cwd), 'utf8');
    return JSON.parse(raw) as import('../types').TeamPreseasonPreviewContent;
  } catch {
    return null;
  }
}

export async function readResearchPacketFile(
  season: string,
  slug: string,
  cwd = process.cwd()
): Promise<import('./research-packet-types').PreseasonResearchPacket | null> {
  try {
    const raw = await fs.readFile(researchPacketPath(season, slug, cwd), 'utf8');
    return JSON.parse(
      raw
    ) as import('./research-packet-types').PreseasonResearchPacket;
  } catch {
    return null;
  }
}

export async function listPreseasonDrafts(
  season: string,
  cwd = process.cwd()
): Promise<DraftIndexRow[]> {
  const dir = path.join(preseasonContentRoot(cwd), season);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const rows: DraftIndexRow[] = [];
  for (const name of entries) {
    if (
      !name.endsWith('.json') ||
      name.endsWith('.packet.json') ||
      name.endsWith('.research.json') ||
      name.endsWith('.preview.draft.json')
    ) {
      continue;
    }
    const slug = name.replace(/\.json$/, '');
    const draft = await readPreseasonDraft(season, slug, cwd);
    rows.push({
      slug,
      season,
      path: draftPath(season, slug, cwd),
      reviewStatus: draft?.review.status ?? null,
      warningCount: draft?.review.warnings.length ?? 0,
      generatedAt: draft?.generatedAt ?? null,
      generated: draft != null,
    });
  }
  return rows.sort((a, b) => a.slug.localeCompare(b.slug));
}
