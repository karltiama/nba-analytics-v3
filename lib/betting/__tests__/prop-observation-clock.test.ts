import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// compute.ts transitively loads the db module, which requires the variable at import. Nothing connects.
vi.hoisted(() => {
  process.env.SUPABASE_DB_URL ??= 'postgres://nobody@127.0.0.1:1/none';
});
import {
  PROP_CLOCK_LEGACY_CONTROLLER_TIME,
  PROP_CLOCK_RESPONSE_RECEIVED,
  actualTMinusMinutes,
  classifyPropObservation,
  intendedTMinusMinutes,
  isPreTipObservation,
  marketObservedAtIso,
} from '@/lib/betting/prop-observation-clock';
import {
  MATERIALIZE_CLOSING_LINES_OBSERVED_SQL,
  MATERIALIZE_CLOSING_LINES_SQL,
  decisionInstant,
  resolveClosingLinesSqlMode,
  selectLatestPreTipObservations,
  type PreTipObservation,
} from '@/lib/prune/closing-lines';
import { partitionSportsbookObservations } from '@/lib/betting/projection-ledger/compute';
import {
  buildArchiveEnvelope,
  filterPregameRowsForEnvelope,
  rowsFromNormalized,
} from '@/lib/archive/player-prop-snapshot-archive';
import type { SqlQueryable } from '@/lib/db/schema-capability';

const TIP = new Date('2026-10-21T23:30:00.000Z');
const at = (minutesBeforeTip: number) => new Date(TIP.getTime() - minutesBeforeTip * 60_000);

function obs(partial: Partial<PreTipObservation>): PreTipObservation {
  return {
    gameId: '1',
    playerId: '77',
    sportsbook: 'draftkings',
    propType: 'points',
    side: 'over',
    lineValue: 27.5,
    oddsAmerican: -110,
    fetchedAt: at(180),
    pullRunId: 1,
    observedAt: at(178),
    observationClock: PROP_CLOCK_RESPONSE_RECEIVED,
    ...partial,
  };
}

function classify(controller: Date | null, observed: Date | null, provider: Date | null = null) {
  return classifyPropObservation(
    {
      controllerEnqueuedAt: controller,
      observedAt: observed,
      providerUpdatedAt: provider,
      observationClock: PROP_CLOCK_RESPONSE_RECEIVED,
    },
    TIP
  );
}

describe('LIVE-CLOCK-P0A clock contract', () => {
  it('queued T-180, observed T-178 → actual T-178 (intended stays T-180)', () => {
    const c = classify(at(180), at(178));
    expect(c.actualTMinusMinutes).toBe(178);
    expect(c.intendedTMinusMinutes).toBe(180);
    expect(c.preTip).toBe(true);
    expect(c.clock).toBe(PROP_CLOCK_RESPONSE_RECEIVED);
  });

  it('queued T-60, observed T-48 → T-48 evidence', () => {
    const c = classify(at(60), at(48));
    expect(c.actualTMinusMinutes).toBe(48);
    expect(c.intendedTMinusMinutes).toBe(60);
    expect(c.preTip).toBe(true);
  });

  it('queued T-10, observed T+2 → not pre-tip', () => {
    const c = classify(at(10), at(-2));
    expect(c.preTip).toBe(false);
    expect(c.actualTMinusMinutes).toBe(-2);
    expect(c.intendedTMinusMinutes).toBe(10);
  });

  it('retry: pre-tip enqueue/attempt, successful response post-tip → not pre-tip', () => {
    // Controller and first attempt were pre-tip; only the successful response counts.
    expect(classify(at(5), at(-1)).preTip).toBe(false);
  });

  it('observed_at == tip → not pre-tip', () => {
    expect(isPreTipObservation(TIP, TIP)).toBe(false);
    expect(isPreTipObservation(new Date(TIP.getTime() - 1), TIP)).toBe(true);
  });

  it('missing observed_at fails closed', () => {
    expect(isPreTipObservation(null, TIP)).toBe(false);
    expect(isPreTipObservation('not-a-date', TIP)).toBe(false);
    const c = classify(at(180), null);
    expect(c.preTip).toBe(false);
    expect(c.actualTMinusMinutes).toBeNull();
    expect(actualTMinusMinutes(undefined, TIP)).toBeNull();
    expect(intendedTMinusMinutes(null, TIP)).toBeNull();
  });

  it('controller time never overrides observed_at', () => {
    expect(classify(at(30), at(-3)).preTip).toBe(false);
  });

  it('provider_updated_at does not replace observed_at', () => {
    const c = classify(at(30), at(-3), at(120));
    expect(c.preTip).toBe(false);
    expect(c.actualTMinusMinutes).toBe(-3);
    expect(classify(null, null, at(120)).preTip).toBe(false);
  });

  it('rows without a declared clock are LEGACY_CONTROLLER_TIME and never claim true observation', () => {
    const c = classifyPropObservation(
      { controllerEnqueuedAt: at(60), observedAt: at(59), providerUpdatedAt: null, observationClock: null },
      TIP
    );
    expect(c.clock).toBe(PROP_CLOCK_LEGACY_CONTROLLER_TIME);
    expect(c.preTip).toBe(false);
    expect(c.actualTMinusMinutes).toBeNull();
  });
});

