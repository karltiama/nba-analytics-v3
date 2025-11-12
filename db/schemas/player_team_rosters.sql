-- PLAYER TEAM ROSTERS
-- Tracks team assignments for each player by season.
create table if not exists player_team_rosters (
  player_id   text not null references players(player_id) on delete cascade,
  team_id     text not null references teams(team_id) on delete cascade,
  season      text not null,
  active      boolean,
  jersey      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (player_id, season)
);

create index if not exists player_team_rosters_team_season_idx
  on player_team_rosters (team_id, season);

