import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { observationPrecedes } from '../f39b/publish';
import {
  isClosingEligible,
  isNearTipEligible,
  isPregameRefreshSelectable,
  isPregameRefreshWindow,
  PREGAME_REFRESH_TARGET_SQL,
} from '../game-discovery';
import { PROPS_DAILY_HTTP_ATTEMPT_CAP } from '../attempt-budget';
import {
  easternWallTimeToUtc,
  estimateArchiveBytes,
  estimateControlRowBytes,
  OBSERVED_ARCHIVE_GZIP_BYTES,
  planPregameRefresh,
  pregameRefreshMigrated,
  resolveProtectionPages,
  simulatePregameSlate,
  storageAdmissionDecision,
  WORKER_CONCURRENCY,
  type PlanningPages,
  type PregameCandidate,
  type PregameRunSnapshot,
  type SlateGame,
} from '../pregame-refresh';
import { CLUSTER_HALT_BYTES } from '../../../../lib/ops/storage-budget';
import { BASE_SCHEDULE_FRESHNESS_MS } from '../../../../lib/props/s3-current-board/pointer';

const MINUTE = 60_000;
const TIP = Date.parse('2026-11-25T00:00:00.000Z');

function candidate(gameId: string, tipMs: number, status = 'scheduled', lastSuccessAtMs: number | null = null): PregameCandidate {
  return { gameId, tipMs, status, lastSuccessAtMs };
}

function slate(count: number, tipMs: number, staggerMin = 0) {
  return Array.from({ length: count }, (_, index) => ({
    gameId: String(100 + index),
    tipMs: tipMs + index * staggerMin * MINUTE,
    status: 'scheduled',
  }));
}

describe('pregame refresh window', () => {
  it('keeps the existing near-tip and closing predicates', () => {
    expect(isNearTipEligible(new Date(TIP - 60 * MINUTE), new Date(TIP - 120 * MINUTE), 'scheduled')).toBe(true);
    expect(isNearTipEligible(new Date(TIP - 75 * MINUTE), new Date(TIP - 150 * MINUTE), 'scheduled')).toBe(false);
    expect(isClosingEligible(new Date(TIP), new Date(TIP - 10 * MINUTE), 'scheduled')).toBe(true);
    expect(isClosingEligible(new Date(TIP), new Date(TIP - 15 * MINUTE), 'scheduled')).toBe(false);
  });

  it('selects (T-15, T-120] and leaves T-15 to closing', () => {
    expect(isPregameRefreshWindow(new Date(TIP), new Date(TIP - 120 * MINUTE))).toBe(true);
    expect(isPregameRefreshWindow(new Date(TIP), new Date(TIP - 15 * MINUTE))).toBe(false);
    expect(isPregameRefreshWindow(new Date(TIP), new Date(TIP - 15 * MINUTE - 1))).toBe(true);
    expect(isPregameRefreshWindow(new Date(TIP), new Date(TIP - 121 * MINUTE))).toBe(false);
    expect(isPregameRefreshWindow(new Date(TIP), new Date(TIP))).toBe(false);
    expect(PREGAME_REFRESH_TARGET_SQL).toContain("interval '15 minutes'");
    expect(PREGAME_REFRESH_TARGET_SQL).toContain("interval '120 minutes'");
  });

  it('rejects final, live, postponed, and cancelled games and keeps an off-quarter tip', () => {
    const tip = new Date(TIP + 7 * MINUTE);
    const at = new Date(tip.getTime() - 47 * MINUTE);
    expect(isPregameRefreshSelectable(tip, at, 'scheduled')).toBe(true);
    expect(isPregameRefreshSelectable(tip, at, 'Final')).toBe(false);
    expect(isPregameRefreshSelectable(tip, at, 'live')).toBe(false);
    expect(isPregameRefreshSelectable(tip, at, 'in progress')).toBe(false);
    expect(isPregameRefreshSelectable(tip, at, 'postponed')).toBe(false);
    expect(isPregameRefreshSelectable(tip, at, 'cancelled')).toBe(false);
    expect(isPregameRefreshSelectable(tip, at, 'canceled')).toBe(false);
  });
});

