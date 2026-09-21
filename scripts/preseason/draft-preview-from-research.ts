/**
 * Research packet → editable preview draft JSON.
 *
 * Usage:
 *   npm run preseason:draft-preview -- --team=CHA --season=2026
 *   npm run preseason:draft-preview -- --all --season=2026
 *
 * Writes content/preseason/{season}/{ABBR}.preview.draft.json
 * Preview page loads these when curated registry content is missing.
 */

import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import {
  previewDraftPath,
  readResearchPacketFile,
  writePreviewDraftContent,
  preseasonContentRoot,
} from '@/lib/teams/preseason-preview/automation/storage';
import {
  collectResearchEntityIds,
  loadNbaPlayerIdsByEntityIds,
} from '@/lib/teams/preseason-preview/nba-player-ids';
import { researchPacketToPreviewContent } from '@/lib/teams/preseason-preview/research-to-preview-content';

function readArg(name: string): string | null {
  const argv = process.argv.slice(2);
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = argv.findIndex((a) => a === `--${name}`);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) {
    return argv[idx + 1];
  }
  return process.env[`npm_config_${name}`]?.trim() || null;
}

function hasFlag(name: string): boolean {
  if (process.argv.includes(`--${name}`)) return true;
  const env = process.env[`npm_config_${name}`];
  return env === 'true' || env === '1' || env === '';
}

async function listResearchSlugs(season: string): Promise<string[]> {
  const dir = path.join(preseasonContentRoot(), season);
  const entries = await fs.readdir(dir);
  return entries
    .filter((n) => n.endsWith('.research.json'))
    .map((n) => n.replace(/\.research\.json$/, ''))
    .sort((a, b) => a.localeCompare(b));
}

async function draftOne(season: string, slug: string): Promise<string> {
  const research = await readResearchPacketFile(season, slug);
  if (!research) {
    throw new Error(`Missing research packet: ${season}/${slug}.research.json`);
  }
  const nbaIds = await loadNbaPlayerIdsByEntityIds(
    collectResearchEntityIds(research)
  );
  const content = researchPacketToPreviewContent(research, nbaIds);
  return writePreviewDraftContent(content);
}


async function main() {
  const season = readArg('season') || '2026';
  const team = readArg('team');
  const all = hasFlag('all');

  if (!team && !all) {
    console.error('Required: --team=CHA or --all  (optional --season=2026)');
    process.exit(1);
  }

  const slugs = all ? await listResearchSlugs(season) : [team!.toUpperCase()];
  const written: string[] = [];

  for (const slug of slugs) {
    const dest = await draftOne(season, slug);
    written.push(dest);
    console.error(`wrote ${previewDraftPath(season, slug)}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        season,
        count: written.length,
        paths: written,
        next: 'Edit *.preview.draft.json then open /teams/{id}/preview — curated DET/BOS still win over drafts',
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
