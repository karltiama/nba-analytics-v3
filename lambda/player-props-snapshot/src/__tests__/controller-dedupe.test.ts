import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ENQUEUE_FAILED, selectUnclaimedTargets } from '../../src/bulk-writers';

type GameRun = {
  pull_run_id: number;
  game_id: string;
  universe: string;
  status: string;
  error_message: string | null;
  started_at: number;
};

const mocks = vi.hoisted(() => {
  process.env.PLAYER_PROPS_QUEUE_URL = 'https://sqs.invalid/000000000000/nba-player-props-game-queue';
  return {
    pool: null as unknown,
    targets: [] as Array<{ gameId: string; bdlGameId: number }>,
    send: null as unknown as (cmd: { input: { Entries: Array<{ Id: string; MessageBody: string }> } }) => Promise<unknown>,
  };
});

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: class {
    send(cmd: { input: { Entries: Array<{ Id: string; MessageBody: string }> } }) {
      return mocks.send(cmd);
    }
  },
  SendMessageBatchCommand: class {
    constructor(public input: unknown) {}
  },
}));
vi.mock('../../src/db', () => ({ getDbPool: () => mocks.pool }));
vi.mock('../../src/metrics', () => ({ emitCoverageMetric: () => {} }));
vi.mock('../../src/game-discovery', async (importActual) => ({
  ...(await importActual<typeof import('../../src/game-discovery')>()),
  getGameTargets: async () => mocks.targets,
}));

/** In-memory raw.player_prop_game_runs honoring the claim predicate. */
function fakePool() {
  const runs: GameRun[] = [];
  let nextPullRunId = 100;
  let nowSec = 0;
  const query = async (sql: string, values: unknown[] = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim()) || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.includes('SELECT DISTINCT game_id')) {
      const [universe, ids, windowSec, marker] = values as [string, string[], number, string];
      const rows = runs
        .filter(
          (r) =>
            r.universe === universe &&
            ids.includes(r.game_id) &&
            r.started_at > nowSec - windowSec &&
            !(r.status === 'error' && r.error_message === marker)
        )
        .map((r) => ({ game_id: r.game_id }));
      return { rows };
    }
    if (sql.includes('INSERT INTO raw.player_prop_pull_runs')) return { rows: [{ pull_run_id: nextPullRunId++ }] };
    if (sql.includes('INSERT INTO raw.player_prop_game_runs')) {
      const [pullRunId, gameId, universe] = values as [number, string, string];
      runs.push({ pull_run_id: pullRunId, game_id: gameId, universe, status: 'started', error_message: null, started_at: nowSec });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('UPDATE raw.player_prop_game_runs') && sql.includes("status = 'error'")) {
      const [pullRunId, ids, marker] = values as [number, string[], string];
      for (const r of runs) {
        if (r.pull_run_id === pullRunId && ids.includes(r.game_id) && r.status === 'started') {
          r.status = 'error';
          r.error_message = marker;
        }
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('UPDATE raw.player_prop_pull_runs')) return { rows: [], rowCount: 1 };
    throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
  };
  const pool = { query, connect: async () => ({ query, release: () => {} }) };
  return { pool, runs, advance: (sec: number) => (nowSec += sec) };
}

function queuedGameIds(sent: Array<{ input: { Entries: Array<{ MessageBody: string }> } }>) {
  return sent.flatMap((c) => c.input.Entries.map((e) => JSON.parse(e.MessageBody).gameId as string));
}

describe('selectUnclaimedTargets', () => {
  it('skips recently claimed games and repeated ids within one wave', () => {
    const t = [{ gameId: 'a' }, { gameId: 'b' }, { gameId: 'a' }, { gameId: 'c' }];
    const { claim, skipped } = selectUnclaimedTargets(t, new Set(['b']));
    expect(claim.map((x) => x.gameId)).toEqual(['a', 'c']);
    expect(skipped.map((x) => x.gameId)).toEqual(['b', 'a']);
  });
});