describe('pregame refresh admission', () => {
  const now = TIP - 40 * MINUTE;

  it('does not enqueue a second pull in the same interval or while one is active', () => {
    const games = [candidate('101', TIP)];
    const started: PregameRunSnapshot = {
      gameId: '101',
      universe: 'pregame_refresh',
      status: 'started',
      errorMessage: null,
      startedAtMs: now - 20 * MINUTE,
      providerAttempts: 1,
    };
    expect(planPregameRefresh({
      nowMs: now,
      candidates: games,
      runs: [started],
      consumedAttempts: 1,
      planningPages: 1,
      inFlight: [{ gameId: '101', attemptsReserved: 1 }],
      closingGames: 1,
      nearTipGames: 0,
      storage: 'unknown',
    }).skipped).toEqual([{ gameId: '101', reason: 'active_or_queued' }]);

    const recent: PregameRunSnapshot = { ...started, status: 'success', startedAtMs: now - MINUTE };
    expect(planPregameRefresh({
      nowMs: now,
      candidates: games,
      runs: [recent],
      consumedAttempts: 1,
      planningPages: 1,
      inFlight: [],
      closingGames: 1,
      nearTipGames: 0,
      storage: 'unknown',
    }).skipped[0]?.reason).toBe('same_interval');
  });

  it('allows the next interval and yields to a near-tip claim', () => {
    const games = [candidate('101', TIP, 'scheduled', now - 16 * MINUTE)];
    const again = planPregameRefresh({
      nowMs: now,
      candidates: games,
      runs: [{
        gameId: '101',
        universe: 'pregame_refresh',
        status: 'success',
        errorMessage: null,
        startedAtMs: now - 16 * MINUTE,
        providerAttempts: 1,
      }],
      consumedAttempts: 1,
      planningPages: 1,
      inFlight: [],
      closingGames: 1,
      nearTipGames: 0,
      storage: 'unknown',
    });
    expect(again.admit).toEqual(['101']);

    const overlap = planPregameRefresh({
      nowMs: now,
      candidates: games,
      runs: [{
        gameId: '101',
        universe: 'near_tip',
        status: 'success',
        errorMessage: null,
        startedAtMs: now - MINUTE,
        providerAttempts: 1,
      }],
      consumedAttempts: 1,
      planningPages: 1,
      inFlight: [],
      closingGames: 1,
      nearTipGames: 0,
      storage: 'unknown',
    });
    expect(overlap.skipped[0]?.reason).toBe('cross_universe');
  });

  it('retries a 429 on the next interval and keeps an unchanged price on the observation clock', () => {
    const blocked = planPregameRefresh({
      nowMs: now,
      candidates: [candidate('101', TIP)],
      runs: [{
        gameId: '101',
        universe: 'pregame_refresh',
        status: 'error',
        errorMessage: 'provider_429',
        startedAtMs: now - MINUTE,
        providerAttempts: 1,
      }],
      consumedAttempts: 299,
      planningPages: 1,
      inFlight: [],
      closingGames: 1,
      nearTipGames: 0,
      storage: 'unknown',
    });
    expect(blocked.skipped[0]?.reason).toBe('same_interval');

    const later = planPregameRefresh({
      nowMs: now + 15 * MINUTE,
      candidates: [candidate('101', TIP)],
      runs: [{
        gameId: '101',
        universe: 'pregame_refresh',
        status: 'error',
        errorMessage: 'provider_429',
        startedAtMs: now - MINUTE,
        providerAttempts: 1,
      }],
      consumedAttempts: 295,
      planningPages: 1,
      protectionPages: 3,
      inFlight: [],
      closingGames: 1,
      nearTipGames: 0,
      storage: 'unknown',
    });
    expect(later.admit).toEqual([]);
    expect(later.chargePages).toBe(3);
    expect(later.skipped[0]?.reason).toBe('closing_reserve');

    const samePrice = { observedAt: new Date(now).toISOString(), pullRunId: 1 };
    const nextPrice = { observedAt: new Date(now + 15 * MINUTE).toISOString(), pullRunId: 2 };
    expect(observationPrecedes(samePrice, nextPrice)).toBe(true);
    expect(observationPrecedes(nextPrice, samePrice)).toBe(false);
    expect(observationPrecedes(samePrice, { ...samePrice, pullRunId: 1 })).toBe(false);
  });

  it('prefers a game with no snapshot, then the closer tip, and refuses at the storage halt', () => {
    const missing = planPregameRefresh({
      nowMs: now,
      candidates: [candidate('202', TIP, 'scheduled', now - 40 * MINUTE), candidate('101', TIP)],
      runs: [],
      consumedAttempts: 292,
      planningPages: 1,
      inFlight: [],
      closingGames: 1,
      nearTipGames: 1,
      storage: 'unknown',
    });
    expect(missing.admit).toEqual([]);
    expect(missing.skipped.map((skip) => skip.reason)).toEqual(['near_tip_reserve', 'near_tip_reserve']);

    const room = planPregameRefresh({
      nowMs: now,
      candidates: [candidate('202', TIP, 'scheduled', now - 40 * MINUTE), candidate('101', TIP)],
      runs: [],
      consumedAttempts: 0,
      planningPages: 1,
      inFlight: [{ gameId: '303', attemptsReserved: 0 }],
      closingGames: 0,
      nearTipGames: 0,
      storage: 'unknown',
    });
    expect(room.admit[0]).toBe('101');

    expect(storageAdmissionDecision(null)).toBe('unknown');
    expect(storageAdmissionDecision(CLUSTER_HALT_BYTES)).toBe('refuse');
    expect(storageAdmissionDecision(CLUSTER_HALT_BYTES - 1)).toBe('admit');
    const halted = planPregameRefresh({
      nowMs: now,
      candidates: [candidate('101', TIP)],
      runs: [],
      consumedAttempts: 0,
      planningPages: 1,
      inFlight: [],
      closingGames: 0,
      nearTipGames: 0,
      storage: 'refuse',
    });
    expect(halted.skipped).toEqual([{ gameId: '101', reason: 'storage_admission' }]);
    expect(WORKER_CONCURRENCY).toBe(2);
    expect(BASE_SCHEDULE_FRESHNESS_MS).toBe(30 * MINUTE);
    expect(PROPS_DAILY_HTTP_ATTEMPT_CAP).toBe(300);
  });
});

