import { describe, expect, it } from 'vitest';
import {
  InMemoryOwlsStore,
  buildOwlsArchiveKey,
  buildOwlsEnvelope,
  entityForEndpoint,
  gunzipJson,
  gzipJson,
  isProtectedOwlsKey,
  readOwlsEnvelope,
  verifyEnvelopeChecksum,
  writeOwlsArchiveObject,
} from '../archive';
import { OWLS_ENTITY_CLOSING_ODDS, OWLS_PATHS, OWLS_SOURCE_PREFIX } from '../contract';
import { loadOwlsFixtures } from '../fixtures';
import { extractRows } from '../client';
import type { OwlsPage } from '../types';

function fixturePage(): OwlsPage {
  const body = loadOwlsFixtures()[OWLS_PATHS.historyPlayerProps];
  return {
    request: {
      method: 'GET',
      path: OWLS_PATHS.historyPlayerProps,
      query: { eventId: 'owls-fixture-event-1037995', limit: 100, offset: 0 },
    },
    url: 'https://api.owlsinsight.com/api/v1/history/player-props?eventId=owls-fixture-event-1037995',
    body,
    metadata: { status: 200, headers: {}, durationMs: 1 },
    rowCount: extractRows(body).length,
    pageIndex: 1,
    offset: 0,
    limit: 100,
    exhausted: true,
  };
}

describe('Owls archive', () => {
  it('builds a deterministic provider-specific key', () => {
    const key = buildOwlsArchiveKey({
      season: '2023',
      entity: 'historical_player_props',
      gameDate: '2023-12-25',
      providerGameId: 'owls-fixture-event-1037995',
      pageIndex: 1,
    });
    expect(key).toBe(
      'raw/source=owls_insight/league=nba/season=2023/entity=historical_player_props/game_date=2023-12-25/provider_game_id=owls-fixture-event-1037995/page=0001.json.gz'
    );
    expect(key).toContain(`source=${OWLS_SOURCE_PREFIX}`);
    expect(key).not.toContain('balldontlie');
  });

  it('maps closing-odds to a distinct archive entity', () => {
    expect(entityForEndpoint('/api/v1/history/closing-odds')).toBe(OWLS_ENTITY_CLOSING_ODDS);
    expect(entityForEndpoint('history_closing_odds')).toBe(OWLS_ENTITY_CLOSING_ODDS);
    expect(entityForEndpoint('/api/v1/history/player-props')).not.toBe(OWLS_ENTITY_CLOSING_ODDS);
    expect(entityForEndpoint('/api/v1/history/props')).not.toBe(OWLS_ENTITY_CLOSING_ODDS);
    const key = buildOwlsArchiveKey({
      season: '2023',
      entity: OWLS_ENTITY_CLOSING_ODDS,
      gameDate: '2023-12-25',
      providerGameId: 'nba:Boston_Celtics@Los_Angeles_Lakers-20231225',
      pageIndex: 1,
    });
    expect(key).toContain(`entity=${OWLS_ENTITY_CLOSING_ODDS}`);
    expect(key).not.toContain('historical_player_props');
    expect(key).not.toContain('historical_prop_snapshots');
  });

  it('refuses protected historical prefixes', () => {
    expect(
      isProtectedOwlsKey(
        'raw/source=existing_ingestion/league=nba/season=2025/entity=player_props_raw_v2/x.json.gz'
      )
    ).toBe(true);
    expect(
      isProtectedOwlsKey(
        'raw/source=balldontlie/league=nba/season=2026/entity=player_prop_snapshots/x.json.gz'
      )
    ).toBe(true);
    expect(
      isProtectedOwlsKey(
        'raw/source=balldontlie/league=nba/season=2025/entity=opening_player_props/x.json.gz'
      )
    ).toBe(true);
  });

  it('gzips, checksums, reads back, and skips duplicate pages', async () => {
    const store = new InMemoryOwlsStore();
    const envelope = buildOwlsEnvelope({
      page: fixturePage(),
      backfillRunId: 'owls-fixture',
      requestedAt: '2026-09-14T16:00:00.000Z',
      providerGameId: 'owls-fixture-event-1037995',
      season: '2023',
      gameDate: '2023-12-25',
      fixture: true,
    });
    expect(verifyEnvelopeChecksum(envelope)).toBe(true);
    const key = buildOwlsArchiveKey({
      fixture: true,
      season: '2023',
      entity: 'historical_player_props',
      gameDate: '2023-12-25',
      providerGameId: 'owls-fixture-event-1037995',
      pageIndex: 1,
    });
    expect(key).toContain('source=owls_insight_fixture');
    const first = await writeOwlsArchiveObject({ store, key, envelope });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.result).toBe('written');
    const second = await writeOwlsArchiveObject({ store, key, envelope });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.result).toBe('already_exists');
    const read = await readOwlsEnvelope(store, key);
    expect(read.checksum).toBe(envelope.checksum);
    expect(read.payload).toEqual(envelope.payload);
    const gz = gzipJson(envelope);
    expect(gunzipJson(gz)).toEqual(envelope);
  });

  it('rejects a corrupted gzip object', async () => {
    const store = new InMemoryOwlsStore();
    const key = 'raw/source=owls_insight_fixture/league=nba/season=2023/entity=historical_player_props/bad.json.gz';
    await store.put(key, Buffer.from('not-gzip'), { checksum: 'x' });
    await expect(readOwlsEnvelope(store, key)).rejects.toThrow(/Corrupted Owls archive/);
  });

  it('rejects checksum mismatch', async () => {
    const store = new InMemoryOwlsStore();
    const envelope = buildOwlsEnvelope({
      page: fixturePage(),
      backfillRunId: 'owls-fixture',
      requestedAt: '2026-09-14T16:00:00.000Z',
      providerGameId: 'e',
      season: '2023',
      gameDate: '2023-12-25',
      fixture: true,
    });
    envelope.checksum = '0'.repeat(64);
    const key = buildOwlsArchiveKey({
      fixture: true,
      season: '2023',
      entity: 'historical_player_props',
      gameDate: '2023-12-25',
      providerGameId: 'e',
      pageIndex: 9,
    });
    const write = await writeOwlsArchiveObject({ store, key, envelope });
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.error).toBe('checksum_mismatch');
  });
});
