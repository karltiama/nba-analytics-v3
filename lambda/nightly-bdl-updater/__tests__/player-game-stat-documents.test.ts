import { describe, expect, it } from 'vitest';
import {
  normalizedPlayerGameStatsEnabled,
  playerGameStatDeleteSql,
  playerGameStatWriteSql,
} from '../player-game-stat-documents';

describe('player game stat writer selection', () => {
  it('keeps the legacy table while the flag is off', () => {
    expect(normalizedPlayerGameStatsEnabled({})).toBe(false);
    expect(normalizedPlayerGameStatsEnabled({ PGS_NORMALIZED_STORAGE: '0' })).toBe(false);
    const write = playerGameStatWriteSql({});
    const remove = playerGameStatDeleteSql({});
    expect(write.includes('insert into raw.player_game_stats')).toBe(true);
    expect(write.includes('upsert_player_game_stat')).toBe(false);
    expect(write.includes('player_game_stats_row')).toBe(false);
    expect(remove).toBe('delete from raw.player_game_stats where game_id = $1');
  });

  it('selects the normalized statements only when the flag is exactly 1', () => {
    const env = { PGS_NORMALIZED_STORAGE: '1' };
    expect(playerGameStatWriteSql(env).includes('raw.upsert_player_game_stat')).toBe(true);
    expect(playerGameStatDeleteSql(env)).toBe('delete from raw.player_game_stats_row where game_id = $1');
  });
});
