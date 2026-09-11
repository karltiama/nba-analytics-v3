import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GAME_STARTERS_SEASON } from '@/lib/archive/game-starters-from-lineups';
import { PINNED_ANALYTICS_SEASON } from '@/lib/season';
import { POSTGAME_IMPLEMENTED_STAGES } from '../capability';
import { PLAYER_GAME_LOG_UPSERT_SQL, GAME_STARTERS_DELETE_FOR_GAME_SQL, lineupsRawArchiveKey } from '../writes';
import { POSTGAME_TARGET_SEASON, POSTGAME_PROTECTED_SEASONS } from '../worker';

function read(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');
}

describe('13F.3 provider adapters and stage-local guards', () => {
  it('box and starters providers use fetchBdlLive and game_ids[]', () => {
    const box = read('../box-provider.ts');
    const starters = read('../starters-provider.ts');
    expect(box).toContain('fetchBdlLive');
    expect(box).toContain("game_ids[]");
    expect(box).toContain('https://api.balldontlie.io/v1/stats');
    expect(box).not.toMatch(/fetch\(/);
    expect(starters).toContain('fetchBdlLive');
    expect(starters).toContain('game_ids[]');
    expect(starters).not.toMatch(/fetch\(/);
  });

  it('does not implement advanced/plays/game_flow workers', () => {
    expect([...POSTGAME_IMPLEMENTED_STAGES]).toEqual(['box', 'starters']);
    const worker = read('../worker.ts');
    expect(worker).not.toMatch(/parsed\.stage === 'advanced'/);
    expect(worker).not.toMatch(/parsed\.stage === 'plays'/);
    expect(worker).not.toMatch(/parsed\.stage === 'game_flow'/);
  });

  it('keeps product pin 2025 while postgame target is 2026', () => {
    expect(PINNED_ANALYTICS_SEASON).toBe('2025');
    expect(GAME_STARTERS_SEASON).toBe('2025');
    expect(POSTGAME_TARGET_SEASON).toBe('2026');
    expect(POSTGAME_PROTECTED_SEASONS).toEqual(['2023', '2024', '2025']);
  });

  it('PGL upsert is (game_id, player_id) and starters delete is game+season scoped', () => {
    expect(PLAYER_GAME_LOG_UPSERT_SQL).toContain('on conflict (game_id, player_id)');
    expect(PLAYER_GAME_LOG_UPSERT_SQL).toContain('analytics.player_game_logs');
    expect(GAME_STARTERS_DELETE_FOR_GAME_SQL).toContain('where game_id = $1');
    expect(GAME_STARTERS_DELETE_FOR_GAME_SQL).toContain('and season = $2');
    expect(lineupsRawArchiveKey({ season: '2026', gameId: '18450001' })).toBe(
      'raw/source=balldontlie/league=nba/season=2026/entity=lineups/game_id=18450001.json'
    );
  });
});
