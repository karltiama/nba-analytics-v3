import { describe, expect, it, vi } from 'vitest';
import { buildPlayerIdentityIndex } from '@/lib/identity/player-identity-resolve';
import { entityIdForBdlPlayer } from '@/lib/roster/player-entity-backfill';
import { WILSON_BDL_ID } from '@/lib/roster/identity-integrity';
import { classifyGameReadiness } from '../readiness';
import { claimQueuedStage, type StageRecord, type StageStore } from '../claim';
import {
  handlePostgameMessage,
  POSTGAME_TARGET_SEASON,
  type PostgameWorkerConfig,
  type PostgameWorkerPorts,
} from '../worker';
import { postgameWorkerConfigFromEnv } from '../config';
import { buildPostgameQueueMessage } from '../types';
import type { PlayerGameLogWrite } from '../box-transform';
import type { GameStarterCandidate } from '@/lib/archive/game-starters-from-lineups';

vi.stubGlobal('fetch', () => {
  throw new Error('network forbidden in 13F.3 tests');
});

const now = new Date('2026-10-22T03:00:00.000Z');
const GAME = '18450001';
const HOME = '1';
const AWAY = '2';
const NOT_SERVING_BDL = '999001';

function servingIndex(playerIds: string[]) {
  const bridges = playerIds.map((id) => ({
    playerEntityId: entityIdForBdlPlayer(id),
    provider: 'balldontlie' as const,
    providerPlayerId: id,
  }));
  const projections = playerIds.map((id) => ({
    playerEntityId: entityIdForBdlPlayer(id),
    analyticsPlayerId: id,
  }));
  return buildPlayerIdentityIndex({ bridges, projections });
}

function mixedServingIndex() {
  const wilson = entityIdForBdlPlayer(WILSON_BDL_ID);
  const pending = entityIdForBdlPlayer(NOT_SERVING_BDL);
  return buildPlayerIdentityIndex({
    bridges: [
      { playerEntityId: wilson, provider: 'balldontlie', providerPlayerId: WILSON_BDL_ID },
      { playerEntityId: pending, provider: 'balldontlie', providerPlayerId: NOT_SERVING_BDL },
    ],
    projections: [{ playerEntityId: wilson, analyticsPlayerId: WILSON_BDL_ID }],
  });
}

function conflictIndex(otherIds: string[]) {
  return buildPlayerIdentityIndex({
    bridges: [
      { playerEntityId: 'e-a', provider: 'balldontlie', providerPlayerId: '111' },
      { playerEntityId: 'e-b', provider: 'balldontlie', providerPlayerId: '111' },
      ...otherIds.map((id) => ({
        playerEntityId: entityIdForBdlPlayer(id),
        provider: 'balldontlie' as const,
        providerPlayerId: id,
      })),
    ],
    projections: otherIds.map((id) => ({
      playerEntityId: entityIdForBdlPlayer(id),
      analyticsPlayerId: id,
    })),
  });
}

class MemoryStore implements StageStore {
  rows = new Map<string, StageRecord>();
  key(gameId: string, stage: string) {
    return `${gameId}|${stage}`;
  }
  get(gameId: string, stage: StageRecord['stage']) {
    return this.rows.get(this.key(gameId, stage));
  }
  save(record: StageRecord) {
    this.rows.set(this.key(record.gameId, record.stage), { ...record });
  }
}

function queued(stage: 'box' | 'starters', gameId = GAME): StageRecord {
  return {
    gameId,
    season: '2026',
    stage,
    status: 'QUEUED',
    attempts: 0,
    reasonCode: null,
    inputCount: null,
    outputCount: null,
    identitySkipped: null,
    providerHttp: null,
    startedAt: null,
    finishedAt: null,
    lastAttemptAt: null,
    nextAttemptAt: null,
    updatedAt: now.toISOString(),
  };
}

function stat(playerId: string, teamId: string) {
  return {
    player: { id: Number(playerId) },
    team: { id: Number(teamId) },
    min: '24',
    pts: 10,
    reb: 4,
    ast: 3,
    oreb: 1,
    dreb: 3,
    stl: 1,
    blk: 0,
    turnover: 2,
    pf: 2,
    fgm: 4,
    fga: 9,
    fg3m: 1,
    fg3a: 3,
    ftm: 1,
    fta: 1,
    plus_minus: 5,
  };
}

