import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_SEASON_SPAN_SQL,
  SCOREBOARD_SEASON_SPAN_SQL,
  isOffseason,
  readOffseason,
  seasonSpans,
  type ScheduleEdge,
} from '@/lib/season/schedule-window';

const HOUR = 60 * 60 * 1000;

function edge(season: string, start: string, end: string): ScheduleEdge {
  return { season, startMs: Date.parse(start), endMs: Date.parse(end) };
}

describe('season schedule window', () => {
  const regular = edge('2026', '2026-10-20T23:00:00.000Z', '2027-04-12T00:30:00.000Z');
  const preseason = edge('2026', '2026-10-10T23:00:00.000Z', '2026-10-16T23:00:00.000Z');
  const prior = edge('2025', '2025-10-21T23:30:00.000Z', '2026-06-14T00:30:00.000Z');

  it('merges preseason and regular tips for the same season', () => {
    const [span] = seasonSpans([regular, preseason]);
    expect(span.startMs).toBe(preseason.startMs);
    expect(span.endMs).toBe(regular.endMs);
  });

  it('hides the offseason banner during preseason, regular season, and playoffs', () => {
    const spans = seasonSpans([prior, preseason, regular]);
    expect(isOffseason(Date.parse('2026-10-12T18:00:00.000Z'), spans)).toBe(false);
    expect(isOffseason(Date.parse('2026-10-21T23:00:00.000Z'), spans)).toBe(false);
    expect(isOffseason(Date.parse('2027-04-12T00:30:00.000Z'), spans)).toBe(false);
    expect(isOffseason(Date.parse('2026-06-01T18:00:00.000Z'), spans)).toBe(false);
  });

  it('keeps a day with no games inside the season span', () => {
    const spans = seasonSpans([regular, preseason]);
    expect(isOffseason(Date.parse('2026-10-18T16:00:00.000Z'), spans)).toBe(false);
    expect(isOffseason(Date.parse('2027-01-06T16:00:00.000Z'), spans)).toBe(false);
  });

  it('shows the banner only between stored seasons', () => {
    const spans = seasonSpans([prior, preseason, regular]);
    expect(isOffseason(Date.parse('2026-07-15T16:00:00.000Z'), spans)).toBe(true);
    expect(isOffseason(Date.parse('2026-10-01T16:00:00.000Z'), spans)).toBe(true);
    expect(isOffseason(Date.parse('2027-06-01T16:00:00.000Z'), spans)).toBe(true);
  });

  it('does not call an empty schedule an offseason', () => {
    expect(isOffseason(Date.parse('2026-07-15T16:00:00.000Z'), [])).toBe(false);
    expect(isOffseason(Number.NaN, seasonSpans([regular]))).toBe(false);
  });

  it('reads both schedule tables and does not write', async () => {
    expect(ANALYTICS_SEASON_SPAN_SQL).toMatch(/FROM analytics\.games/);
    expect(SCOREBOARD_SEASON_SPAN_SQL).toMatch(/FROM display\.scoreboard_games/);
    expect(SCOREBOARD_SEASON_SPAN_SQL).toMatch(/preseason/);
    expect(SCOREBOARD_SEASON_SPAN_SQL).toMatch(/playoffs/);
    expect(`${ANALYTICS_SEASON_SPAN_SQL}\n${SCOREBOARD_SEASON_SPAN_SQL}`).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE)\b/i);

    const calls: string[] = [];
    const db = {
      query: async (sql: string) => {
        calls.push(sql);
        if (sql.includes('analytics.games')) {
          return { rows: [{ season: '2025', first_tip: '2025-10-22T00:00:00.000Z', last_tip: '2026-06-14T00:00:00.000Z' }] };
        }
        return { rows: [{ season: '2026', first_tip: '2026-10-10T23:00:00.000Z', last_tip: new Date('2026-10-16T23:00:00.000Z') }] };
      },
    };
    expect(await readOffseason(db, new Date('2026-10-12T18:00:00.000Z'))).toBe(false);
    expect(await readOffseason(db, new Date(Date.parse('2026-06-14T00:00:00.000Z') + HOUR))).toBe(true);
    expect(calls).toHaveLength(4);
  });
});
