import {
  InMemoryArchiveStore,
  LEGACY_PROTECTED_PREFIX,
  buildArchiveEnvelope,
  buildPlayerPropSnapshotArchiveKey,
  gunzipEnvelope,
  isProtectedHistoricalKey,
  isValidPregameResearchSnapshot,
  mayPruneRawSnapshot,
  rowsFromNormalized,
  writeArchiveObject,
  type NormalizedPropLike,
} from '@/lib/archive/player-prop-snapshot-archive';
import { researchPregameRowsFromEnvelope } from '@/lib/archive/player-prop-snapshot-reader';

export type SimulatedArchiveDemo = {
  key: string;
  checksum: string;
  rowCount: number;
  timing: string;
  pregameRowCount: number;
  pruneWithoutArchive: boolean;
  pruneWithArchive: boolean;
  protectedPrefixUntouched: boolean;
};

export function fixtureNormalizedRows(): NormalizedPropLike[] {
  return [
    {
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
      raw_json: { vendor: 'DraftKings', market_id: 'pts-ou' },
      provider_updated_at: new Date('2026-10-21T17:00:00.000Z'),
    },
    {
      game_id: 12345,
      player_id: 77,
      player_name: 'Luka Doncic',
      team_id: 14,
      sportsbook: 'draftkings',
      prop_type: 'points',
      market_type: 'over_under',
      side: 'under',
      line_value: 27.5,
      odds_american: -110,
      odds_decimal: 1.91,
      implied_probability: 0.524,
      raw_json: { vendor: 'DraftKings', market_id: 'pts-ou' },
      provider_updated_at: new Date('2026-10-21T17:00:00.000Z'),
    },
  ];
}

export async function simulatePlayerPropArchivePipeline(): Promise<SimulatedArchiveDemo> {
  const snapshotAt = new Date('2026-10-21T18:00:00.000Z');
  const gameStart = new Date('2026-10-21T23:30:00.000Z');
  const postTip = new Date('2026-10-21T23:40:00.000Z');
  const store = new InMemoryArchiveStore();
  store.objects.set(`${LEGACY_PROTECTED_PREFIX}/dt=2026-04-02/data.jsonl`, {
    body: Buffer.from('legacy-evidence'),
    metadata: {},
  });
  const rows = rowsFromNormalized({
    normalized: fixtureNormalizedRows(),
    analyticsGameId: '12345',
    pullRunId: 99,
    snapshotAt,
    gameStartTime: gameStart,
  });
  const envelope = buildArchiveEnvelope({
    season: 2026,
    pullRunId: 99,
    gameId: '12345',
    sourceGameId: 12345,
    gameDate: '2026-10-21',
    snapshotAt,
    gameStartTime: gameStart,
    rows,
  });
  const key = buildPlayerPropSnapshotArchiveKey({
    season: 2026,
    gameDate: '2026-10-21',
    gameId: '12345',
    pullRunId: 99,
    snapshotAt,
  });
  const written = await writeArchiveObject({ store, key, envelope });
  if (!written.ok) throw new Error(written.message);
  const back = gunzipEnvelope((await store.get(key))!.body);
  const postTipValid = isValidPregameResearchSnapshot(postTip, gameStart);
  return {
    key,
    checksum: back.checksum,
    rowCount: back.row_count,
    timing: back.timing,
    pregameRowCount: researchPregameRowsFromEnvelope(back).length,
    pruneWithoutArchive: mayPruneRawSnapshot({
      requireArchive: true,
      requiredAfter: new Date('2026-10-01T00:00:00.000Z'),
      snapshotFetchedAt: snapshotAt,
      snapshotPullRunId: 99,
      gameRunStartedAt: snapshotAt,
      archiveStatus: 'failed',
    }).eligible,
    pruneWithArchive: mayPruneRawSnapshot({
      requireArchive: true,
      requiredAfter: new Date('2026-10-01T00:00:00.000Z'),
      snapshotFetchedAt: snapshotAt,
      snapshotPullRunId: 99,
      gameRunStartedAt: snapshotAt,
      archiveStatus: 'archived',
    }).eligible,
    protectedPrefixUntouched:
      store.objects.get(`${LEGACY_PROTECTED_PREFIX}/dt=2026-04-02/data.jsonl`)?.body.toString() ===
        'legacy-evidence' && !isProtectedHistoricalKey(key) && !postTipValid,
  };
}
