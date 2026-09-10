import { describe, expect, it, vi } from 'vitest';
import { readCanonicalPlaysObject, canonicalPlaysObjectKey } from '@/lib/archive/plays-2025-read';
import {
  getHistoricalGameTimeline,
  clearHistoricalTimelineProcessCache,
} from '@/lib/betting/historical-timeline-server';
import { normalizePlayEvents } from '@/lib/betting/historical-timeline';
import { query } from '@/lib/db';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
}));

const queryMock = vi.mocked(query);

const SAMPLE = {
  game_id: '18447937',
  pages: [
    {
      status: 200,
      body: {
        data: [
          {
            game_id: '18447937',
            order: 1,
            period: 1,
            clock: '12:00',
            type: 'Jumpball',
            text: 'Jumpball',
            home_score: 0,
            away_score: 0,
            scoring_play: false,
            shooting_play: false,
            team: null,
            participants: ['274', '434'],
          },
          {
            game_id: '18447937',
            order: 2,
            period: 4,
            clock: '0:00',
            type: 'End Game',
            text: 'End Game',
            home_score: 99,
            away_score: 118,
            scoring_play: false,
            shooting_play: false,
            team: null,
            participants: [],
          },
        ],
      },
    },
  ],
};

describe('canonical Plays S3 read', () => {
  it('builds the canonical game object key', () => {
    expect(canonicalPlaysObjectKey('18447937')).toBe(
      'raw/source=balldontlie/league=nba/season=2025/entity=plays/game_id=18447937.json'
    );
  });

  it('returns unavailable when the object is missing', async () => {
    const read = await readCanonicalPlaysObject({ getJson: async () => null }, '18447937');
    expect(read.found).toBe(false);
    expect(read.ok).toBe(false);
    expect(read.reason).toBe('missing');
    expect(read.rows).toEqual([]);
  });

  it('fail-closes malformed archive objects', async () => {
    const read = await readCanonicalPlaysObject({ getJson: async () => ({ truncated: true, data: [] }) }, '18447937');
    expect(read.found).toBe(true);
    expect(read.ok).toBe(false);
    expect(read.reason).toBe('truncated');
  });

  it('extracts provider rows for server-side normalization only', async () => {
    const read = await readCanonicalPlaysObject({ getJson: async () => SAMPLE }, '18447937');
    expect(read.ok).toBe(true);
    const { events } = normalizePlayEvents(read.rows, '18447937');
    expect(events.map((e) => e.category)).toEqual(['jump_ball', 'period']);
    expect(events.every((e) => e.rawType !== undefined)).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/coordinate/i);
  });
});

describe('getHistoricalGameTimeline', () => {
  it('does not return unnormalized provider rows', async () => {
    clearHistoricalTimelineProcessCache();
    queryMock.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('from analytics.games') || s.includes('FROM analytics.games')) {
        return [{ season: '2025', home_score: 99, away_score: 118 }];
      }
      if (s.includes('game_flow')) {
        return [
          {
            game_id: '18447937',
            season: '2025',
            source: 'bdl_plays_2025_canonical',
            timeline_available: true,
            score_reconciled: true,
            stream_complete: true,
            stream_class: 'complete',
            quality_code: 'TIMELINE_OK',
            plays_final_home: 99,
            plays_final_away: 118,
            event_count: 2,
            period_count: 4,
            overtime_count: 0,
            lead_changes: 0,
            ties: 0,
            largest_home_lead: 0,
            largest_away_lead: 19,
            largest_home_run: 0,
            largest_away_run: 0,
            home_points_by_period: [0, 0, 0, 99],
            away_points_by_period: [0, 0, 0, 118],
            rotation_available: true,
            rotation_failure_class: null,
          },
        ];
      }
      if (s.includes('analytics.players')) {
        return [
          { player_id: '274', full_name: 'Kawhi Leonard' },
          { player_id: '434', full_name: 'Jayson Tatum' },
        ];
      }
      return [];
    });

    const result = await getHistoricalGameTimeline('18447937', {
      skipCache: true,
      store: { getJson: async () => SAMPLE },
    });
    expect(result.available).toBe(true);
    expect(result.events[0]).toMatchObject({
      order: 1,
      category: 'jump_ball',
      primaryPlayerId: '274',
      primaryPlayerName: 'Kawhi Leonard',
    });
    expect(result.officialHomeScore).toBe(99);
    expect(result.officialAwayScore).toBe(118);
    expect(result.events.some((e) => 'coordinate_x' in e)).toBe(false);
  });

  it('hides events when serving quality says Timeline is not available', async () => {
    clearHistoricalTimelineProcessCache();
    queryMock.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('analytics.games')) {
        return [{ season: '2025', home_score: 112, away_score: 101 }];
      }
      if (s.includes('game_flow')) {
        return [
          {
            game_id: '18447390',
            season: '2025',
            source: 'bdl_plays_2025_canonical',
            timeline_available: false,
            score_reconciled: false,
            stream_complete: false,
            stream_class: 'truncated',
            quality_code: 'STREAM_TRUNCATED',
            plays_final_home: 12,
            plays_final_away: 8,
            event_count: 50,
            period_count: 1,
            overtime_count: 0,
            lead_changes: null,
            ties: null,
            largest_home_lead: null,
            largest_away_lead: null,
            largest_home_run: null,
            largest_away_run: null,
            home_points_by_period: [12],
            away_points_by_period: [8],
            rotation_available: false,
            rotation_failure_class: 'BOTH_ON_COURT',
          },
        ];
      }
      return [];
    });
    const result = await getHistoricalGameTimeline('18447390', {
      skipCache: true,
      store: { getJson: async () => SAMPLE },
    });
    expect(result.available).toBe(false);
    expect(result.events).toEqual([]);
    expect(result.quality.rotationContextAvailable).toBe(false);
  });
});
