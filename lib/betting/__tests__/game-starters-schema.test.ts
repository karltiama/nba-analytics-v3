import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'db/schemas/MIGRATION_game_starters.sql'), 'utf8');

describe('MIGRATION_game_starters.sql', () => {
  it('uses the compact game+team+player grain and does not store names or nested JSON', () => {
    expect(sql).toContain('create table if not exists analytics.game_starters');
    expect(sql).toContain('constraint game_starters_pk primary key (game_id, team_id, player_id)');
    expect(sql).toContain('references analytics.games(game_id)');
    expect(sql).toContain('references analytics.teams(team_id)');
    expect(sql).toContain('references analytics.players(player_id)');
    expect(sql).not.toContain('player_name');
    expect(sql).not.toContain('jsonb');
    expect(sql).toMatch(/never player\.team_id/);
    expect(sql).toContain('No extra indexes');
  });
});
