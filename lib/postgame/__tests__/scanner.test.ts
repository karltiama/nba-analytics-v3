import { describe, expect, it } from 'vitest';
import { classifyGameReadiness } from '../readiness';
import { scanPostgameFinals } from '../scanner';
import { parsePostgameQueueMessage, type PostgameScanGame, type PostgameServingEvidence } from '../types';

const now = new Date('2026-10-22T03:00:00.000Z');

const finalGame: PostgameScanGame = {
  gameId: '18450001',
  season: '2026',
  status: 'Final',
  homeScore: 110,
  awayScore: 104,
  startTime: '2026-10-21T23:30:00.000Z',
};

const scheduled: PostgameScanGame = {
  ...finalGame,
  gameId: '18450002',
  status: 'Scheduled',
  homeScore: 0,
  awayScore: 0,
};

const emptyEvidence = (gameId: string): PostgameServingEvidence => ({
  gameId,
  boxHomeCount: 0,
  boxAwayCount: 0,
  startersHomeCount: 0,
  startersAwayCount: 0,
  advancedCount: 0,
  playsObjectPresent: false,
  gameFlowTimelineAvailable: null,
  gameFlowStreamClass: null,
});

const frozen = {
  now,
  liveIngestionEnabled: false,
  freezeSkipsMutations: true,
  goatSubscriptionActive: false,
};

const liveGoat = {
  now,
  liveIngestionEnabled: true,
  freezeSkipsMutations: false,
  goatSubscriptionActive: true,
};