describe('LIVE-CLOCK-P0A decision close', () => {
  it('chooses the latest pre-tip observation', () => {
    const picked = selectLatestPreTipObservations(
      [
        obs({ pullRunId: 1, fetchedAt: at(180), observedAt: at(178), lineValue: 26.5 }),
        obs({ pullRunId: 2, fetchedAt: at(60), observedAt: at(48), lineValue: 27.5 }),
        obs({ pullRunId: 3, fetchedAt: at(10), observedAt: at(9), lineValue: 28.5 }),
      ],
      TIP
    );
    expect(picked).toHaveLength(1);
    expect(picked[0].lineValue).toBe(28.5);
  });

  it('ignores post-tip observations and post-tip retry successes', () => {
    const picked = selectLatestPreTipObservations(
      [
        obs({ pullRunId: 1, fetchedAt: at(60), observedAt: at(48), lineValue: 27.5 }),
        obs({ pullRunId: 2, fetchedAt: at(10), observedAt: at(-2), lineValue: 30.5 }),
        obs({ pullRunId: 3, fetchedAt: TIP, observedAt: TIP, lineValue: 31.5 }),
      ],
      TIP
    );
    expect(picked.map((r) => r.lineValue)).toEqual([27.5]);
  });

  it('orders by observed_at, not controller time', () => {
    // Pull 1 was enqueued later but its response arrived earlier.
    const picked = selectLatestPreTipObservations(
      [
        obs({ pullRunId: 1, fetchedAt: at(20), observedAt: at(19), lineValue: 1 }),
        obs({ pullRunId: 2, fetchedAt: at(30), observedAt: at(12), lineValue: 2 }),
      ],
      TIP
    );
    expect(picked[0].lineValue).toBe(2);
  });

  it('missing observed_at on a RESPONSE_RECEIVED row is never eligible', () => {
    expect(decisionInstant(obs({ observedAt: null }))).toBeNull();
    expect(selectLatestPreTipObservations([obs({ observedAt: null, fetchedAt: at(100) })], TIP)).toEqual([]);
  });

  it('unknown clock label fails closed', () => {
    expect(decisionInstant(obs({ observationClock: 'PROVIDER_UPDATED_AT' }))).toBeNull();
  });

  it('legacy rows keep controller-time semantics and are labelled LEGACY_CONTROLLER_TIME', () => {
    const legacy = obs({ observationClock: null, observedAt: null, fetchedAt: at(15) });
    expect(decisionInstant(legacy)).toEqual({ at: at(15), clock: PROP_CLOCK_LEGACY_CONTROLLER_TIME });
    expect(selectLatestPreTipObservations([legacy], TIP)).toHaveLength(1);
  });

  it('observed SQL decides with observed_at for RESPONSE_RECEIVED rows; legacy SQL is unchanged', () => {
    const sql = MATERIALIZE_CLOSING_LINES_OBSERVED_SQL;
    expect(sql).toContain("WHEN r.observation_clock = 'RESPONSE_RECEIVED' THEN r.observed_at");
    expect(sql).toContain('WHEN r.observation_clock IS NULL THEN r.fetched_at');
    expect(sql).toContain('d.decision_at IS NOT NULL');
    expect(sql).toContain('d.decision_at < g.start_time');
    expect(sql).toContain('d.decision_at DESC');
    expect(sql).toContain('decision_clock');
    expect(sql).not.toContain('r.fetched_at < g.start_time');
    expect(sql).not.toMatch(/provider_updated_at|controller_enqueued_at|created_at/);
    expect(MATERIALIZE_CLOSING_LINES_SQL).toContain('r.fetched_at < g.start_time');
  });

  it('resolves SQL mode from schema capability and fails closed on partial migration', async () => {
    const client = (cols: string[]): SqlQueryable => ({
      query: async (_text, values) => ({
        rows: cols.includes(`${values?.[0]}.${values?.[1]}.${values?.[2]}`) ? [{ ok: 1 }] : [],
      }),
    });
    expect(await resolveClosingLinesSqlMode(client([]))).toBe('legacy');
    expect(
      await resolveClosingLinesSqlMode(
        client([
          'raw.player_prop_snapshots_v2.observation_clock',
          'raw.player_prop_snapshots_v2.observed_at',
          'research.prop_decision_lines.decision_clock',
        ])
      )
    ).toBe('observed');
    await expect(
      resolveClosingLinesSqlMode(
        client(['raw.player_prop_snapshots_v2.observation_clock', 'raw.player_prop_snapshots_v2.observed_at'])
      )
    ).rejects.toThrow(/partially applied/);
  });
});

