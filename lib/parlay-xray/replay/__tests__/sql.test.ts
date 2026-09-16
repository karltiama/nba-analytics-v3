import { describe, expect, it } from 'vitest';
import {
  HISTORICAL_REPLAY_COVERAGE_SQL,
  HISTORICAL_REPLAY_LOOKUP_SQL,
  assertReplaySqlIsOutcomeFree,
} from '../sql';
import { playerMarketMovementSql } from '@/lib/betting/market-movement-api';

describe('historical replay SQL safety', () => {
  it('reuses the certified market-movement lookup and does not read outcomes', () => {
    expect(HISTORICAL_REPLAY_LOOKUP_SQL).toBe(playerMarketMovementSql());
    expect(HISTORICAL_REPLAY_LOOKUP_SQL).toMatch(/analytics\.player_prop_market_movement/);
    expect(HISTORICAL_REPLAY_LOOKUP_SQL).toMatch(/game_id = \$1/);
    expect(HISTORICAL_REPLAY_LOOKUP_SQL).toMatch(/player_id = \$2/);
    expect(HISTORICAL_REPLAY_LOOKUP_SQL).toMatch(/prop_type = \$3/);
    expect(HISTORICAL_REPLAY_LOOKUP_SQL).not.toMatch(/player_game_logs/);
    expect(HISTORICAL_REPLAY_LOOKUP_SQL).not.toMatch(/home_score|away_score/);
    expect(() => assertReplaySqlIsOutcomeFree(HISTORICAL_REPLAY_LOOKUP_SQL)).not.toThrow();
    expect(() => assertReplaySqlIsOutcomeFree(HISTORICAL_REPLAY_COVERAGE_SQL)).not.toThrow();
  });

  it('rejects outcome-leaking SQL', () => {
    expect(() =>
      assertReplaySqlIsOutcomeFree('select pts from analytics.player_game_logs')
    ).toThrow(/player_game_logs/);
    expect(() =>
      assertReplaySqlIsOutcomeFree('select home_score from analytics.games')
    ).toThrow(/home_score/);
  });
});
