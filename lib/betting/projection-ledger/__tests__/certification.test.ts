import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { computePropEvFields } from '@/lib/betting/player-prop-ev-row';
import { computeProjection } from '@/lib/betting/player-prop-model';
import type { ModelInputStats, PlayerPropModelInputs } from '@/lib/betting/player-prop-inputs';
import { resolveEvTrack } from '@/lib/betting/ev-selection-policy';
import { PINNED_ANALYTICS_SEASON, getAnalyticsSeason } from '@/lib/season';
import { REGULAR_SEASON_OPEN_ET } from '@/lib/context-projection/game-universe';
import {
  LEDGER_MARKETS,
  LEDGER_SCHEDULER_INTERVAL_MINUTES,
  isLedgerMarket,
} from '@/lib/betting/projection-ledger/protocol';
import { buildLedgerMean, partitionSportsbookObservations } from '@/lib/betting/projection-ledger/compute';
import { crossSeasonProspectiveRemainsEligible, gameEligibleForLedgerPublish } from '@/lib/betting/projection-ledger/eligibility';
import { isProductionGitSha } from '@/lib/betting/projection-ledger/revision';
import { evaluateProjectionRow, passesAuthoritativeEvaluation } from '@/lib/betting/projection-ledger/evaluation';
import { classifyDuplicate, decideLedgerWrite, sameOfficialSlot } from '@/lib/betting/projection-ledger/idempotency';
import { classifyLedgerResolution, includedInPrimaryAccuracy } from '@/lib/betting/projection-ledger/resolution';
import { captureEligibleAtWrite, classifyLedgerCapture } from '@/lib/betting/projection-ledger/timing';
import { neutralStabilitySignals } from '@/lib/betting/track-b1-policy';