describe('scanPostgameFinals', () => {
  it('ignores non-Final games', () => {
    const r = scanPostgameFinals({
      games: [scheduled],
      stages: [],
      evidence: [],
      config: frozen,
    });
    expect(r.eligibleFinals).toBe(0);
    expect(r.skippedNonFinal).toBe(1);
    expect(r.enqueue).toHaveLength(0);
  });

  it('plans WAITING stages for a Final but holds enqueue while frozen', () => {
    const r = scanPostgameFinals({
      games: [finalGame],
      stages: [],
      evidence: [emptyEvidence(finalGame.gameId)],
      config: frozen,
    });
    expect(r.eligibleFinals).toBe(1);
    expect(r.upserts).toHaveLength(5);
    expect(r.upserts.every((u) => u.status === 'WAITING' || u.stage === 'box')).toBe(true);
    expect(r.enqueue.length).toBeGreaterThan(0);
    expect(r.enqueue.every((e) => e.action === 'hold')).toBe(true);
    expect(r.enqueue.every((e) => e.holdReason?.includes('freeze'))).toBe(true);
    expect(r.enqueue.map((e) => e.message.stage).sort()).toEqual(['box', 'starters']);
  });

  it('does not mark frozen GOAT stages BLOCKED', () => {
    const r = scanPostgameFinals({
      games: [finalGame],
      stages: [],
      evidence: [emptyEvidence(finalGame.gameId)],
      config: frozen,
    });
    expect(r.upserts.filter((u) => u.status === 'BLOCKED')).toHaveLength(0);
  });

  it('blocks GOAT stages when live and subscription inactive, not FAILED', () => {
    const r = scanPostgameFinals({
      games: [finalGame],
      stages: [],
      evidence: [emptyEvidence(finalGame.gameId)],
      config: {
        now,
        liveIngestionEnabled: true,
        freezeSkipsMutations: false,
        goatSubscriptionActive: false,
      },
    });
    const goat = r.upserts.filter((u) => ['starters', 'advanced', 'plays'].includes(u.stage));
    expect(goat.every((u) => u.status === 'BLOCKED')).toBe(true);
    expect(goat.every((u) => u.reasonCode === 'SUBSCRIPTION_BLOCKED')).toBe(true);
    expect(r.enqueue.filter((e) => e.action === 'enqueue').map((e) => e.message.stage)).toEqual([
      'box',
    ]);
    expect(r.upserts.find((u) => u.stage === 'box')?.status).toBe('QUEUED');
  });

  it('marks box READY from serving evidence and does not enqueue it', () => {
    const r = scanPostgameFinals({
      games: [finalGame],
      stages: [],
      evidence: [
        {
          ...emptyEvidence(finalGame.gameId),
          boxHomeCount: 8,
          boxAwayCount: 9,
        },
      ],
      config: liveGoat,
    });
    expect(r.upserts.find((u) => u.stage === 'box')).toMatchObject({
      status: 'READY',
      derivedFromServing: true,
    });
    expect(r.enqueue.filter((e) => e.message.stage === 'box')).toHaveLength(0);
    expect(classifyGameReadiness({
      game: finalGame,
      stages: { box: { gameId: finalGame.gameId, season: '2026', stage: 'box', status: 'READY', attempts: 1, reasonCode: null, updatedAt: now.toISOString() } },
    })).toBe('MINIMUM_READY');
  });

  it('does not enqueue unimplemented stages even when GOAT is active', () => {
    const r = scanPostgameFinals({
      games: [finalGame],
      stages: [],
      evidence: [emptyEvidence(finalGame.gameId)],
      config: liveGoat,
    });
    const sent = r.enqueue.filter((e) => e.action === 'enqueue').map((e) => e.message.stage);
    expect(sent.sort()).toEqual(['box', 'starters']);
    expect(sent).not.toContain('advanced');
    expect(sent).not.toContain('plays');
    expect(sent).not.toContain('game_flow');
  });

  it('truncated Plays becomes EXPECTED_ABSENCE for plays and game_flow, not FAILED', () => {
    const r = scanPostgameFinals({
      games: [finalGame],
      stages: [],
      evidence: [
        {
          ...emptyEvidence(finalGame.gameId),
          boxHomeCount: 8,
          boxAwayCount: 8,
          playsObjectPresent: true,
          gameFlowStreamClass: 'truncated',
        },
      ],
      config: liveGoat,
    });
    expect(r.upserts.find((u) => u.stage === 'plays')).toMatchObject({
      status: 'EXPECTED_ABSENCE',
      reasonCode: 'SOURCE_TRUNCATED',
    });
    expect(r.upserts.find((u) => u.stage === 'game_flow')).toMatchObject({
      status: 'EXPECTED_ABSENCE',
      reasonCode: 'SOURCE_TRUNCATED',
    });
    expect(r.enqueue.filter((e) => ['plays', 'game_flow'].includes(e.message.stage))).toHaveLength(0);
    expect(
      classifyGameReadiness({
        game: finalGame,
        stages: Object.fromEntries(
          r.upserts.map((u) => [
            u.stage,
            {
              gameId: u.gameId,
              season: u.season,
              stage: u.stage,
              status: u.status,
              attempts: 0,
              reasonCode: u.reasonCode,
              updatedAt: now.toISOString(),
            },
          ])
        ),
      })
    ).toBe('MINIMUM_READY');
  });

  it('COMPLETE when box is READY and remaining stages are READY or EXPECTED_ABSENCE', () => {
    const at = now.toISOString();
    expect(
      classifyGameReadiness({
        game: finalGame,
        stages: {
          box: { gameId: finalGame.gameId, season: '2026', stage: 'box', status: 'READY', attempts: 1, reasonCode: null, updatedAt: at },
          starters: { gameId: finalGame.gameId, season: '2026', stage: 'starters', status: 'READY', attempts: 1, reasonCode: null, updatedAt: at },
          advanced: { gameId: finalGame.gameId, season: '2026', stage: 'advanced', status: 'EXPECTED_ABSENCE', attempts: 1, reasonCode: 'SOURCE_TRUNCATED', updatedAt: at },
          plays: { gameId: finalGame.gameId, season: '2026', stage: 'plays', status: 'EXPECTED_ABSENCE', attempts: 1, reasonCode: 'SOURCE_TRUNCATED', updatedAt: at },
          game_flow: { gameId: finalGame.gameId, season: '2026', stage: 'game_flow', status: 'EXPECTED_ABSENCE', attempts: 1, reasonCode: 'SOURCE_TRUNCATED', updatedAt: at },
        },
      })
    ).toBe('COMPLETE');
  });

  it('isolates a FAILED box game from another Final', () => {
    const b: PostgameScanGame = { ...finalGame, gameId: '18450099' };
    const r = scanPostgameFinals({
      games: [finalGame, b],
      stages: [
        {
          gameId: finalGame.gameId,
          season: '2026',
          stage: 'box',
          status: 'FAILED',
          attempts: 2,
          reasonCode: 'MALFORMED_SOURCE',
          updatedAt: now.toISOString(),
        },
      ],
      evidence: [emptyEvidence(finalGame.gameId), emptyEvidence(b.gameId)],
      config: liveGoat,
    });
    const aBox = r.enqueue.filter((e) => e.message.gameId === finalGame.gameId && e.message.stage === 'box');
    const bBox = r.enqueue.filter((e) => e.message.gameId === b.gameId && e.message.stage === 'box');
    expect(aBox).toHaveLength(0);
    expect(bBox.some((e) => e.action === 'enqueue')).toBe(true);
  });

  it('re-enqueues SUBSCRIPTION_BLOCKED starters after GOAT catch-up, never advanced', () => {
    const r = scanPostgameFinals({
      games: [finalGame],
      stages: [
        {
          gameId: finalGame.gameId,
          season: '2026',
          stage: 'starters',
          status: 'BLOCKED',
          attempts: 0,
          reasonCode: 'SUBSCRIPTION_BLOCKED',
          updatedAt: now.toISOString(),
        },
        {
          gameId: finalGame.gameId,
          season: '2026',
          stage: 'advanced',
          status: 'BLOCKED',
          attempts: 0,
          reasonCode: 'SUBSCRIPTION_BLOCKED',
          updatedAt: now.toISOString(),
        },
      ],
      evidence: [emptyEvidence(finalGame.gameId)],
      config: liveGoat,
    });
    expect(r.enqueue.some((e) => e.message.stage === 'starters' && e.action === 'enqueue')).toBe(true);
    expect(r.enqueue.some((e) => e.message.stage === 'advanced')).toBe(false);
  });

  it('re-enqueues IDENTITY_NOT_SERVING when identityCatchUp is set', () => {
    const r = scanPostgameFinals({
      games: [finalGame],
      stages: [
        {
          gameId: finalGame.gameId,
          season: '2026',
          stage: 'starters',
          status: 'EXPECTED_ABSENCE',
          attempts: 1,
          reasonCode: 'IDENTITY_NOT_SERVING',
          updatedAt: now.toISOString(),
        },
      ],
      evidence: [emptyEvidence(finalGame.gameId)],
      config: { ...liveGoat, identityCatchUp: true },
    });
    expect(r.enqueue.some((e) => e.message.stage === 'starters' && e.action === 'enqueue')).toBe(
      true
    );
  });

  it('retries PROVIDER_NOT_READY box and does not retry MALFORMED_SOURCE', () => {
    const retry = scanPostgameFinals({
      games: [finalGame],
      stages: [
        {
          gameId: finalGame.gameId,
          season: '2026',
          stage: 'box',
          status: 'FAILED',
          attempts: 1,
          reasonCode: 'PROVIDER_NOT_READY',
          updatedAt: now.toISOString(),
        },
      ],
      evidence: [emptyEvidence(finalGame.gameId)],
      config: liveGoat,
    });
    const permanent = scanPostgameFinals({
      games: [finalGame],
      stages: [
        {
          gameId: finalGame.gameId,
          season: '2026',
          stage: 'box',
          status: 'FAILED',
          attempts: 1,
          reasonCode: 'MALFORMED_SOURCE',
          updatedAt: now.toISOString(),
        },
      ],
      evidence: [emptyEvidence(finalGame.gameId)],
      config: liveGoat,
    });
    expect(retry.enqueue.some((e) => e.message.stage === 'box')).toBe(true);
    expect(permanent.enqueue.some((e) => e.message.stage === 'box')).toBe(false);
  });

  it('queue messages parse and never include payloads', () => {
    const r = scanPostgameFinals({
      games: [finalGame],
      stages: [],
      evidence: [emptyEvidence(finalGame.gameId)],
      config: liveGoat,
    });
    const msg = r.enqueue.find((e) => e.action === 'enqueue')!.message;
    expect(parsePostgameQueueMessage(msg)).toEqual(msg);
    expect(JSON.stringify(msg)).not.toMatch(/api[_-]?key/i);
    expect(msg).not.toHaveProperty('body');
  });

  it('ENRICHED when box READY plus any optional READY', () => {
    expect(
      classifyGameReadiness({
        game: finalGame,
        stages: {
          box: {
            gameId: finalGame.gameId,
            season: '2026',
            stage: 'box',
            status: 'READY',
            attempts: 1,
            reasonCode: null,
            updatedAt: now.toISOString(),
          },
          advanced: {
            gameId: finalGame.gameId,
            season: '2026',
            stage: 'advanced',
            status: 'READY',
            attempts: 1,
            reasonCode: null,
            updatedAt: now.toISOString(),
          },
        },
      })
    ).toBe('ENRICHED');
  });

  it('does not plan 2025 certified games when season is pinned to 2026', () => {
    const hist: PostgameScanGame = { ...finalGame, gameId: '1038324', season: '2025' };
    const r = scanPostgameFinals({
      games: [hist, finalGame],
      stages: [],
      evidence: [],
      config: { ...liveGoat, season: '2026' },
    });
    expect(r.skippedWrongSeason).toBe(1);
    expect(r.eligibleFinals).toBe(1);
    expect(r.upserts.every((u) => u.season === '2026')).toBe(true);
  });
});
