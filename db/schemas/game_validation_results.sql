-- GAME VALIDATION RESULTS
-- Stores per-game, per-check validation outcomes for player stats accuracy
-- Each row = one check for one game (upsertable via UNIQUE constraint)
-- Populated by scripts/validate-player-stats.ts

create table if not exists game_validation_results (
  id              bigserial primary key,
  game_id         text not null,            -- bbref_game_id
  check_name      text not null,            -- e.g. 'score_reconciliation', 'points_formula'
  status          text not null,            -- 'pass' | 'fail' | 'warn'
  severity        text not null,            -- 'error' | 'warning' | 'info'
  details         jsonb,                    -- { team_id, player_id, expected, actual, message, failures[] }
  validated_at    timestamptz not null default now(),
  constraint game_validation_results_unique unique (game_id, check_name),
  constraint game_validation_results_status_check check (status in ('pass', 'fail', 'warn')),
  constraint game_validation_results_severity_check check (severity in ('error', 'warning', 'info'))
);

create index if not exists game_validation_results_game_idx
  on game_validation_results (game_id);

create index if not exists game_validation_results_status_idx
  on game_validation_results (status)
  where status != 'pass';

create index if not exists game_validation_results_check_idx
  on game_validation_results (check_name, status);
