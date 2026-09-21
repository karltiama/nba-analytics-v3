/**
 * Facts-only preseason team packet CLI.
 *
 * Usage:
 *   npx tsx scripts/preseason/run-packet.ts --team=DET --season=2026
 *   npm run preseason:packet -- --team DET --season 2026
 */

import 'dotenv/config';
import pool from '@/lib/db';
import { runPreseasonPacket } from '@/lib/teams/preseason-preview/automation';

function readArg(name: string): string | null {
  const argv = process.argv.slice(2);
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = argv.findIndex((a) => a === `--${name}`);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) {
    return argv[idx + 1];
  }
  const envKey = `PRESEASON_${name.toUpperCase()}`;
  return process.env[envKey]?.trim() || null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const team = readArg('team');
  const season = readArg('season');
  if (!team || !season) {
    console.error('Required: --team DET --season 2026');
    process.exit(1);
  }

  const { packet, path } = await runPreseasonPacket({
    team,
    season,
    write: !hasFlag('no-write'),
  });

  if (hasFlag('stdout') || hasFlag('no-write')) {
    console.log(JSON.stringify(packet, null, 2));
  } else {
    console.log(
      JSON.stringify(
        {
          ok: true,
          path,
          team: packet.team,
          season: packet.season,
          previousSeason: packet.previousSeason,
          additions: packet.additions.length,
          departures: packet.departures.length,
          returning: packet.returningPlayers.length,
          playerSeasonStats: packet.playerSeasonStats.length,
          warnings: packet.warnings,
          snapshotAvailable: packet.previousSeasonRegular.available,
          snapshotRecord: packet.previousSeasonRegular.record,
          allGamesRecord: packet.previousSeasonAllGames.record,
          allGamesIncludesPostseason:
            packet.previousSeasonAllGames.includesPostseason,
        },
        null,
        2
      )
    );
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
