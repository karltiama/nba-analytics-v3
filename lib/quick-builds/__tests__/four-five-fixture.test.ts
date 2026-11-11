import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  QUICK_BUILD_ATTEMPTS_SQL,
  QUICK_BUILD_CLOCK_SQL,
  QUICK_BUILD_GAMES_SQL,
  QUICK_BUILD_OBSERVATION_COUNT_SQL,
  QUICK_BUILD_OBSERVATION_ROWS_SQL,
  buildResearchQuickBuildRequest,
} from '@/lib/quick-builds/research-snapshot';
import { generateQuickBuilds } from '@/lib/quick-builds';
import { QUICK_BUILD_PLAYERS_SQL } from '@/lib/quick-builds/display';
import {
  QUICK_BUILD_FIVE_LEG_PRESETS,
  QUICK_BUILD_FOUR_LEG_PRESETS,
  type QuickBuildFiveLegPresetName,
  type QuickBuildFourLegPresetName,
} from '@/lib/quick-builds/types';

const FIXTURE_DIR = path.resolve('C:/Users/tiama/Desktop/Coding/nba-analytics-v3/notes/quick-builds-realdata');
const BOOKS = ['draftkings', 'fanduel', 'betmgm', 'caesars'] as const;
const FIXTURES = [
  ['nov10-morning', 'slate-export.json'],
  ['nov10-evening', 'evening-slate-export.json'],
  ['nov11', 'november-11-slate-export.json'],
] as const;

type Fixture = {
  capturedAsOf: string;
  games: Array<{ game_id: string; start_time: string; status: string }>;
  attempts: Array<Record<string, unknown>>;
  clocks: Array<{ pull_run_id: string; game_id: string }>;
  observations: Array<Record<string, unknown>>;
  players: Array<{ player_id: string; full_name: string }>;
};

function parseTimestamp(value: string): Date {
  const iso = value.includes('T') ? value : value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`unparsed timestamp ${value}`);
  return parsed;
}

function load(name: string): Fixture | null {
  const file = path.join(FIXTURE_DIR, name);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Fixture;
}

function queryFor(fixture: Fixture) {
  const pairs = (pullIds: readonly number[], gameIds: readonly number[]) => (
    new Set(pullIds.map((pullId, index) => `${pullId}|${gameIds[index]}`))
  );
  return async (sql: string, params?: unknown[]): Promise<readonly unknown[]> => {
    if (sql === QUICK_BUILD_GAMES_SQL) {
      return fixture.games.map((game) => ({ ...game, start_time: parseTimestamp(game.start_time) }));
    }
    if (sql === QUICK_BUILD_ATTEMPTS_SQL) {
      const ids = new Set((params?.[0] as string[]) ?? []);
      return fixture.attempts.filter((row) => ids.has(String(row.game_id))).map((row) => ({
        ...row,
        completed_at: parseTimestamp(String(row.completed_at)),
        started_at: parseTimestamp(String(row.started_at)),
      }));
    }
    if (sql === QUICK_BUILD_CLOCK_SQL) {
      const keys = pairs(params?.[0] as number[], params?.[1] as number[]);
      return fixture.clocks.filter((row) => keys.has(`${row.pull_run_id}|${row.game_id}`));
    }
    if (sql === QUICK_BUILD_OBSERVATION_COUNT_SQL || sql === QUICK_BUILD_OBSERVATION_ROWS_SQL) {
      const keys = pairs(params?.[0] as number[], params?.[1] as number[]);
      const book = String(params?.[2]);
      const markets = new Set((params?.[3] as string[]) ?? []);
      const rows = fixture.observations.filter((row) => (
        keys.has(`${row.pull_run_id}|${row.game_id}`)
        && String(row.sportsbook).trim().toLowerCase() === book
        && markets.has(String(row.prop_type).trim().toLowerCase())
        && ['over', 'under'].includes(String(row.side).trim().toLowerCase())
      ));
      if (sql === QUICK_BUILD_OBSERVATION_COUNT_SQL) return [{ observation_count: rows.length }];
      return rows.map((row) => ({ ...row, observed_at: parseTimestamp(String(row.observed_at)) }));
    }
    if (sql === QUICK_BUILD_PLAYERS_SQL) {
      const ids = new Set((params?.[0] as string[]) ?? []);
      return fixture.players.filter((row) => ids.has(row.player_id));
    }
    throw new Error('unexpected sql');
  };
}

function sourceKeys(fixture: Fixture): Set<string> {
  return new Set(fixture.observations.map((row) => [
    String(row.pull_run_id),
    String(row.player_id),
    String(row.game_id),
    String(row.prop_type).trim().toLowerCase(),
    String(row.side).trim().toLowerCase(),
    String(Number(row.line_value)),
    String(row.sportsbook).trim().toLowerCase(),
    String(Number(row.odds_american)),
    String(parseTimestamp(String(row.observed_at)).getTime()),
  ].join('|')));
}

const loaded = FIXTURES.map(([label, file]) => [label, load(file)] as const);

