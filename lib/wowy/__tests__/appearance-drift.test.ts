import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { classifyAppearance } from '@/lib/betting/minutes-projection-eval';
import { classifyWowyAppearance } from '../appearance';

const log = (minutes: string | number | null, points = 0) => ({
  game_id: 'g',
  player_id: 'p',
  start_time: '2025-01-01T00:00:00.000Z',
  season: '2024',
  minutes,
  points,
  rebounds: 0,
  assists: 0,
  three_pointers_made: 0,
});

describe('WOWY appearance vs established classifyAppearance', () => {
  it('matches minutes-projection-eval class and reason for DNP/played tokens', () => {
    const cases: Array<[string | number | null, number]> = [
      ['00', 0],
      ['0', 2],
      ['0.0', 2],
      ['32', 0],
      ['22:51', 0],
      ['0:30', 0],
      ['DNP', 0],
      [null, 0],
      [12, 0],
    ];
    for (const [minutes, points] of cases) {
      const established = classifyAppearance(log(minutes, points));
      const local = classifyWowyAppearance(log(minutes, points));
      expect(local.class).toBe(established.class);
      expect(local.reason).toBe(established.reason);
    }
  });

  it('both treat "0" with no stats as a DNP (2026-27 BallDontLie token)', () => {
    for (const token of ['0', '0.0']) {
      for (const classify of [classifyWowyAppearance, classifyAppearance]) {
        expect(classify(log(token)).class).toBe('dnp');
        expect(classify(log(token)).reason).toBe('zero_minutes_no_box');
      }
    }
  });

  it('parses clock minutes in both', () => {
    expect(classifyWowyAppearance(log('22:51')).minutes).toBeCloseTo(22.85, 10);
    expect(classifyAppearance(log('22:51')).minutes).toBeCloseTo(22.85, 10);
  });
});