function completeBoxPayload() {
  const home = Array.from({ length: 8 }, (_, i) => stat(String(100 + i), HOME));
  const away = Array.from({ length: 8 }, (_, i) => stat(String(200 + i), AWAY));
  return { data: [...home, ...away] };
}

function starterRow(playerId: string, teamId: string, position: string) {
  return {
    starter: true,
    position,
    player: { id: Number(playerId), first_name: 'A', last_name: 'B', team_id: Number(teamId) },
    team: { id: Number(teamId) },
  };
}

function lineup5x5(homeIds: string[], awayIds: string[]) {
  return {
    data: [
      ...homeIds.map((id, i) => starterRow(id, HOME, ['G', 'G', 'F', 'F', 'C'][i]!)),
      ...awayIds.map((id, i) => starterRow(id, AWAY, ['G', 'G', 'F', 'F', 'C'][i]!)),
    ],
  };
}

function liveConfig(over: Partial<PostgameWorkerConfig> = {}): PostgameWorkerConfig {
  return {
    liveIngestionEnabled: true,
    freezeSkipsMutations: false,
    goatSubscriptionActive: true,
    boxRequiresGoat: false,
    targetSeason: POSTGAME_TARGET_SEASON,
    maxAttempts: 8,
    ...over,
  };
}

function freezeConfig(): PostgameWorkerConfig {
  return liveConfig({
    liveIngestionEnabled: false,
    freezeSkipsMutations: true,
    goatSubscriptionActive: false,
  });
}

type PortsHarness = {
  ports: PostgameWorkerPorts;
  pgl: PlayerGameLogWrite[];
  starters: GameStarterCandidate[];
  s3: unknown[];
  boxCalls: { n: number };
  lineupCalls: { n: number };
};

function makePorts(input: {
  store: MemoryStore;
  index?: ReturnType<typeof servingIndex>;
  box?: { httpStatus: number | null; payload: unknown; pages?: number };
  lineups?: { httpStatus: number | null; payload: unknown; pages?: number };
}): PortsHarness {
  const pgl: PlayerGameLogWrite[] = [];
  const starters: GameStarterCandidate[] = [];
  const s3: unknown[] = [];
  const boxCalls = { n: 0 };
  const lineupCalls = { n: 0 };
  const ids = [
    ...Array.from({ length: 8 }, (_, i) => String(100 + i)),
    ...Array.from({ length: 8 }, (_, i) => String(200 + i)),
  ];
  const ports: PostgameWorkerPorts = {
    store: input.store,
    now,
    identityIndex: input.index ?? servingIndex(ids),
    logs: [],
    fetchBoxStats: async () => {
      boxCalls.n += 1;
      return {
        httpStatus: input.box?.httpStatus ?? 200,
        payload: input.box?.payload ?? completeBoxPayload(),
        pages: input.box?.pages ?? 1,
      };
    },
    fetchLineups: async () => {
      lineupCalls.n += 1;
      return {
        httpStatus: input.lineups?.httpStatus ?? 200,
        payload: input.lineups?.payload ?? { data: [] },
        pages: input.lineups?.pages ?? 1,
      };
    },
    loadGame: async (gameId) => ({
      gameId,
      season: '2026',
      status: 'Final',
      homeTeamId: HOME,
      awayTeamId: AWAY,
      homeScore: 110,
      awayScore: 104,
    }),
    writePlayerGameLogs: async (rows) => {
      for (const row of rows) {
        const i = pgl.findIndex((r) => r.gameId === row.gameId && r.playerId === row.playerId);
        if (i >= 0) pgl[i] = row;
        else pgl.push(row);
      }
    },
    writeGameStarters: async (_gameId, _season, rows) => {
      starters.splice(0, starters.length, ...rows);
    },
    archiveLineups: async (_key, payload) => {
      s3.push(payload);
    },
  };
  return { ports, pgl, starters, s3, boxCalls, lineupCalls };
}

function msg(stage: 'box' | 'starters' | 'advanced' | 'plays' | 'game_flow', gameId = GAME) {
  return buildPostgameQueueMessage({
    gameId,
    season: '2026',
    stage,
    attempt: 1,
    enqueuedAt: now.toISOString(),
  });
}

