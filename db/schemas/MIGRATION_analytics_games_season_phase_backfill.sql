-- PREPARED ONLY (COURT_CONTEXT_PHASE_1B3). NOT APPLIED. Run only after
-- MIGRATION_analytics_games_season_phase.sql, as its own approved step.
--
-- Historical season_phase backfill for seasons 2023, 2024 and 2025 only.
-- Season 2026 is never touched here: its labels come only from game-status-sync requests
-- with an explicit season_type (source request_season_type / provider_ist_stage).
--
-- Rerunnable: only rows still UNCLASSIFIED are updated; a second run updates 0 rows.
-- Every label written here carries season_phase_source = 'historical_backfill_v1'.
--
-- Evidence per game (analytics.games joined to raw.games by provider id):
--   ET tip date      analytics.games.start_time at America/New_York
--   provider flag    raw.games.postseason (present for 2025 only; 2023/2024 have no raw.games rows)
--   BDL convention   postseason=true marks playoff games only; play-in games are postseason=false
--                    (2025: the 6 play-in games are false, every game from 2026-04-18 is true).
--
-- Classification (first match wins):
--   ET date < opening night                               PRESEASON
--   ET date = NBA Cup championship date                   left UNCLASSIFIED (see below)
--   ET date < play-in start  and postseason is not true   REGULAR
--   play-in start <= ET date < playoffs start
--                            and postseason is not true   PLAYIN
--   ET date >= playoffs start and postseason is not false PLAYOFFS
--   anything else (provider flag contradicts calendar)    left UNCLASSIFIED
--
-- Cannot be established from stored data, so never labelled here:
--   * NBA Cup (IST) membership. No ist_stage is stored anywhere. Cup group and knockout games
--     are regular-season games and are labelled REGULAR; the IST sub-label is not recoverable.
--   * The NBA Cup championship game (one per season, alone on its date). It is not a
--     regular-season game, and its IST label is not evidenced by stored data. Stays UNCLASSIFIED.
--
-- Safety: the plan must reconcile with the fixed NBA format before anything is written.
-- Per season: exactly 1230 REGULAR, exactly 6 PLAYIN, 0 PRESEASON, exactly 1 unresolved
-- (the Cup championship), and no existing label that disagrees with the plan.
-- Any mismatch raises and the whole transaction rolls back.
--
-- Rollback (labels only; schema untouched):
--   update analytics.games set season_phase = 'UNCLASSIFIED', season_phase_source = null
--   where season_phase_source = 'historical_backfill_v1';

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create temp table season_phase_backfill_plan on commit drop as
with cal(season, open_et, playin_et, playoffs_et, cup_final_et) as (
  values
    ('2023', date '2023-10-24', date '2024-04-16', date '2024-04-20', date '2023-12-09'),
    ('2024', date '2024-10-22', date '2025-04-15', date '2025-04-19', date '2024-12-17'),
    ('2025', date '2025-10-21', date '2026-04-14', date '2026-04-18', date '2025-12-16')
),
g as (
  select
    a.game_id,
    a.season,
    a.season_phase as current_phase,
    (a.start_time at time zone 'America/New_York')::date as et,
    r.postseason,
    c.open_et, c.playin_et, c.playoffs_et, c.cup_final_et
  from analytics.games a
  join cal c on c.season = a.season
  left join raw.games r on r.id::text = a.game_id
)
select
  game_id,
  season,
  current_phase,
  case
    when et is null then null
    when et < open_et then 'PRESEASON'
    when et = cup_final_et then null
    when et < playin_et and postseason is not true then 'REGULAR'
    when et >= playin_et and et < playoffs_et and postseason is not true then 'PLAYIN'
    when et >= playoffs_et and postseason is not false then 'PLAYOFFS'
    else null
  end as planned_phase
from g;

do $$
declare
  bad text;
begin
  select string_agg(format('%s: regular=%s playin=%s preseason=%s unresolved=%s',
                           season, regular, playin, preseason, unresolved), '; ')
    into bad
  from (
    select season,
           count(*) filter (where planned_phase = 'REGULAR') as regular,
           count(*) filter (where planned_phase = 'PLAYIN') as playin,
           count(*) filter (where planned_phase = 'PRESEASON') as preseason,
           count(*) filter (where planned_phase is null) as unresolved
    from season_phase_backfill_plan
    group by season
  ) s
  where regular <> 1230 or playin <> 6 or preseason <> 0 or unresolved <> 1;
  if bad is not null then
    raise exception 'season_phase backfill reconciliation failed: %', bad;
  end if;

  if (select count(distinct season) from season_phase_backfill_plan) <> 3 then
    raise exception 'season_phase backfill expected seasons 2023, 2024 and 2025';
  end if;

  select string_agg(game_id || ':' || current_phase || '->' || coalesce(planned_phase, 'UNCLASSIFIED'), ', ')
    into bad
  from season_phase_backfill_plan
  where current_phase <> 'UNCLASSIFIED'
    and current_phase is distinct from planned_phase;
  if bad is not null then
    raise exception 'season_phase backfill conflicts with existing labels: %', bad;
  end if;
end $$;

update analytics.games a
set season_phase = p.planned_phase,
    season_phase_source = 'historical_backfill_v1'
from season_phase_backfill_plan p
where p.game_id = a.game_id
  and p.planned_phase is not null
  and a.season_phase = 'UNCLASSIFIED';

commit;