describe('LIVE-CLOCK-P0A ledger leakage', () => {
  const generatedAt = at(60).toISOString();

  it('uses observed_at, never snapshot_at (controller time)', () => {
    expect(
      marketObservedAtIso({ observed_at: at(61), observation_clock: PROP_CLOCK_RESPONSE_RECEIVED })
    ).toBe(at(61).toISOString());
    const rows = [
      { side: 'over', snapshot_at: at(90), observedAt: marketObservedAtIso({ observed_at: at(59), observation_clock: 'RESPONSE_RECEIVED' }) },
      { side: 'under', snapshot_at: at(90), observedAt: marketObservedAtIso({ observed_at: at(61), observation_clock: 'RESPONSE_RECEIVED' }) },
    ];
    const parts = partitionSportsbookObservations(rows, generatedAt);
    expect(parts.accepted.map((r) => r.side)).toEqual(['under']);
    expect(parts.rejected.map((r) => r.side)).toEqual(['over']);
  });

  it('missing observed_at, legacy rows and pre-migration schema all fail closed', () => {
    const missing = marketObservedAtIso({ observed_at: null, observation_clock: PROP_CLOCK_RESPONSE_RECEIVED });
    const legacy = marketObservedAtIso({ observed_at: at(90), observation_clock: null });
    expect(missing).toBe('');
    expect(legacy).toBe('');
    const parts = partitionSportsbookObservations(
      [
        { side: 'over', observedAt: missing },
        { side: 'under', observedAt: legacy },
      ],
      generatedAt
    );
    expect(parts.accepted).toEqual([]);
    expect(parts.rejected).toHaveLength(2);
  });
});

describe('LIVE-CLOCK-P0A archive envelope', () => {
  const normalized = [
    {
      game_id: 12345,
      player_id: 77,
      player_name: 'P',
      team_id: 14,
      sportsbook: 'draftkings',
      prop_type: 'points',
      market_type: 'over_under',
      side: 'over',
      line_value: 27.5,
      odds_american: -110,
      odds_decimal: 1.91,
      implied_probability: 0.524,
      raw_json: { id: 1 },
      provider_updated_at: at(120),
    },
  ];
  const base = (snapshotAt: Date) => ({
    season: 2026,
    pullRunId: 9,
    gameId: '1',
    sourceGameId: 12345,
    gameDate: '2026-10-21',
    snapshotAt,
    gameStartTime: TIP,
    rows: rowsFromNormalized({
      normalized,
      analyticsGameId: '1',
      pullRunId: 9,
      snapshotAt,
      gameStartTime: TIP,
    }),
  });

  it('timing and research rows follow observed_at; checksum ignores clocks so retries stay idempotent', () => {
    const legacy = buildArchiveEnvelope(base(at(10)));
    const observed = buildArchiveEnvelope({
      ...base(at(10)),
      observation: { observedAt: at(-2), controllerEnqueuedAt: at(10) },
    });
    expect(legacy.timing).toBe('pregame');
    expect(observed.timing).toBe('post_tip');
    expect(observed.observed_at).toBe(at(-2).toISOString());
    expect(observed.controller_enqueued_at).toBe(at(10).toISOString());
    expect(observed.observation_clock).toBe('RESPONSE_RECEIVED');
    expect(observed.checksum).toBe(legacy.checksum);
    expect(filterPregameRowsForEnvelope(observed)).toEqual([]);
    expect(filterPregameRowsForEnvelope(legacy)).toHaveLength(1);
    const pre = buildArchiveEnvelope({
      ...base(at(60)),
      observation: { observedAt: at(48), controllerEnqueuedAt: at(60) },
    });
    expect(filterPregameRowsForEnvelope(pre)).toHaveLength(1);
  });

  it('declared observation clock without observed_at fails closed', () => {
    const env = { ...buildArchiveEnvelope(base(at(60))), observation_clock: 'RESPONSE_RECEIVED' as const };
    expect(filterPregameRowsForEnvelope(env)).toEqual([]);
  });
});

describe('LIVE-CLOCK-P0A prepared migration', () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, '../../../db/schemas/MIGRATION_player_prop_observation_clock.sql'),
    'utf8'
  );

  it('is additive and does not rewrite history', () => {
    expect(sql).toContain('PREPARED, NOT APPLIED');
    expect(sql).not.toMatch(/\bupdate\s+(raw|analytics|research)\./i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/\bdrop\s+(table|column)\b/i);
    expect(sql).not.toMatch(/alter\s+column/i);
    for (const line of [
      'add column if not exists observed_at timestamptz',
      'add column if not exists controller_enqueued_at timestamptz',
      'add column if not exists provider_updated_at timestamptz',
      'add column if not exists observation_clock text',
    ]) {
      expect(sql.split(line).length - 1).toBe(2);
    }
    expect(sql).toContain('add column if not exists decision_clock text');
  });

  it('view live fallback uses the same observed_at eligibility', () => {
    expect(sql).toContain("when r.observation_clock = 'RESPONSE_RECEIVED' then r.observed_at");
    expect(sql).toContain('d.decision_at < g.start_time');
    expect(sql).toContain("coalesce(decision_clock, 'LEGACY_CONTROLLER_TIME')");
    expect(sql).not.toContain('r.fetched_at < g.start_time');
  });
});
