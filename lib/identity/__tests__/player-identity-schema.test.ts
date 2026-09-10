import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(process.cwd(), 'db/schemas/MIGRATION_player_identity_canonical.sql'),
  'utf8'
);

describe('MIGRATION_player_identity_canonical.sql', () => {
  it('is additive identity infrastructure only', () => {
    expect(sql).toContain('create table if not exists analytics.player_identity_unresolved');
    expect(sql).toContain("unique (provider, provider_player_id, source_context)");
    expect(sql).toContain('UNRESOLVED');
    expect(sql).toContain('CONFLICT');
    expect(sql).toContain('RESOLVED');
    expect(sql).toContain('BOX_SCORE');
    expect(sql).toContain('PLAYER_PROP');
    expect(sql).toContain('Do not GRANT to anon');
    expect(sql).toContain('Do not ENABLE ROW LEVEL SECURITY');
    expect(sql).not.toContain('alter table analytics.player_game_logs');
    expect(sql).not.toContain('alter table analytics.player_game_advanced');
    expect(sql).not.toContain('alter table analytics.player_role_profile');
    expect(sql).not.toContain('alter table analytics.game_starters');
    expect(sql).not.toContain('alter table analytics.player_prop');
    expect(sql).not.toContain('alter table analytics.players add');
  });
});