describe('four- and five-leg fixture replay', () => {
  it('runs the bounded generator on every book, preset, and capture', async () => {
    expect(loaded.every(([, fixture]) => fixture != null)).toBe(true);
    const rows: Record<string, unknown>[] = [];
    for (const [label, fixture] of loaded) {
      if (!fixture) continue;
      const now = parseTimestamp(fixture.capturedAsOf);
      const keys = sourceKeys(fixture);
      for (const legCount of [4, 5] as const) {
        const presets = legCount === 4
          ? (Object.keys(QUICK_BUILD_FOUR_LEG_PRESETS) as QuickBuildFourLegPresetName[])
          : (Object.keys(QUICK_BUILD_FIVE_LEG_PRESETS) as QuickBuildFiveLegPresetName[]);
        const band = legCount === 4 ? QUICK_BUILD_FOUR_LEG_PRESETS : QUICK_BUILD_FIVE_LEG_PRESETS;
        for (const sportsbook of BOOKS) {
          for (const preset of presets) {
            const range = band[preset as keyof typeof band];
            const request = await buildResearchQuickBuildRequest({
              sportsbook,
              preset,
              legCount,
              now,
              query: queryFor(fixture),
            });
            const started = Date.now();
            const before = process.memoryUsage().heapUsed;
            const first = generateQuickBuilds(request);
            const elapsedMs = Date.now() - started;
            const heapBytes = process.memoryUsage().heapUsed - before;
            const second = generateQuickBuilds(request);
            const players = new Map<string, number>();
            const exact = new Set<string>();
            const markets = new Set<string>();
            const payouts: number[] = [];
            let sourceMisses = 0;
            let distinctGamesOk = true;
            for (const build of first.builds) {
              payouts.push(build.combinedAmerican);
              if (new Set(build.legs.map((leg) => leg.gameId)).size !== build.legs.length) distinctGamesOk = false;
              if (new Set(build.legs.map((leg) => leg.playerId)).size !== build.legs.length) distinctGamesOk = false;
              for (const leg of build.legs) {
                players.set(leg.playerId, (players.get(leg.playerId) ?? 0) + 1);
                exact.add(`${leg.playerId}|${leg.gameId}|${leg.market}|${leg.side}|${leg.line}`);
                markets.add(leg.market);
                const key = [
                  leg.pullRunId,
                  leg.playerId,
                  leg.gameId,
                  leg.market,
                  leg.side,
                  String(leg.line),
                  leg.sportsbook,
                  String(leg.oddsAmerican),
                  String(Date.parse(leg.observedAt)),
                ].join('|');
                if (!keys.has(key)) sourceMisses += 1;
              }
            }
            rows.push({
              fixture: label,
              sportsbook,
              legCount,
              preset,
              builds: first.builds.length,
              players: players.size,
              exactLegs: exact.size,
              markets: markets.size,
              maxPlayer: Math.max(0, ...players.values()),
              distinctGames: distinctGamesOk,
              payoutMin: payouts.length ? Math.min(...payouts) : null,
              payoutMax: payouts.length ? Math.max(...payouts) : null,
              inBand: payouts.every((price) => price >= range.minAmerican && price <= range.maxAmerican),
              sourceMisses,
              repeatable: JSON.stringify(first.builds) === JSON.stringify(second.builds),
              searchComplete: first.searchComplete ?? null,
              probes: first.searchStats?.probes ?? null,
              candidates: first.searchStats?.candidates ?? null,
              tuplesVisited: first.searchStats?.tuplesVisited ?? null,
              tuplesAvailable: first.searchStats?.tuplesAvailable ?? null,
              elapsedMs,
              heapBytes,
              emptyReason: first.emptyReason,
            });
          }
        }
      }
    }
    const reportDir = path.join(FIXTURE_DIR);
    fs.writeFileSync(path.join(reportDir, 'four-five-generator-report.json'), JSON.stringify(rows, null, 2));
    expect(rows).toHaveLength(72);
    expect(rows.every((row) => row.repeatable === true && row.sourceMisses === 0 && row.distinctGames === true)).toBe(true);
    expect(rows.every((row) => Number(row.probes) <= 80_000 && Number(row.candidates) <= 1_500 && Number(row.tuplesVisited) <= 256)).toBe(true);
    expect(rows.every((row) => row.inBand === true)).toBe(true);
    expect(rows.every((row) => Number(row.elapsedMs) < 5000)).toBe(true);
    expect(rows.every((row) => Number(row.heapBytes) < 80 * 1024 * 1024)).toBe(true);
    const middle = rows.filter((row) => row.preset === 'four_middle' || row.preset === 'five_middle');
    const summary = middle.map((row) => `${row.fixture} ${row.sportsbook} ${row.legCount} builds=${row.builds} players=${row.players} markets=${row.markets} max=${row.maxPlayer} complete=${row.searchComplete} ms=${row.elapsedMs}`).join('\n');
    expect(middle.every((row) => row.builds === 5), summary).toBe(true);
  }, 180_000);
});
