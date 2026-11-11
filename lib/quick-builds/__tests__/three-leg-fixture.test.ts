import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  QUICK_BUILD_ATTEMPTS_SQL,
  QUICK_BUILD_CLOCK_SQL,
  QUICK_BUILD_GAMES_SQL,
  QUICK_BUILD_OBSERVATION_COUNT_SQL,
  QUICK_BUILD_OBSERVATION_ROWS_SQL,
  loadResearchQuickBuilds,
} from '@/lib/quick-builds/research-snapshot';
import { QUICK_BUILD_PLAYERS_SQL } from '@/lib/quick-builds/display';
import { QUICK_BUILD_THREE_LEG_PRESETS } from '@/lib/quick-builds/types';

const FIXTURE_DIR = path.resolve('C:/Users/tiama/Desktop/Coding/nba-analytics-v3/notes/quick-builds-realdata');
const BOOKS = ['draftkings', 'fanduel', 'betmgm', 'caesars'] as const;

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
    throw new Error(`unexpected sql`);
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

const eveningFixture = load('evening-slate-export.json');
const morningFixture = load('slate-export.json');

describe('three-leg fixture replay', () => {
  it.skipIf(eveningFixture == null)('replays the November 10 evening pull through the implemented generator', async () => {
    const evening = eveningFixture;
    if (!evening) return;
    expect(evening.capturedAsOf.startsWith('2026-11-10T23:06:28')).toBe(true);
    const now = parseTimestamp(evening.capturedAsOf);
    const keys = sourceKeys(evening);
    const report: unknown[] = [];
    for (const sportsbook of BOOKS) {
      const started = Date.now();
      const before = process.memoryUsage().heapUsed;
      const first = await loadResearchQuickBuilds({
        sportsbook,
        preset: 'midrange',
        legCount: 3,
        now,
        query: queryFor(evening),
      });
      const elapsed = Date.now() - started;
      const heap = process.memoryUsage().heapUsed - before;
      const second = await loadResearchQuickBuilds({
        sportsbook,
        preset: 'midrange',
        legCount: 3,
        now,
        query: queryFor(evening),
      });
      expect(second.builds.map((build) => build.id)).toEqual(first.builds.map((build) => build.id));
      expect(first.status).toBe('ok');
      expect(first.builds.length).toBe(5);
      expect(typeof first.searchComplete).toBe('boolean');
      const players = new Set<string>();
      const playerCounts = new Map<string, number>();
      const markets = new Set<string>();
      const prices: number[] = [];
      for (const build of first.builds) {
        expect(build.legs).toHaveLength(3);
        expect(new Set(build.legs.map((leg) => leg.gameId)).size).toBe(3);
        expect(new Set(build.legs.map((leg) => leg.playerId)).size).toBe(3);
        expect(build.combinedAmerican).toBeGreaterThanOrEqual(QUICK_BUILD_THREE_LEG_PRESETS.midrange.minAmerican);
        expect(build.combinedAmerican).toBeLessThanOrEqual(QUICK_BUILD_THREE_LEG_PRESETS.midrange.maxAmerican);
        prices.push(build.combinedAmerican);
        for (const leg of build.legs) {
          players.add(leg.playerId);
          playerCounts.set(leg.playerId, (playerCounts.get(leg.playerId) ?? 0) + 1);
          markets.add(leg.market);
          const key = [
            leg.pullRunId,
            leg.playerId,
            leg.gameId,
            leg.market,
            leg.side,
            String(Number(leg.line)),
            leg.sportsbook,
            String(Number(leg.oddsAmerican)),
            String(Date.parse(leg.observedAt)),
          ].join('|');
          expect(keys.has(key), key).toBe(true);
        }
      }
      expect(players.size).toBeGreaterThanOrEqual(12);
      expect(Math.max(...playerCounts.values())).toBeLessThanOrEqual(2);
      expect(markets.size).toBeGreaterThan(1);
      report.push({
        sportsbook,
        builds: first.builds.length,
        players: players.size,
        maxPlayer: Math.max(...playerCounts.values()),
        markets: [...markets].sort(),
        payout: [Math.min(...prices), Math.max(...prices)],
        searchComplete: first.searchComplete,
        elapsedMs: elapsed,
        heapBytes: heap,
      });
    }
    console.log(JSON.stringify({ capture: 'evening', report }));
  }, 180_000);

  it.skipIf(morningFixture == null)('replays the November 10 morning pull through the same generator', async () => {
    const morning = morningFixture;
    if (!morning) return;
    const now = parseTimestamp(morning.capturedAsOf);
    const report: unknown[] = [];
    for (const sportsbook of BOOKS) {
      const started = Date.now();
      const result = await loadResearchQuickBuilds({
        sportsbook,
        preset: 'midrange',
        legCount: 3,
        now,
        query: queryFor(morning),
      });
      expect(result.status).toBe('ok');
      expect(result.builds.length).toBe(5);
      expect(result.builds.every((build) => build.legs.length === 3)).toBe(true);
      expect(result.builds.every((build) => (
        build.combinedAmerican >= 400 && build.combinedAmerican <= 699
      ))).toBe(true);
      const players = new Set(result.builds.flatMap((build) => build.legs.map((leg) => leg.playerId)));
      report.push({
        sportsbook,
        builds: result.builds.length,
        players: players.size,
        pulls: [...new Set(result.builds.flatMap((build) => build.legs.map((leg) => leg.pullRunId)))],
        elapsedMs: Date.now() - started,
        searchComplete: result.searchComplete,
      });
    }
    console.log(JSON.stringify({ capture: 'morning', report }));
  }, 180_000);
});