const ET_DATE = '2026-11-24';

function scheduled(games: SlateGame[], planningPages: PlanningPages, actualPages: number, extra: Record<string, unknown> = {}) {
  return simulatePregameSlate({
    games,
    etDate: ET_DATE,
    planningPages,
    actualPages,
    ...extra,
  });
}

function successfulPairs(result: ReturnType<typeof simulatePregameSlate>, gameId: string) {
  return result.collections
    .filter((item) => item.success && item.gameId === gameId)
    .map((item) => `${(TIP - item.tickMs) / MINUTE}:${item.universe}`);
}

describe('scheduled pregame collection', () => {
  it('accepts the new universe only when the check text names it', () => {
    expect(pregameRefreshMigrated(null)).toBe(false);
    expect(pregameRefreshMigrated("CHECK ((universe IS NULL OR universe = ANY (ARRAY['broad'::text, 'near_tip'::text, 'closing'::text])))")).toBe(false);
    expect(pregameRefreshMigrated("CHECK ((universe IS NULL OR universe = ANY (ARRAY['broad'::text, 'near_tip'::text, 'closing'::text, 'pregame_refresh'::text])))")).toBe(true);
    expect(easternWallTimeToUtc(ET_DATE, 19, 0)).toBe(TIP);
    expect(resolveProtectionPages(undefined)).toBe(3);
    expect(resolveProtectionPages('4')).toBe(4);
    expect(() => resolveProtectionPages('11')).toThrow(/1 to 10/);
  });

  it('reads the unapplied migration as a preflight, including the duplicate-row guard', () => {
    const migration = fs.readFileSync(path.join(process.cwd(), 'db/schemas/MIGRATION_player_prop_pregame_refresh_universe.sql'), 'utf8');
    expect(migration).toContain("universe in ('broad', 'near_tip', 'closing', 'pregame_refresh')");
    expect(migration).toContain('raw_player_prop_game_runs_one_active_observation');
    expect(migration).toContain('raise exception');
    expect(migration).not.toContain('drop constraint if exists player_prop_game_runs_status_check');
    expect(migration).not.toContain('references raw.player_prop_pull_runs');
    const schema = fs.readFileSync(path.join(process.cwd(), 'db/schemas/raw_player_prop_game_runs.sql'), 'utf8');
    expect(schema).toContain("universe in ('broad', 'near_tip', 'pregame_refresh', 'closing')");
    expect(schema).toContain('references raw.player_prop_pull_runs');
  });

  it('spends only ledger attempts on the next decision and raises the charge above a one-page assumption', () => {
    const games = Array.from({ length: 15 }, (_, index) => candidate(String(index), TIP));
    const open = planPregameRefresh({
      nowMs: TIP - 120 * MINUTE,
      candidates: games,
      runs: [],
      consumedAttempts: 0,
      planningPages: 1,
      protectionPages: 3,
      inFlight: [],
      closingGames: 15,
      nearTipGames: 15,
      storage: 'unknown',
    });
    expect(open.protectionRaised).toBe(true);
    expect(open.chargePages).toBe(3);
    expect(open.admit.length).toBeGreaterThan(0);
    const afterLedger = planPregameRefresh({
      nowMs: TIP - 105 * MINUTE,
      candidates: games,
      runs: open.admit.map((gameId) => ({
        gameId,
        universe: 'pregame_refresh' as const,
        status: 'success' as const,
        errorMessage: null,
        startedAtMs: TIP - 120 * MINUTE,
        providerAttempts: 4,
      })),
      consumedAttempts: open.admit.length * 4,
      planningPages: 1,
      protectionPages: 3,
      inFlight: [],
      closingGames: 15,
      nearTipGames: 15,
      storage: 'unknown',
    });
    expect(afterLedger.chargePages).toBe(4);
    expect(afterLedger.observedPeak).toBe(4);
    const exhausted = planPregameRefresh({
      nowMs: TIP - 90 * MINUTE,
      candidates: games,
      runs: [],
      consumedAttempts: 300,
      planningPages: 1,
      protectionPages: 3,
      inFlight: [],
      closingGames: 15,
      nearTipGames: 15,
      storage: 'unknown',
    });
    expect(exhausted.admit).toEqual([]);
    expect(exhausted.skipped.every((skip) => skip.reason === 'budget' || skip.reason === 'closing_reserve' || skip.reason === 'near_tip_reserve')).toBe(true);
  });

  it('collects an on-the-hour tip on the quarter-hour and five-minute grids', () => {
    const one = scheduled([{ gameId: '101', tipMs: TIP, status: 'scheduled' }], 1, 1);
    expect(successfulPairs(one, '101')).toEqual([
      '120:pregame_refresh',
      '105:pregame_refresh',
      '90:pregame_refresh',
      '75:pregame_refresh',
      '60:near_tip',
      '45:pregame_refresh',
      '30:pregame_refresh',
      '10:closing',
    ]);
    expect(one.refreshCollections).toBe(6);
    expect(one.nearTipCollections).toBe(1);
    expect(one.closingCollections).toBe(1);
  });

  it('keeps one closing for an off-quarter tip and does not pair refresh with near-tip inside 15 minutes', () => {
    const tipMs = easternWallTimeToUtc(ET_DATE, 19, 7);
    const result = scheduled([{ gameId: '101', tipMs, status: 'scheduled' }], 1, 1);
    expect(result.nearTipCollections).toBe(1);
    expect(result.closingCollections).toBe(1);
    const hits = result.collections.filter((item) => item.success);
    const near = hits.find((item) => item.universe === 'near_tip');
    const closing = hits.find((item) => item.universe === 'closing');
    expect(near).toBeTruthy();
    expect(closing).toBeTruthy();
    for (const refresh of hits.filter((item) => item.universe === 'pregame_refresh')) {
      expect(Math.abs(refresh.tickMs - (near?.tickMs ?? 0))).toBeGreaterThanOrEqual(15 * MINUTE);
    }
    expect((closing?.tickMs ?? 0) - (hits.filter((item) => item.universe === 'pregame_refresh').at(-1)?.tickMs ?? 0)).toBeLessThan(15 * MINUTE);
  });

  it('counts 3-, 10-, and 15-game slates from the same grids', () => {
    for (const count of [3, 10, 15]) {
      const result = scheduled(slate(count, TIP), 1, 1);
      expect(result.refreshCollections).toBe(count * 6);
      expect(result.nearTipCollections).toBe(count);
      expect(result.closingCollections).toBe(count);
      expect(result.attempts).toBe(count * 8);
    }
    const staggered = scheduled(
      [
        { gameId: '101', tipMs: TIP, status: 'scheduled' },
        { gameId: '102', tipMs: TIP + 30 * MINUTE, status: 'scheduled' },
      ],
      1,
      1
    );
    const firstTick = easternWallTimeToUtc(ET_DATE, 17, 0);
    expect(staggered.collections.filter((item) => item.success && item.tickMs === firstTick).map((item) => item.gameId)).toEqual(['101']);
  });

  it('holds closing room at the planning page count and lets the ledger refuse the rest', () => {
    const games = slate(15, TIP);
    const one = scheduled(games, 1, 1);
    const two = scheduled(games, 2, 2);
    const three = scheduled(games, 3, 3);
    expect(one.closingCollections).toBe(15);
    expect(two.closingCollections).toBe(15);
    expect(three.closingCollections).toBe(15);
    expect(one.attempts).toBe(120);
    expect(two.attempts).toBe(240);
    expect(three.attempts).toBe(300);
    expect(three.refreshCollections).toBe(70);
    const over = scheduled(games, 1, 3);
    expect(over.protectionRaised).toBe(true);
    expect(over.attempts).toBe(300);
    expect(over.refreshCollections).toBe(70);
    expect(over.closingCollections).toBe(15);
    expect(over.closingShortfall).toBe(0);
    expect(over.refreshCollections).toBeLessThan(one.refreshCollections);
    for (const skip of over.skipped) {
      expect(
        over.collections.some(
          (item) => item.success && item.universe === 'pregame_refresh' && item.gameId === skip.gameId && item.tickMs === skip.tickMs
        )
      ).toBe(false);
    }
  });

  it('does not promise closing when a fetch uses more pages than the allowance', () => {
    const four = scheduled(slate(15, TIP), 1, 4);
    expect(four.attempts).toBeLessThanOrEqual(300);
    expect(four.protectionRaised).toBe(true);
    expect(four.nearTipCollections).toBe(15);
    expect(four.closingCollections).toBe(11);
    expect(four.closingShortfall).toBe(4);
    expect(four.refreshCollections).toBeLessThan(90);
    const lateClosing = four.collections.filter((item) => item.universe === 'closing' && item.success === false);
    expect(lateClosing).toHaveLength(4);
    expect(lateClosing.every((item) => item.responseMs >= TIP)).toBe(true);
  });

  it('models delay, a 429, retries, and an already consumed budget without a second claim', () => {
    const games = slate(15, TIP);
    const delayed = scheduled(games, 1, 1, { workerDelayMs: 20 * MINUTE });
    expect(delayed.skipped.some((skip) => skip.reason === 'active_or_queued')).toBe(true);
    expect(delayed.attempts).toBeLessThanOrEqual(300);

    const first = easternWallTimeToUtc(ET_DATE, 17, 0);
    const failed = scheduled([{ gameId: '101', tipMs: TIP, status: 'scheduled' }], 1, 1, {
      failures: [{ gameId: '101', tickMs: first, attempts: 1 }],
    });
    const firstHit = failed.collections.find((item) => item.tickMs === first);
    expect(firstHit).toMatchObject({ success: false, attempts: 1 });
    expect(failed.refreshCollections).toBe(5);

    const retried = scheduled([{ gameId: '101', tipMs: TIP, status: 'scheduled' }], 1, 1, { extraReceives: 2 });
    expect(retried.refreshCollections).toBe(6);
    expect(retried.collections.filter((item) => item.success)).toHaveLength(8);
    expect(retried.attempts).toBe(24);

    const spent = scheduled(slate(15, TIP), 3, 3, { consumed: 290 });
    expect(spent.attempts).toBeLessThanOrEqual(10);
    expect(spent.closingCollections).toBeLessThan(15);
  });

  it('estimates metadata separately from the measured archive size', () => {
    expect(OBSERVED_ARCHIVE_GZIP_BYTES).toBe(106_000);
    for (const games of [3, 10, 15]) {
      const result = scheduled(slate(games, TIP), 1, 1);
      const rows = estimateControlRowBytes(result.collections.length, result.pullRuns);
      const archives = estimateArchiveBytes(result.collections.filter((item) => item.success).length);
      expect(rows).toBeLessThan(1_000_000);
      expect(archives).toBeGreaterThan(rows);
      expect(rows).toBeLessThan(CLUSTER_HALT_BYTES - 405_000_000);
    }
  });
});