const root = path.resolve(__dirname, '../../../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

function stats(pts: number, reb = 8, ast = 6, threes = 2.5): ModelInputStats {
  return {
    pts,
    reb,
    ast,
    threes,
    pra: pts + reb + ast,
    pa: pts + ast,
    pr: pts + reb,
    ra: reb + ast,
  };
}

function inputs(overrides?: Partial<PlayerPropModelInputs>): PlayerPropModelInputs {
  const signal = neutralStabilitySignals();
  return {
    last10: stats(20),
    season: stats(10),
    ext: { last5: stats(30), std10: stats(4, 2, 2, 1) },
    meta: {
      signalsByStat: {
        pts: signal,
        reb: signal,
        ast: signal,
        threes: signal,
        pra: signal,
        pa: signal,
        pr: signal,
        ra: signal,
      },
    },
    seasonKey: '2025',
    sampleGamesUsed: 10,
    seasonGamesPlayed: 70,
    l10GameIds: ['g1', 'g2'],
    latestInputGameStartTime: '2026-04-12T23:00:00.000Z',
    ...overrides,
  };
}

const openingTip = '2026-10-20T23:00:00.000Z';
const productionSha = 'a'.repeat(40);

function atMinutesBeforeTip(tip: string, minutes: number): string {
  return new Date(Date.parse(tip) - minutes * 60_000).toISOString();
}

describe('projection ledger certification', () => {
  it('1. only the eight supported markets can be inserted', () => {
    expect(LEDGER_MARKETS).toEqual([
      'points',
      'rebounds',
      'assists',
      'threes',
      'points_assists',
      'points_rebounds',
      'rebounds_assists',
      'points_rebounds_assists',
    ]);
    const sql = read('db/schemas/MIGRATION_projection_ledger.sql');
    for (const market of LEDGER_MARKETS) expect(sql).toContain(`'${market}'`);
    expect(sql).not.toContain("'steals'");
    expect(sql).not.toContain("'blocks'");
    expect(sql).not.toContain("'turnovers'");
    expect(isLedgerMarket('steals')).toBe(false);
    expect(buildLedgerMean(inputs(), 'steals', 'trackB_calibrated')).toBeNull();
    expect(buildLedgerMean(inputs(), 'blocks', 'trackB_calibrated')).toBeNull();
    expect(buildLedgerMean(inputs(), 'turnovers', 'trackB_calibrated')).toBeNull();
  });

  it('2, 15, 16. live writes at or after tip are rejected; T-59 and T-48 are late', () => {
    const atTip = classifyLedgerCapture({ gameTipTime: openingTip, generatedAt: openingTip });
    const afterTip = classifyLedgerCapture({
      gameTipTime: openingTip,
      generatedAt: atMinutesBeforeTip(openingTip, -1),
    });
    expect(atTip.accept).toBe(false);
    expect(afterTip.accept).toBe(false);
    for (const minutes of [59, 48]) {
      const late = classifyLedgerCapture({
        gameTipTime: openingTip,
        generatedAt: atMinutesBeforeTip(openingTip, minutes),
      });
      expect(late.accept).toBe(true);
      if (late.accept) {
        expect(late.timingStatus).toBe('LATE_BEFORE_TIP');
        expect(
          captureEligibleAtWrite({
            provenanceType: 'PROSPECTIVE_LIVE',
            timingStatus: late.timingStatus,
            snapshotRevision: 1,
            generatedAt: atMinutesBeforeTip(openingTip, minutes),
            gameTipTime: openingTip,
          })
        ).toBe(false);
      }
    }
    const sql = read('db/schemas/MIGRATION_projection_ledger.sql');
    expect(sql).toContain("provenance_type <> 'PROSPECTIVE_LIVE' OR generated_at < game_tip_time");
  });

  it('3, 4, 29. backfill may keep a post-tip timestamp and test rows stay unofficial', () => {
    expect(
      captureEligibleAtWrite({
        provenanceType: 'RECONSTRUCTED_BACKFILL',
        timingStatus: 'NOT_APPLICABLE',
        snapshotRevision: 1,
        generatedAt: '2026-10-21T01:00:00.000Z',
        gameTipTime: openingTip,
      })
    ).toBe(false);
    expect(
      captureEligibleAtWrite({
        provenanceType: 'TEST',
        timingStatus: 'NOT_APPLICABLE',
        snapshotRevision: 1,
        generatedAt: atMinutesBeforeTip(openingTip, 60),
        gameTipTime: openingTip,
      })
    ).toBe(false);
    const sql = read('db/schemas/MIGRATION_projection_ledger.sql');
    expect(sql).toContain("timing_status = 'NOT_APPLICABLE'");
    expect(sql).toContain("p.provenance_type = 'PROSPECTIVE_LIVE'");
    expect(sql).toContain("provenance_type <> 'PROSPECTIVE_LIVE' OR generated_at < game_tip_time");
    expect(sql).not.toMatch(/CHECK \(\s*generated_at < game_tip_time\s*\)/);
  });

  it('5, 6. a duplicate retry and a new git SHA stay in the first official slot', () => {
    const slot = {
      gameId: 'g',
      playerId: 'p',
      market: 'points',
      snapshotPolicy: 'T_MINUS_60',
      provenanceType: 'PROSPECTIVE_LIVE',
      snapshotRevision: 1,
    };
    expect(sameOfficialSlot(slot, { ...slot, snapshotRevision: 1 })).toBe(true);
    expect(
      classifyDuplicate(
        { identity: slot, projectionValue: 21.5, codeRevision: 'sha-a' },
        21.5,
        'sha-b'
      )
    ).toBe('duplicate_same');
    expect(
      classifyDuplicate(
        { identity: slot, projectionValue: 21.5, codeRevision: 'sha-a' },
        22.1,
        'sha-b'
      )
    ).toBe('duplicate_conflict');
    const sql = read('db/schemas/MIGRATION_projection_ledger.sql');
    expect(sql).toContain(
      'game_id, player_id, market, snapshot_policy, provenance_type, snapshot_revision'
    );
    expect(sql).toContain('ON DELETE RESTRICT');
    const cycle = read('lib/betting/projection-ledger/cycle.ts');
    expect(cycle).toContain('ON CONFLICT');
    expect(cycle).toContain('DO NOTHING');
    expect(cycle).not.toMatch(/\bUPDATE\s+analytics\.projection/i);
    expect(cycle).not.toMatch(/\bDELETE\s+FROM\s+analytics\.projection/i);
    expect(cycle).not.toContain('projection_ledger_admin_delete');
  });

  it('7-11. sportsbook children stay facts: zero, many, multi-line, no missing side, no future observation', () => {
    const generatedAt = '2026-10-20T22:00:00.000Z';
    const empty = partitionSportsbookObservations([], generatedAt);
    expect(empty.accepted).toEqual([]);
    const many = partitionSportsbookObservations(
      [
        { sportsbook: 'draftkings', side: 'over', lineValue: 20.5, observedAt: generatedAt },
        { sportsbook: 'fanduel', side: 'under', lineValue: 20.5, observedAt: '2026-10-20T21:00:00.000Z' },
        { sportsbook: 'draftkings', side: 'over', lineValue: 21.5, observedAt: '2026-10-20T21:30:00.000Z' },
      ],
      generatedAt
    );
    expect(many.accepted).toHaveLength(3);
    expect(new Set(many.accepted.map((row) => row.sportsbook)).size).toBe(2);
    expect(many.accepted.filter((row) => row.sportsbook === 'draftkings' && row.side === 'over')).toHaveLength(2);
    const overOnly = partitionSportsbookObservations(
      [{ sportsbook: 'draftkings', side: 'over', lineValue: 20.5, observedAt: generatedAt }],
      generatedAt
    );
    expect(overOnly.accepted.map((row) => row.side)).toEqual(['over']);
    const late = partitionSportsbookObservations(
      [{ sportsbook: 'draftkings', side: 'over', lineValue: 20.5, observedAt: '2026-10-20T22:00:01.000Z' }],
      generatedAt
    );
    expect(late.accepted).toEqual([]);
    expect(late.rejected).toHaveLength(1);
    const sql = read('db/schemas/MIGRATION_projection_ledger.sql');
    expect(sql).toContain("venue_type = 'sportsbook'");
    expect(sql).not.toMatch(/kalshi|polymarket/i);
    expect(sql).toContain('observed_at > parent_generated');
  });

  it('12, 13. stored mean equals the production serving projection and keeps the 70/30 base', () => {
    const fixture = inputs();
    const track = resolveEvTrack();
    expect(track).toBe('trackB_calibrated');
    const mean = buildLedgerMean(fixture, 'points', track);
    expect(mean).not.toBeNull();
    const served = computePropEvFields(
      {
        prop_type: 'points',
        market_type: 'over_under',
        side: 'over',
        line_value: 19.5,
        odds_american: -110,
        odds_decimal: 1.91,
      },
      fixture,
      track
    );
    expect(mean!.projectionValue).toBe(served.projection);
    expect(mean!.baseProjectionValue).toBe(computeProjection(fixture.last10.pts, fixture.season.pts));
    expect(mean!.projectionValue).not.toBe(mean!.baseProjectionValue);
    const source = read('lib/betting/projection-ledger/compute.ts');
    expect(source).toContain('computeProjection');
    expect(source).toContain('computeTrackB1PlayerPropProbability');
    expect(source).toContain('computePropEvFields');
    expect(source).not.toMatch(/0\.7\s*\*/);
    expect(read('lib/betting/projection-ledger/cycle.ts')).toContain('resolveEvTrack()');
  });

  it('14. the existing five-minute window ending at T-60 is on time', () => {
    expect(LEDGER_SCHEDULER_INTERVAL_MINUTES).toBe(5);
    for (const minutes of [64, 60]) {
      const generatedAt = atMinutesBeforeTip(openingTip, minutes);
      const decision = classifyLedgerCapture({ gameTipTime: openingTip, generatedAt });
      expect(decision.accept).toBe(true);
      if (!decision.accept) continue;
      expect(decision.timingStatus).toBe('ON_TIME');
      expect(
        captureEligibleAtWrite({
          provenanceType: 'PROSPECTIVE_LIVE',
          timingStatus: decision.timingStatus,
          snapshotRevision: 1,
          generatedAt,
          gameTipTime: openingTip,
        })
      ).toBe(true);
    }
    const tooEarly = classifyLedgerCapture({
      gameTipTime: openingTip,
      generatedAt: atMinutesBeforeTip(openingTip, 66),
    });
    expect(tooEarly.accept).toBe(false);
  });

  it('17. a moved current tip drops the capture from the authoritative view', () => {
    const generatedAt = atMinutesBeforeTip(openingTip, 60);
    const base = {
      provenanceType: 'PROSPECTIVE_LIVE',
      timingStatus: 'ON_TIME',
      snapshotRevision: 1,
      generatedAt,
      storedGameTipTime: openingTip,
      currentGameStartTime: openingTip,
      captureEligibleAtWrite: true,
    };
    expect(passesAuthoritativeEvaluation(base)).toBe(true);
    expect(
      passesAuthoritativeEvaluation({
        ...base,
        currentGameStartTime: '2026-10-21T01:00:00.000Z',
      })
    ).toBe(false);
    const sql = read('db/schemas/MIGRATION_projection_ledger.sql');
    expect(sql).toContain('p.game_tip_time = g.start_time');
    expect(sql).toContain('p.generated_at < g.start_time');
    expect(sql).toContain('capture_eligible_at_write');
  });

  it('18-21. resolution keeps DNP, zero-stat appearances, and unresolved games out of primary accuracy', () => {
    const dnp = classifyLedgerResolution({
      statusRaw: 'Final',
      gameLogCount: 10,
      playerLog: { game_id: 'g', player_id: 'p', start_time: openingTip, season: '2026', minutes: '00', points: 0, rebounds: 0, assists: 0, three_pointers_made: 0 },
    });
    expect(dnp).toBe('DNP_VOID');
    expect(includedInPrimaryAccuracy(dnp)).toBe(false);
    const zeroMinutes = classifyLedgerResolution({
      statusRaw: 'Final',
      gameLogCount: 10,
      playerLog: { game_id: 'g', player_id: 'p', start_time: openingTip, season: '2026', minutes: '0', points: 0, rebounds: 0, assists: 0, three_pointers_made: 0 },
    });
    expect(zeroMinutes).toBe('PLAYED');
    const zeroPoints = classifyLedgerResolution({
      statusRaw: 'Final',
      gameLogCount: 10,
      playerLog: { game_id: 'g', player_id: 'p', start_time: openingTip, season: '2026', minutes: '28', points: 0, rebounds: 4, assists: 2, three_pointers_made: 0 },
    });
    expect(zeroPoints).toBe('PLAYED');
    expect(includedInPrimaryAccuracy(zeroPoints)).toBe(true);
    expect(classifyLedgerResolution({ statusRaw: 'Postponed', gameLogCount: 0, playerLog: null })).toBe('POSTPONED');
    expect(classifyLedgerResolution({ statusRaw: 'Canceled', gameLogCount: 0, playerLog: null })).toBe('CANCELED');
    expect(classifyLedgerResolution({ statusRaw: '2026-10-20T23:00:00Z', gameLogCount: 0, playerLog: null })).toBe('UNRESOLVED');
    expect(classifyLedgerResolution({ statusRaw: 'Final', gameLogCount: 0, playerLog: null })).toBe('UNRESOLVED');
    for (const state of ['DNP_VOID', 'POSTPONED', 'CANCELED', 'UNRESOLVED'] as const) {
      expect(includedInPrimaryAccuracy(state)).toBe(false);
    }
  });

  it('22, 23. unsupported markets and null inputs produce no prediction', () => {
    const onTime = classifyLedgerCapture({
      gameTipTime: openingTip,
      generatedAt: atMinutesBeforeTip(openingTip, 62),
    });
    expect(
      decideLedgerWrite({
        codeRevision: productionSha,
        gameEligible: true,
        timing: onTime,
        inputsPresent: true,
        market: 'steals',
      })
    ).toBe('skipped_unsupported_market');
    expect(
      decideLedgerWrite({
        codeRevision: productionSha,
        gameEligible: true,
        timing: onTime,
        inputsPresent: false,
        market: 'points',
      })
    ).toBe('skipped_no_inputs');
    expect(
      decideLedgerWrite({
        codeRevision: '   ',
        gameEligible: true,
        timing: onTime,
        inputsPresent: true,
        market: 'points',
      })
    ).toBe('skipped_missing_code_revision');
    for (const placeholder of ['abc123', 'HEAD', 'unknown', 'test:local', productionSha.slice(0, 39)]) {
      expect(isProductionGitSha(placeholder)).toBe(false);
      expect(
        decideLedgerWrite({
          codeRevision: placeholder,
          gameEligible: true,
          timing: onTime,
          inputsPresent: true,
          market: 'points',
        })
      ).toBe('skipped_missing_code_revision');
    }
  });

  it('24, 25. closing comparison is same book and same side, and a missing close stays null', () => {
    const same = evaluateProjectionRow({
      projectionValue: 22,
      actual: 25,
      resolution: 'PLAYED',
      publishLine: 20.5,
      closeLine: 21.5,
      side: 'over',
      publishSportsbook: 'draftkings',
      closeSportsbook: 'draftkings',
    });
    expect(same.clvLineDelta).toBe(-1);
    expect(same.lineMovement).toBe(1);
    expect(same.sideResult).toBe('beat');
    expect(same.officialMarketComparison).toBe(false);
    const otherBook = evaluateProjectionRow({
      ...{
        projectionValue: 22,
        actual: 25,
        resolution: 'PLAYED',
        publishLine: 20.5,
        closeLine: 21.5,
        side: 'over' as const,
        publishSportsbook: 'draftkings',
        closeSportsbook: 'fanduel',
      },
    });
    expect(otherBook.clvLineDelta).toBeNull();
    expect(otherBook.lineMovement).toBeNull();
    const missing = evaluateProjectionRow({
      projectionValue: 22,
      actual: 25,
      resolution: 'PLAYED',
      publishLine: 20.5,
      closeLine: null,
      side: 'over',
      publishSportsbook: 'draftkings',
      closeSportsbook: null,
    });
    expect(missing.clvLineDelta).toBeNull();
    expect(missing.lineMovement).toBeNull();
    expect(missing.absoluteError).toBe(3);
  });

  it('26, 27. October 20 regular-season tips qualify and preseason does not', () => {
    expect(REGULAR_SEASON_OPEN_ET['2026']).toBe('2026-10-20');
    const opening = {
      gameId: '21717855',
      season: '2026',
      startTime: '2026-10-20T19:00:00.000Z',
      status: '2026-10-20T19:00:00Z',
      homeTeamId: '1',
      awayTeamId: '2',
    };
    expect(gameEligibleForLedgerPublish(opening)).toBe(true);
    expect(
      gameEligibleForLedgerPublish({
        ...opening,
        startTime: '2026-10-19T23:00:00.000Z',
        status: '2026-10-19T23:00:00Z',
      })
    ).toBe(false);
  });

  it('28. production TypeScript has no update or delete of a stored prediction', () => {
    const files = [
      'lib/betting/projection-ledger/cycle.ts',
      'lib/betting/projection-ledger/compute.ts',
      'lib/betting/projection-ledger/idempotency.ts',
      'lambda/projection-ledger/index.ts',
    ];
    for (const file of files) {
      const src = read(file);
      expect(src, file).not.toMatch(/\bUPDATE\s+analytics\.projection/i);
      expect(src, file).not.toMatch(/\bDELETE\s+FROM\s+analytics\.projection/i);
    }
    const sql = read('db/schemas/MIGRATION_projection_ledger.sql');
    expect(sql).toContain('projection ledger % is append-only');
    expect(sql).toContain('projection_ledger_admin_delete');
  });

  it('30. game season and input season are stored as separate fields', () => {
    const mean = buildLedgerMean(inputs({ seasonKey: '2025' }), 'points', 'trackB_calibrated');
    const game = gameEligibleForLedgerPublish({
      gameId: '21717855',
      season: '2026',
      startTime: '2026-10-20T19:00:00.000Z',
      status: '2026-10-20T19:00:00Z',
      homeTeamId: '1',
      awayTeamId: '2',
    });
    expect(game).toBe(true);
    expect(mean?.inputSeasonKey).toBe('2025');
    expect(getAnalyticsSeason({} as NodeJS.ProcessEnv)).toBe(PINNED_ANALYTICS_SEASON);
    expect(PINNED_ANALYTICS_SEASON).toBe('2025');
    const cycle = read('lib/betting/projection-ledger/cycle.ts');
    expect(cycle).toContain('input_season_key');
    expect(cycle).toContain('game.season');
    expect(cycle).toContain('mean.inputSeasonKey');
    const sql = read('db/schemas/MIGRATION_projection_ledger.sql');
    expect(sql).toContain('latest_input_game_start_time');
    expect(sql).not.toContain('input_source_updated_at_max');
    expect(sql).not.toContain('data_as_of');
    expect(sql).not.toContain('p.season = p.input_season_key');
    const generatedAt = atMinutesBeforeTip(openingTip, 60);
    expect(
      crossSeasonProspectiveRemainsEligible({
        gameSeason: '2026',
        inputSeasonKey: '2025',
        provenanceType: 'PROSPECTIVE_LIVE',
        timingStatus: 'ON_TIME',
        snapshotRevision: 1,
        generatedAt,
        storedGameTipTime: openingTip,
        currentGameStartTime: openingTip,
        captureEligibleAtWrite: true,
      })
    ).toBe(true);
  });

  it('deploys the schedule disabled and refuses writes unless the flag is exactly 1', () => {
    const tf = read('infra/projection-ledger.tf');
    expect(tf).toMatch(/state\s*=\s*"DISABLED"/);
    expect(tf).not.toMatch(/state\s*=\s*"ENABLED"/);
    expect(tf).toContain('PROJECTION_LEDGER_WRITES  = "0"');
    expect(tf).toContain('PROJECTION_LEDGER_GIT_SHA = var.projection_ledger_git_sha');
    expect(tf).toContain('dist/index.handler');
    expect(read('lib/betting/projection-ledger/fingerprint.ts')).not.toContain('process.env');
    expect(read('lib/betting/projection-ledger/cycle.ts')).toContain('projectionConfigFingerprint()');
    const closing = read('lib/prune/closing-lines.ts');
    expect(closing).toContain("g.status = 'Final'");
    expect(closing).toContain('r.fetched_at < g.start_time');
    const view = read('db/schemas/MIGRATION_projection_ledger.sql');
    expect(view).toContain('d.sportsbook = m.sportsbook');
    expect(view).toContain('d.side = m.side');
    expect(view).toContain('d.decision_at < g.start_time');
    expect(tf).toContain('rate(5 minutes)');
    expect(tf).toMatch(/variable "projection_ledger_create"[\s\S]*default\s*=\s*false/);
    const handler = read('lambda/projection-ledger/index.ts');
    expect(handler).toContain("!== '1'");
    expect(handler).toContain('writes_disabled');
  });
});