describe('13F.3 postgame box + starters worker', () => {
  it('complete Final box becomes READY and upserts without duplicate PGL rows', async () => {
    const store = new MemoryStore();
    store.save(queued('box'));
    const ctx = makePorts({ store });
    const first = await handlePostgameMessage(msg('box'), ctx.ports, liveConfig());
    expect(first.status).toBe('READY');
    expect(first.writes).toBe(16);
    expect(ctx.pgl).toHaveLength(16);
    store.save(queued('box'));
    await handlePostgameMessage(msg('box'), ctx.ports, liveConfig());
    expect(ctx.pgl).toHaveLength(16);
    expect(ctx.boxCalls.n).toBe(2);
  });

  it('provider not ready is WAITING not READY', async () => {
    const store = new MemoryStore();
    store.save(queued('box'));
    const ctx = makePorts({ store, box: { httpStatus: 200, payload: { data: [] } } });
    const r = await handlePostgameMessage(msg('box'), ctx.ports, liveConfig());
    expect(r.status).toBe('WAITING');
    expect(r.reasonCode).toBe('PROVIDER_NOT_READY');
    expect(r.ack).toBe(true);
    expect(store.get(GAME, 'box')?.nextAttemptAt).toBeTruthy();
    expect(store.get(GAME, 'box')?.attempts).toBe(1);
  });

  it('unexpected zero after retries is not READY', async () => {
    const store = new MemoryStore();
    store.save({ ...queued('box'), attempts: 2 });
    const ctx = makePorts({ store, box: { httpStatus: 200, payload: { data: [] }, pages: 1 } });
    const r = await handlePostgameMessage(msg('box'), ctx.ports, liveConfig());
    expect(r.status).toBe('WAITING');
    expect(r.reasonCode).toBe('VOLUME_UNEXPECTED_ZERO');
    expect(r.status).not.toBe('READY');
  });

  it('mixed serving + non-serving writes valid rows and is not READY', async () => {
    const store = new MemoryStore();
    store.save(queued('box'));
    const payload = {
      data: [stat(WILSON_BDL_ID, HOME), stat(WILSON_BDL_ID, HOME), stat(NOT_SERVING_BDL, AWAY)],
    };
    const ctx = makePorts({ store, index: mixedServingIndex(), box: { httpStatus: 200, payload } });
    const r = await handlePostgameMessage(msg('box'), ctx.ports, liveConfig());
    expect(ctx.pgl.every((row) => row.playerId === WILSON_BDL_ID)).toBe(true);
    expect(ctx.pgl).toHaveLength(1);
    expect(r.status).not.toBe('READY');
    expect(r.reasonCode).toBe('IDENTITY_NOT_SERVING');
    expect(r.writes).toBeGreaterThan(0);
  });

  it('duplicate queue delivery fails the second claim and does not call provider twice', async () => {
    const store = new MemoryStore();
    store.save(queued('box'));
    const ctx = makePorts({ store });
    const first = await handlePostgameMessage(msg('box'), ctx.ports, liveConfig());
    const second = await handlePostgameMessage(msg('box'), ctx.ports, liveConfig());
    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
    expect(second.providerCalled).toBe(false);
    expect(second.ack).toBe(true);
    expect(ctx.boxCalls.n).toBe(1);
    expect(store.get(GAME, 'box')?.attempts).toBe(1);
  });

  it('valid 5+5 starters become READY', async () => {
    const home = ['101', '102', '103', '104', '105'];
    const away = ['201', '202', '203', '204', '205'];
    const store = new MemoryStore();
    store.save(queued('starters'));
    const ctx = makePorts({
      store,
      index: servingIndex([...home, ...away]),
      lineups: { httpStatus: 200, payload: lineup5x5(home, away) },
    });
    const r = await handlePostgameMessage(msg('starters'), ctx.ports, liveConfig());
    expect(r.status).toBe('READY');
    expect(ctx.starters).toHaveLength(10);
    expect(ctx.starters.every((row) => row.season === '2026')).toBe(true);
  });

  it('4+5 starters are not READY and write nothing', async () => {
    const store = new MemoryStore();
    store.save(queued('starters'));
    const ctx = makePorts({
      store,
      index: servingIndex(['101', '102', '103', '104', '201', '202', '203', '204', '205']),
      lineups: {
        httpStatus: 200,
        payload: lineup5x5(['101', '102', '103', '104'], ['201', '202', '203', '204', '205']),
      },
    });
    const r = await handlePostgameMessage(msg('starters'), ctx.ports, liveConfig());
    expect(r.status).not.toBe('READY');
    expect(ctx.starters).toHaveLength(0);
  });

  it('duplicate starter is not READY', async () => {
    const store = new MemoryStore();
    store.save(queued('starters'));
    const payload = lineup5x5(['101', '102', '103', '104', '105'], ['201', '202', '203', '204', '205']);
    (payload.data[0] as { player: { id: number } }).player.id = 102;
    const ctx = makePorts({
      store,
      index: servingIndex(['101', '102', '103', '104', '105', '201', '202', '203', '204', '205']),
      lineups: { httpStatus: 200, payload },
    });
    const r = await handlePostgameMessage(msg('starters'), ctx.ports, liveConfig());
    expect(r.status).not.toBe('READY');
    expect(ctx.starters).toHaveLength(0);
  });

  it('one not_serving_yet starter does not emit a 4-player result', async () => {
    const home = ['101', '102', '103', '104', '105'];
    const away = ['201', '202', '203', '204', NOT_SERVING_BDL];
    const store = new MemoryStore();
    store.save(queued('starters'));
    const pending = entityIdForBdlPlayer(NOT_SERVING_BDL);
    const index = buildPlayerIdentityIndex({
      bridges: [
        ...['101', '102', '103', '104', '105', '201', '202', '203', '204'].map((id) => ({
          playerEntityId: entityIdForBdlPlayer(id),
          provider: 'balldontlie' as const,
          providerPlayerId: id,
        })),
        { playerEntityId: pending, provider: 'balldontlie', providerPlayerId: NOT_SERVING_BDL },
      ],
      projections: ['101', '102', '103', '104', '105', '201', '202', '203', '204'].map((id) => ({
        playerEntityId: entityIdForBdlPlayer(id),
        analyticsPlayerId: id,
      })),
    });
    const ctx = makePorts({
      store,
      index,
      lineups: { httpStatus: 200, payload: lineup5x5(home, away) },
    });
    const r = await handlePostgameMessage(msg('starters'), ctx.ports, liveConfig());
    expect(r.status).toBe('EXPECTED_ABSENCE');
    expect(r.reasonCode).toBe('IDENTITY_NOT_SERVING');
    expect(ctx.starters).toHaveLength(0);
  });

  it('identity conflict fails starter certification safely', async () => {
    const store = new MemoryStore();
    store.save(queued('starters'));
    const others = ['112', '113', '114', '115', '211', '212', '213', '214', '215'];
    const ctx = makePorts({
      store,
      index: conflictIndex(others),
      lineups: {
        httpStatus: 200,
        payload: lineup5x5(['111', '112', '113', '114', '115'], ['211', '212', '213', '214', '215']),
      },
    });
    const r = await handlePostgameMessage(msg('starters'), ctx.ports, liveConfig());
    expect(r.status).not.toBe('READY');
    expect(r.reasonCode).toBe('IDENTITY_CONFLICT');
    expect(ctx.starters).toHaveLength(0);
  });

  it('inactive GOAT blocks starters, not FAILED, and does not call provider', async () => {
    const store = new MemoryStore();
    store.save(queued('starters'));
    const ctx = makePorts({ store });
    const r = await handlePostgameMessage(
      msg('starters'),
      ctx.ports,
      liveConfig({ goatSubscriptionActive: false })
    );
    expect(r.status).toBe('BLOCKED');
    expect(r.reasonCode).toBe('SUBSCRIPTION_BLOCKED');
    expect(r.providerCalled).toBe(false);
    expect(ctx.lineupCalls.n).toBe(0);
    expect(store.get(GAME, 'starters')?.status).toBe('BLOCKED');
  });

  it('empty lineup payload is WAITING PROVIDER_NOT_READY', async () => {
    const store = new MemoryStore();
    store.save(queued('starters'));
    const ctx = makePorts({ store, lineups: { httpStatus: 200, payload: { data: [] } } });
    const r = await handlePostgameMessage(msg('starters'), ctx.ports, liveConfig());
    expect(r.status).toBe('WAITING');
    expect(r.reasonCode).toBe('PROVIDER_NOT_READY');
  });

  it('box 429 and 5xx wait instead of failing permanently', async () => {
    const store = new MemoryStore();
    store.save(queued('box'));
    const limited = makePorts({ store, box: { httpStatus: 429, payload: null } });
    const r429 = await handlePostgameMessage(msg('box'), limited.ports, liveConfig());
    expect(r429.status).toBe('WAITING');
    expect(r429.reasonCode).toBe('PROVIDER_429');
    store.save(queued('box', '18450002'));
    const server = makePorts({
      store,
      box: { httpStatus: 503, payload: null },
    });
    const r5 = await handlePostgameMessage(msg('box', '18450002'), server.ports, liveConfig());
    expect(r5.status).toBe('WAITING');
    expect(r5.reasonCode).toBe('PROVIDER_5XX');
  });

  it('box READY + starters BLOCKED still yields MINIMUM_READY', async () => {
    const store = new MemoryStore();
    store.save(queued('box'));
    store.save(queued('starters'));
    const ctx = makePorts({ store });
    const box = await handlePostgameMessage(msg('box'), ctx.ports, liveConfig());
    const starters = await handlePostgameMessage(
      msg('starters'),
      ctx.ports,
      liveConfig({ goatSubscriptionActive: false })
    );
    expect(box.status).toBe('READY');
    expect(starters.status).toBe('BLOCKED');
    expect(
      classifyGameReadiness({
        game: {
          gameId: GAME,
          season: '2026',
          status: 'Final',
          homeScore: 110,
          awayScore: 104,
          startTime: now.toISOString(),
        },
        stages: {
          box: {
            gameId: GAME,
            season: '2026',
            stage: 'box',
            status: 'READY',
            attempts: 1,
            reasonCode: null,
            updatedAt: now.toISOString(),
          },
          starters: {
            gameId: GAME,
            season: '2026',
            stage: 'starters',
            status: 'BLOCKED',
            attempts: 0,
            reasonCode: 'SUBSCRIPTION_BLOCKED',
            updatedAt: now.toISOString(),
          },
        },
      })
    ).toBe('MINIMUM_READY');
  });

  it('box failure does not prevent starters success on the same game', async () => {
    const home = ['101', '102', '103', '104', '105'];
    const away = ['201', '202', '203', '204', '205'];
    const store = new MemoryStore();
    store.save(queued('box'));
    store.save(queued('starters'));
    const ctx = makePorts({
      store,
      index: servingIndex([...home, ...away]),
      box: { httpStatus: 200, payload: { not_data: true } },
      lineups: { httpStatus: 200, payload: lineup5x5(home, away) },
    });
    const box = await handlePostgameMessage(msg('box'), ctx.ports, liveConfig());
    const starters = await handlePostgameMessage(msg('starters'), ctx.ports, liveConfig());
    expect(box.status).toBe('FAILED');
    expect(starters.status).toBe('READY');
  });

  it('isolates malformed box, valid box, starter conflict, and valid starters across games', async () => {
    const store = new MemoryStore();
    const gameA = GAME;
    const gameB = '18450099';
    const gameC = '18450100';
    const gameD = '18450101';
    store.save(queued('box', gameA));
    store.save(queued('box', gameB));
    store.save(queued('starters', gameC));
    store.save(queued('starters', gameD));
    const a = await handlePostgameMessage(
      msg('box', gameA),
      makePorts({ store, box: { httpStatus: 200, payload: { nope: true } } }).ports,
      liveConfig()
    );
    const b = await handlePostgameMessage(msg('box', gameB), makePorts({ store }).ports, liveConfig());
    const home = ['101', '102', '103', '104', '105'];
    const away = ['201', '202', '203', '204', '205'];
    const c = await handlePostgameMessage(
      msg('starters', gameC),
      makePorts({
        store,
        index: conflictIndex(['112', '113', '114', '115', '211', '212', '213', '214', '215']),
        lineups: {
          httpStatus: 200,
          payload: lineup5x5(['111', '112', '113', '114', '115'], ['211', '212', '213', '214', '215']),
        },
      }).ports,
      liveConfig()
    );
    const d = await handlePostgameMessage(
      msg('starters', gameD),
      makePorts({
        store,
        index: servingIndex([...home, ...away]),
        lineups: { httpStatus: 200, payload: lineup5x5(home, away) },
      }).ports,
      liveConfig()
    );
    expect(a.status).toBe('FAILED');
    expect(b.status).toBe('READY');
    expect(c.status).not.toBe('READY');
    expect(d.status).toBe('READY');
  });

  it('frozen handler does not call provider, S3, or serving writes', async () => {
    const store = new MemoryStore();
    store.save(queued('box'));
    const fetchBoxStats = vi.fn();
    const fetchLineups = vi.fn();
    const writePlayerGameLogs = vi.fn();
    const archiveLineups = vi.fn();
    const ports: PostgameWorkerPorts = {
      store,
      now,
      identityIndex: servingIndex(['100']),
      fetchBoxStats,
      fetchLineups,
      loadGame: async () => null,
      writePlayerGameLogs,
      writeGameStarters: vi.fn(),
      archiveLineups,
      logs: [],
    };
    const r = await handlePostgameMessage(msg('box'), ports, freezeConfig());
    expect(r.skipped).toBe(true);
    expect(r.claimed).toBe(false);
    expect(fetchBoxStats).not.toHaveBeenCalled();
    expect(fetchLineups).not.toHaveBeenCalled();
    expect(writePlayerGameLogs).not.toHaveBeenCalled();
    expect(archiveLineups).not.toHaveBeenCalled();
    expect(store.get(GAME, 'box')?.status).toBe('QUEUED');
    expect(store.get(GAME, 'box')?.attempts).toBe(0);
  });

  it('env freeze (DATA_MODE=replay) fail-closes even if live_ingestion_enabled is true', async () => {
    const cfg = postgameWorkerConfigFromEnv({
      LIVE_INGESTION_ENABLED: '1',
      DATA_MODE: 'replay',
      OFFSEASON_MODE: '1',
      CRON_DRY_RUN: '1',
      BDL_GOAT_SUBSCRIPTION: '0',
    });
    expect(cfg.liveIngestionEnabled).toBe(true);
    expect(cfg.freezeSkipsMutations).toBe(true);
    const store = new MemoryStore();
    store.save(queued('box'));
    const ctx = makePorts({ store });
    const r = await handlePostgameMessage(msg('box'), ctx.ports, cfg);
    expect(r.providerCalled).toBe(false);
    expect(ctx.boxCalls.n).toBe(0);
  });

  it('rejects 2025 historical season without writes', async () => {
    const store = new MemoryStore();
    store.save({ ...queued('box'), season: '2025' });
    const ctx = makePorts({ store });
    const r = await handlePostgameMessage({ ...msg('box'), season: '2025' }, ctx.ports, liveConfig());
    expect(r.providerCalled).toBe(false);
    expect(ctx.pgl).toHaveLength(0);
  });

  it('advanced/plays/game_flow messages skip without FAILED or provider even if GOAT is active', async () => {
    const store = new MemoryStore();
    for (const stage of ['advanced', 'plays', 'game_flow'] as const) {
      const ctx = makePorts({ store });
      const r = await handlePostgameMessage(msg(stage), ctx.ports, liveConfig());
      expect(r.skipped).toBe(true);
      expect(r.providerCalled).toBe(false);
      expect(r.status).not.toBe('FAILED');
      expect(ctx.boxCalls.n).toBe(0);
      expect(ctx.lineupCalls.n).toBe(0);
    }
  });

  it('malformed version is not acknowledged as success work and does not call provider', async () => {
    const store = new MemoryStore();
    store.save(queued('box'));
    const ctx = makePorts({ store });
    const r = await handlePostgameMessage(
      { v: 99, gameId: GAME, season: '2026', stage: 'box', attempt: 1, enqueuedAt: now.toISOString() },
      ctx.ports,
      liveConfig()
    );
    expect(r.ack).toBe(false);
    expect(r.providerCalled).toBe(false);
  });

  it('claim helper only succeeds from QUEUED and increments attempts only then', () => {
    const store = new MemoryStore();
    store.save({ ...queued('box'), status: 'RUNNING' });
    expect(claimQueuedStage(store, { gameId: GAME, stage: 'box', now }).ok).toBe(false);
    expect(store.get(GAME, 'box')?.attempts).toBe(0);
    store.save(queued('box'));
    const claimed = claimQueuedStage(store, { gameId: GAME, stage: 'box', now });
    expect(claimed.ok).toBe(true);
    expect(store.get(GAME, 'box')?.attempts).toBe(1);
    expect(store.get(GAME, 'box')?.status).toBe('RUNNING');
  });
});
