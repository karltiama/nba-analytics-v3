import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { classifyAppearance } from '@/lib/betting/minutes-projection-eval';
import { classifyWowyAppearance } from '../appearance';

describe('WOWY appearance vs established classifyAppearance', () => {
  const cases = ['00', '0', '0.0', '32', 'DNP', null, 12];

  it('matches minutes-projection-eval class and reason for DNP/played tokens', () => {
    for (const minutes of cases) {
      const log = {
        game_id: 'g',
        player_id: 'p',
        start_time: '2025-01-01T00:00:00.000Z',
        season: '2024',
        minutes,
        points: 0,
        rebounds: 0,
        assists: 0,
        three_pointers_made: 0,
      };
      const established = classifyAppearance(log);
      const local = classifyWowyAppearance(log);
      expect(local.class).toBe(established.class);
      expect(local.reason).toBe(established.reason);
    }
  });
});
