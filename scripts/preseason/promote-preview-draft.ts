/**
 * Promote an edited preview draft JSON into the curated registry.
 *
 * Usage:
 *   npx tsx scripts/preseason/promote-preview-draft.ts --team=CHA --season=2026
 *   npx tsx scripts/preseason/promote-preview-draft.ts --team=CHA --force
 *
 * Writes:
 *   lib/teams/preseason-preview/content/{stem}.ts
 * Updates:
 *   lib/teams/preseason-preview/registry.ts
 *
 * Refuses if draft still contains [EDIT] unless --force.
 */

import { promises as fs } from 'fs';
import path from 'path';
import {
  previewDraftPath,
  readPreviewDraftContent,
} from '@/lib/teams/preseason-preview/automation/storage';
import {
  renderCuratedPreviewModule,
  upsertPreseasonRegistry,
} from '@/lib/teams/preseason-preview/promote-registry';
import type { TeamPreseasonPreviewContent } from '@/lib/teams/preseason-preview/types';

/** File stem (no extension) + export base name (camelCase). */
const CURATED_STEM: Record<string, string> = {
  ATL: 'atlanta',
  BOS: 'boston',
  BKN: 'brooklyn',
  CHA: 'charlotte',
  CHI: 'chicago',
  CLE: 'cleveland',
  DAL: 'dallas',
  DEN: 'denver',
  DET: 'detroit',
  GSW: 'goldenState',
  HOU: 'houston',
  IND: 'indiana',
  LAC: 'clippers',
  LAL: 'lakers',
  MEM: 'memphis',
  MIA: 'miami',
  MIL: 'milwaukee',
  MIN: 'minnesota',
  NOP: 'newOrleans',
  NYK: 'newYork',
  OKC: 'oklahomaCity',
  ORL: 'orlando',
  PHI: 'philadelphia',
  PHX: 'phoenix',
  POR: 'portland',
  SAC: 'sacramento',
  SAS: 'sanAntonio',
  TOR: 'toronto',
  UTA: 'utah',
  WAS: 'washington',
};

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

function exportNameForStem(stem: string): string {
  return `${stem}PreseasonPreview`;
}

function contentDir(cwd = process.cwd()): string {
  return path.join(
    cwd,
    'lib',
    'teams',
    'preseason-preview',
    'content'
  );
}

function registryPath(cwd = process.cwd()): string {
  return path.join(cwd, 'lib', 'teams', 'preseason-preview', 'registry.ts');
}

function countEditMarkers(content: TeamPreseasonPreviewContent): number {
  const blob = JSON.stringify(content);
  return (blob.match(/\[EDIT\]/g) ?? []).length;
}

async function main() {
  const season = readArg('season') || '2026';
  const teamRaw = readArg('team');
  const force = hasFlag('force');

  if (!teamRaw) {
    console.error('Required: --team=CHA  (optional --season=2026 --force)');
    process.exit(1);
  }

  const slug = teamRaw.toUpperCase();
  const stem = CURATED_STEM[slug] ?? slug.toLowerCase();
  const exportName = exportNameForStem(stem);

  const draft = await readPreviewDraftContent(season, slug);
  if (!draft) {
    console.error(
      `Missing draft: ${previewDraftPath(season, slug)}\nRun: npx tsx scripts/preseason/draft-preview-from-research.ts --team=${slug}`
    );
    process.exit(1);
  }

  const editCount = countEditMarkers(draft);
  if (editCount > 0 && !force) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: 'DRAFT_STILL_HAS_EDIT_MARKERS',
          editCount,
          hint: 'Finish replacing [EDIT] markers, or pass --force to promote anyway',
          draft: previewDraftPath(season, slug),
        },
        null,
        2
      )
    );
    process.exit(2);
  }

  const modulePath = path.join(contentDir(), `${stem}.ts`);
  const displayName = draft.headline || draft.slug;
  const moduleSrc = renderCuratedPreviewModule({
    exportName,
    content: draft,
    displayName,
    season: draft.season,
  });
  await fs.mkdir(path.dirname(modulePath), { recursive: true });
  await fs.writeFile(modulePath, moduleSrc, 'utf8');

  const regPath = registryPath();
  const regBefore = await fs.readFile(regPath, 'utf8');
  const regAfter = upsertPreseasonRegistry({
    registrySrc: regBefore,
    stem,
    exportName,
  });
  await fs.writeFile(regPath, regAfter, 'utf8');

  console.log(
    JSON.stringify(
      {
        ok: true,
        team: slug,
        season,
        forced: force && editCount > 0,
        remainingEditMarkers: editCount,
        modulePath,
        exportName,
        registryPath: regPath,
        next: `Open /teams/${draft.teamId ?? slug}/preview — curated banner should be gone`,
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