describe('player-props controller idempotency (mocked SQS + DB, no network)', () => {
  let db: ReturnType<typeof fakePool>;
  let sent: Array<{ input: { Entries: Array<{ Id: string; MessageBody: string }> } }>;

  beforeEach(() => {
    vi.stubEnv('DATA_MODE', 'live_api');
    vi.stubEnv('OFFSEASON_MODE', '0');
    vi.stubEnv('CRON_DRY_RUN', '0');
    vi.stubEnv('SUPABASE_DB_URL', 'postgres://nobody@127.0.0.1:1/none');
    vi.stubEnv('BALLDONTLIE_API_KEY', 'test-key');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    db = fakePool();
    mocks.pool = db.pool;
    mocks.targets = [{ gameId: '101', bdlGameId: 101 }];
    sent = [];
    mocks.send = async (cmd) => {
      sent.push(cmd);
      return { Successful: cmd.input.Entries.map((e) => ({ Id: e.Id })), Failed: [] };
    };
  });

  it('a duplicate controller wave inside the window enqueues nothing', async () => {
    const { handler } = await import('../../controller');
    const first = JSON.parse((await handler({ universe: 'near_tip' })).body);
    expect(first.queuedGames).toBe(1);

    db.advance(60);
    const second = JSON.parse((await handler({ universe: 'near_tip' })).body);
    expect(second).toMatchObject({ skipped: true, reason: 'already_claimed', queuedGames: 0, skippedGames: 1 });
    expect(queuedGameIds(sent)).toEqual(['101']);
    expect(db.runs).toHaveLength(1);
  });

  it('the next scheduled wave (outside the window) enqueues again; other universe is independent', async () => {
    const { handler } = await import('../../controller');
    await handler({ universe: 'near_tip' });
    const broad = JSON.parse((await handler({ universe: 'broad' })).body);
    expect(broad.queuedGames).toBe(1);
    db.advance(15 * 60);
    const next = JSON.parse((await handler({ universe: 'near_tip' })).body);
    expect(next.queuedGames).toBe(1);
    expect(queuedGameIds(sent)).toHaveLength(3);
  });

  it('partial SQS failure marks only failed games re-claimable; the async retry enqueues just those', async () => {
    mocks.send = async (cmd) => {
      sent.push(cmd);
      const failed = cmd.input.Entries.filter((e) => JSON.parse(e.MessageBody).gameId === '101');
      return {
        Successful: cmd.input.Entries.filter((e) => !failed.includes(e)).map((e) => ({ Id: e.Id })),
        Failed: failed.map((e) => ({ Id: e.Id, Code: 'InternalError', SenderFault: false })),
      };
    };
    const { handler } = await import('../../controller');
    await expect(handler({ universe: 'near_tip' })).rejects.toThrow(/SQS enqueue failed for 1 game\(s\): 101/);
    expect(db.runs.find((r) => r.game_id === '101')).toMatchObject({ status: 'error', error_message: ENQUEUE_FAILED });

    mocks.send = async (cmd) => {
      sent.push(cmd);
      return { Successful: cmd.input.Entries.map((e) => ({ Id: e.Id })), Failed: [] };
    };
    db.advance(60);
    const retry = JSON.parse((await handler({ universe: 'near_tip' })).body);
    expect(retry).toMatchObject({ queuedGames: 1, dedupedGames: 0 });
    expect(queuedGameIds(sent)).toEqual(['101', '101']);
  });

  it('a thrown SendMessageBatch marks the whole batch re-claimable', async () => {
    mocks.send = async () => {
      throw new Error('network down');
    };
    const { handler } = await import('../../controller');
    await expect(handler({ universe: 'broad' })).rejects.toThrow(/SQS enqueue failed for 1/);
    expect(db.runs.every((r) => r.error_message === ENQUEUE_FAILED)).toBe(true);
  });

  it('refuses a slate larger than one game and does not claim or enqueue', async () => {
    mocks.targets = [
      { gameId: '101', bdlGameId: 101 },
      { gameId: '102', bdlGameId: 102 },
      { gameId: '103', bdlGameId: 103 },
    ];
    const { handler } = await import('../../controller');
    const result = JSON.parse((await handler({ universe: 'broad' })).body);
    expect(result).toMatchObject({ skipped: true, reason: 'wave_cap', queuedGames: 0, eligibleGames: 3 });
    expect(sent).toHaveLength(0);
    expect(db.runs).toHaveLength(0);
  });

  it('enqueues only the explicit eligible gameId', async () => {
    mocks.targets = [
      { gameId: '101', bdlGameId: 101 },
      { gameId: '102', bdlGameId: 102 },
    ];
    const { handler } = await import('../../controller');
    const result = JSON.parse((await handler({ universe: 'near_tip', gameId: '102' })).body);
    expect(result.queuedGames).toBe(1);
    expect(queuedGameIds(sent)).toEqual(['102']);
    expect(db.runs.map((r) => r.game_id)).toEqual(['102']);
    const body = JSON.parse(sent[0].input.Entries[0].MessageBody);
    expect(body).toMatchObject({ gameId: '102', bdlGameId: 102, universe: 'near_tip' });
  });

  it('rejects a past or unknown game id and a non-canonical id without claiming', async () => {
    mocks.targets = [{ gameId: '101', bdlGameId: 101 }];
    const { handler } = await import('../../controller');
    const missing = JSON.parse((await handler({ universe: 'near_tip', gameId: '999' })).body);
    expect(missing).toMatchObject({ skipped: true, reason: 'game_not_eligible', queuedGames: 0 });
    const bad = JSON.parse((await handler({ universe: 'near_tip', gameId: '01' })).body);
    expect(bad).toMatchObject({ skipped: true, reason: 'invalid_game_id', queuedGames: 0 });
    const numeric = JSON.parse((await handler({ universe: 'near_tip', gameId: 101 })).body);
    expect(numeric).toMatchObject({ skipped: true, reason: 'invalid_game_id', queuedGames: 0 });
    expect(sent).toHaveLength(0);
    expect(db.runs).toHaveLength(0);
  });

  it('a frozen controller does not enqueue', async () => {
    vi.stubEnv('DATA_MODE', 'replay');
    vi.stubEnv('OFFSEASON_MODE', '1');
    vi.stubEnv('CRON_DRY_RUN', '1');
    const { handler } = await import('../../controller');
    const result = JSON.parse((await handler({ universe: 'near_tip', gameId: '101' })).body);
    expect(result).toMatchObject({ skipped: true, reason: 'runtime_skip', queuedGames: 0 });
    expect(sent).toHaveLength(0);
  });
});
