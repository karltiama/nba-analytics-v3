-- Recovery for MIGRATION_player_prop_observation_clock.sql (Phase 1B.5B Gate 1).
-- Runbook: docs/player-prop-observation-clock-runbook.md
-- Restores the exact pre-migration production definitions captured read-only on 2026-10-09:
--   pg_get_viewdef md5 v_prop_decision_lines = 499b7eb810b98a50518c9a69f1b3b141
--   pg_get_viewdef md5 v_prop_eval_units     = 46dae27e91dedba1f75f3daaa92234f5
-- CREATE OR REPLACE VIEW cannot drop decision_clock, so both views are dropped and recreated.
-- Refuses to run once any observation-clock value has been written (would destroy data).

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from raw.player_prop_snapshots_v2
             where observation_clock is not null or observed_at is not null
                or controller_enqueued_at is not null or provider_updated_at is not null)
     or exists (select 1 from analytics.player_props_current
                where observation_clock is not null or observed_at is not null
                   or controller_enqueued_at is not null or provider_updated_at is not null)
     or exists (select 1 from research.prop_decision_lines where decision_clock is not null) then
    raise exception 'observation-clock values present; rollback refused';
  end if;
end $$;

drop view research.v_prop_eval_units;
drop view research.v_prop_decision_lines;

alter table raw.player_prop_snapshots_v2
  drop constraint if exists player_prop_snapshots_v2_observation_clock_check,
  drop column if exists observed_at,
  drop column if exists controller_enqueued_at,
  drop column if exists provider_updated_at,
  drop column if exists observation_clock;

alter table analytics.player_props_current
  drop constraint if exists player_props_current_observation_clock_check,
  drop column if exists observed_at,
  drop column if exists controller_enqueued_at,
  drop column if exists provider_updated_at,
  drop column if exists observation_clock;

alter table research.prop_decision_lines
  drop constraint if exists prop_decision_lines_decision_clock_check,
  drop column if exists decision_clock;

comment on column raw.player_prop_snapshots_v2.fetched_at is null;
comment on column analytics.player_props_current.snapshot_at is null;

create view research.v_prop_decision_lines as
 SELECT prop_decision_lines.game_id,
    prop_decision_lines.player_id,
    prop_decision_lines.player_name,
    prop_decision_lines.team_id,
    prop_decision_lines.sportsbook,
    prop_decision_lines.prop_type,
    prop_decision_lines.market_type,
    prop_decision_lines.side,
    prop_decision_lines.line_value,
    prop_decision_lines.odds_american,
    prop_decision_lines.odds_decimal,
    prop_decision_lines.implied_probability,
    prop_decision_lines.decision_at,
    prop_decision_lines.game_start_time
   FROM research.prop_decision_lines
UNION ALL
 SELECT live.game_id,
    live.player_id,
    live.player_name,
    live.team_id,
    live.sportsbook,
    live.prop_type,
    live.market_type,
    live.side,
    live.line_value,
    live.odds_american,
    live.odds_decimal,
    live.implied_probability,
    live.decision_at,
    live.game_start_time
   FROM ( SELECT DISTINCT ON (r.game_id, r.player_id, r.sportsbook, r.prop_type, r.side) g.game_id,
            r.player_id::text AS player_id,
            r.player_name,
            r.team_id,
            r.sportsbook,
            r.prop_type,
            r.market_type,
            r.side,
            r.line_value,
            r.odds_american,
            r.odds_decimal,
            r.implied_probability,
            r.fetched_at AS decision_at,
            g.start_time AS game_start_time
           FROM raw.player_prop_snapshots_v2 r
             JOIN analytics.games g ON g.game_id = r.game_id::text
          WHERE g.status = 'Final'::text AND g.start_time IS NOT NULL AND r.fetched_at < g.start_time AND lower(COALESCE(r.market_type, ''::text)) = 'over_under'::text AND (lower(r.side) = ANY (ARRAY['over'::text, 'under'::text])) AND NOT (EXISTS ( SELECT 1
                   FROM research.prop_decision_lines m
                  WHERE m.game_id = g.game_id AND m.player_id = r.player_id::text AND m.sportsbook = r.sportsbook AND m.prop_type = r.prop_type AND m.side = r.side))
          ORDER BY r.game_id, r.player_id, r.sportsbook, r.prop_type, r.side, r.fetched_at DESC, r.pull_run_id DESC NULLS LAST) live;

comment on view research.v_prop_decision_lines is
  'Closing-line proxy: materialized rows + live raw fallback for unmaterialized Final games.';

create view research.v_prop_eval_units as
 WITH joined AS (
         SELECT d.game_id,
            d.player_id,
            d.player_name,
            o.game_date,
            d.sportsbook,
            d.prop_type,
            d.side,
            d.line_value,
            d.decision_at,
            d.odds_american,
            d.odds_decimal,
            d.implied_probability,
            d.game_start_time,
                CASE lower(TRIM(BOTH FROM d.prop_type))
                    WHEN 'points'::text THEN o.pts
                    WHEN 'pts'::text THEN o.pts
                    WHEN 'rebounds'::text THEN o.reb
                    WHEN 'reb'::text THEN o.reb
                    WHEN 'assists'::text THEN o.ast
                    WHEN 'ast'::text THEN o.ast
                    WHEN 'threes'::text THEN o.threes
                    WHEN 'points_rebounds_assists'::text THEN o.pra
                    WHEN 'pra'::text THEN o.pra
                    WHEN 'points_assists'::text THEN o.pa
                    WHEN 'pa'::text THEN o.pa
                    WHEN 'points_rebounds'::text THEN o.pr
                    WHEN 'pr'::text THEN o.pr
                    WHEN 'rebounds_assists'::text THEN o.ra
                    WHEN 'ra'::text THEN o.ra
                    ELSE NULL::numeric
                END AS stat_actual
           FROM research.v_prop_decision_lines d
             JOIN research.v_player_game_outcomes o ON o.game_id = d.game_id AND o.player_id = d.player_id
        )
 SELECT game_id,
    player_id,
    player_name,
    game_date,
    sportsbook,
    prop_type,
    side,
    line_value,
    decision_at,
    odds_american,
    odds_decimal,
    implied_probability,
    game_start_time,
    stat_actual,
        CASE
            WHEN stat_actual IS NULL THEN NULL::boolean
            WHEN lower(side) = 'over'::text THEN stat_actual > line_value
            WHEN lower(side) = 'under'::text THEN stat_actual < line_value
            ELSE NULL::boolean
        END AS bet_won
   FROM joined;

comment on view research.v_prop_eval_units is
  'Pre-start line + outcome + win flag. Filter game_date for train/test holdout.';

commit;
