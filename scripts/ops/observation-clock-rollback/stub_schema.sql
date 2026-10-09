-- Schema-only stubs with production column types (captured read-only 2026-10-09). No production data.
-- Local verification only: loaded by verify-rollback.ps1 into a throwaway cluster.
create schema raw;
create schema analytics;
create schema research;

create table analytics.games (game_id text primary key, start_time timestamp with time zone, status text);

create table analytics.player_props_current (id uuid, game_id integer, player_id integer, player_name text, team_id integer, sportsbook text, prop_type text, market_type text, side text, line_value numeric, odds_american integer, odds_decimal numeric, implied_probability numeric, snapshot_at timestamp with time zone);

create table raw.player_prop_snapshots_v2 (id uuid, game_id integer, player_id integer, player_name text, team_id integer, sportsbook text, prop_type text, market_type text, side text, line_value numeric, odds_american integer, odds_decimal numeric, implied_probability numeric, fetched_at timestamp with time zone, raw_json jsonb, pull_run_id bigint);

create table research.prop_decision_lines (game_id text, player_id text, player_name text, team_id integer, sportsbook text, prop_type text, market_type text, side text, line_value numeric, odds_american integer, odds_decimal numeric, implied_probability numeric, decision_at timestamp with time zone, game_start_time timestamp with time zone, materialized_at timestamp with time zone);

create table research.v_player_game_outcomes (game_id text, player_id text, game_date date, game_start_time timestamp with time zone, pts numeric, reb numeric, ast numeric, threes numeric, pra numeric, pa numeric, pr numeric, ra numeric);

insert into analytics.games values ('1', '2025-01-01T00:00:00Z', 'Final'), ('2', '2025-01-02T00:00:00Z', 'Final');
insert into research.prop_decision_lines (game_id, player_id, player_name, team_id, sportsbook, prop_type, market_type, side, line_value, decision_at, game_start_time)
values ('1', '10', 'A', 1, 'bk', 'points', 'over_under', 'over', 20.5, '2024-12-31T23:00:00Z', '2025-01-01T00:00:00Z'),
       ('1', '10', 'A', 1, 'bk', 'points', 'over_under', 'under', 20.5, '2024-12-31T23:00:00Z', '2025-01-01T00:00:00Z'),
       ('2', '11', 'B', 2, 'bk', 'rebounds', 'over_under', 'over', 8.5, '2025-01-01T23:00:00Z', '2025-01-02T00:00:00Z');
insert into research.v_player_game_outcomes (game_id, player_id, game_date, pts, reb) values ('1', '10', '2025-01-01', 25, 5);
