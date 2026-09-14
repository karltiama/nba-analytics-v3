import { describe, expect, it } from 'vitest';
import {
  InMemoryArchiveStore,
  LEGACY_PROTECTED_PREFIX,
  buildArchiveEnvelope,
  buildPlayerPropSnapshotArchiveKey,
  rowsFromNormalized,
  writeArchiveObject,
  type NormalizedPropLike,
} from '@/lib/archive/player-prop-snapshot-archive';
import {
  listPlayerPropArchiveKeys,
  readPlayerPropArchiveByKey,
  researchPregameRowsFromEnvelope,
} from '@/lib/archive/player-prop-snapshot-reader';

function row(): NormalizedPropLike {
  return {
    game_id: 12345,
    player_id: 77,
    player_name: 'Luka Doncic',
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
    provider_updated_at: null,
  };
}

describe('player-prop snapshot archive reader', () => {
  it('reads gzip envelopes by key and lists game prefixes', async () => {
    const store = new InMemoryArchiveStore();
    const snapshotAt = new Date('2026-10-21T18:00:00.000Z');
    const start = new Date('2026-10-21T23:30:00.000Z');
    const envelope = buildArchiveEnvelope({
      season: 2026,
      pullRunId: 99,
      gameId: '12345',
      sourceGameId: 12345,
      gameDate: '2026-10-21',
      snapshotAt,
      gameStartTime: start,
      rows: rowsFromNormalized({
        normalized: [row()],
        analyticsGameId: '12345',
        pullRunId: 99,
        snapshotAt,
        gameStartTime: start,
      }),
    });
    const key = buildPlayerPropSnapshotArchiveKey({
      season: 2026,
      gameDate: '2026-10-21',
      gameId: '12345',
      pullRunId: 99,
      snapshotAt,
    });
    await writeArchiveObject({ store, key, envelope });
    const back = await readPlayerPropArchiveByKey(store, key);
    expect(back?.row_count).toBe(1);
    expect(researchPregameRowsFromEnvelope(back!)).toHaveLength(1);
    const keys = await listPlayerPropArchiveKeys({
      listKeys: async (prefix) => [...store.objects.keys()].filter((k) => k.startsWith(prefix)),
      season: 2026,
      gameDate: '2026-10-21',
      gameId: '12345',
    });
    expect(keys).toEqual([key]);
  });

  it('refuses to treat existing_ingestion objects as the new archive', async () => {
    const store = new InMemoryArchiveStore();
    await expect(
      readPlayerPropArchiveByKey(store, `${LEGACY_PROTECTED_PREFIX}/dt=2026-04-02/data.jsonl`)
    ).rejects.toThrow(/protected historical prefix/);
  });
});
