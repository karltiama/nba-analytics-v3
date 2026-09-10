-- Compact historical starter serving (Step 12C).
-- Grain: one certified starter per (game, team, player).
-- 2025 lineup archive only in the first backfill. Season is not check-constrained
-- so a later certified 2026 archive can insert without replacing this table.
-- Safe to re-run (IF NOT EXISTS).

create table if not exists analytics.game_starters (
  game_id    text not null references analytics.games(game_id) on delete cascade,
  team_id    text not null references analytics.teams(team_id),
  player_id  text not null references analytics.players(player_id),
  position   text,
  season     text not null,
  source     text not null default 'bdl_lineups_archive_2025',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_starters_pk primary key (game_id, team_id, player_id)
);

comment on table analytics.game_starters is
  'Compact certified historical starters. Grain: game_id + team_id + player_id. starter=true from the BDL lineups archive. Top-level archive team.id only — never player.team_id. Names join analytics.players at read time. Uncertified 5-starter games are omitted.';

comment on column analytics.game_starters.team_id is
  'Game-context team from archive top-level team.id, not nested player.team_id.';

comment on column analytics.game_starters.position is
  'Archive position as stored. Empty/null is allowed; do not fabricate.';

comment on column analytics.game_starters.season is
  'analytics.games.season for the game. Initial backfill is 2025 only.';

-- PK (game_id, team_id, player_id) already covers: starters for this historical game.
-- No extra indexes.
