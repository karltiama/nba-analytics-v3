-- PREPARED ONLY. Do not apply until an explicit apply step authorizes it.
-- Restricted login for scoreboard-collector, game-status-sync, and nightly-bdl-updater.
-- This file sets no secret and no connection string. The credential is supplied out of band.
-- Apply with psql on a direct or session connection, not the transaction pooler:
--   psql -v ON_ERROR_STOP=1 -f db/roles/court_context_ingest.sql
-- Re-running is safe when the role already matches this definition.
-- An existing role with different attributes, any membership, owned objects, or
-- different role settings stops the script and is left unchanged.

begin;

do $role$
declare
  role_name constant text := 'court_context_ingest';
  existing pg_roles%rowtype;
  member_of text;
begin
  select * into existing
  from pg_roles
  where rolname = role_name;

  if not found then
    create role court_context_ingest
      login
      nosuperuser
      nocreatedb
      nocreaterole
      nobypassrls
      noinherit
      noreplication;
    alter role court_context_ingest set search_path to "$user", public, extensions;
  else
    if existing.rolcanlogin is not true
       or existing.rolsuper
       or existing.rolcreatedb
       or existing.rolcreaterole
       or existing.rolbypassrls
       or existing.rolinherit
       or existing.rolreplication then
      raise exception 'court_context_ingest exists with unexpected role attributes';
    end if;

    select string_agg(granted.rolname, ', ' order by granted.rolname)
      into member_of
    from pg_auth_members membership
    join pg_roles granted on granted.oid = membership.roleid
    join pg_roles member on member.oid = membership.member
    where member.rolname = role_name;

    if member_of is not null then
      raise exception 'court_context_ingest has unexpected membership: %', member_of;
    end if;

    if exists (
      select 1
      from pg_namespace namespace
      join pg_roles owner on owner.oid = namespace.nspowner
      where owner.rolname = role_name
    ) or exists (
      select 1
      from pg_class relation
      join pg_roles owner on owner.oid = relation.relowner
      where owner.rolname = role_name
        and relation.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
    ) then
      raise exception 'court_context_ingest owns database objects';
    end if;

    if existing.rolconfig is distinct from array['search_path="$user", public, extensions']::text[] then
      raise exception 'court_context_ingest has unexpected role settings: %', existing.rolconfig;
    end if;
  end if;
end
$role$;

grant usage on schema raw, analytics, display to court_context_ingest;

grant select, insert, update on table raw.acquisition_requests to court_context_ingest;

grant select, insert, update on table display.scoreboard_games to court_context_ingest;
grant select, insert, update on table display.scoreboard_game_odds to court_context_ingest;
grant select, insert, update on table display.scoreboard_odds_state to court_context_ingest;
grant select, insert, update on table display.scoreboard_collector_state to court_context_ingest;
grant select, insert, update, delete on table display.scoreboard_player_lines to court_context_ingest;

grant select, insert, update on table raw.games to court_context_ingest;
grant select, insert, update on table raw.players to court_context_ingest;
grant select, insert, update on table raw.game_period_scores to court_context_ingest;
grant select, insert, update on table analytics.players to court_context_ingest;
grant select, insert, update on table analytics.games to court_context_ingest;
grant select, insert, update on table analytics.player_game_logs to court_context_ingest;
grant select, insert, update on table analytics.team_game_stats to court_context_ingest;
grant select, insert, update on table analytics.team_season_averages to court_context_ingest;
grant select, insert, update on table analytics.player_season_averages to court_context_ingest;
grant select, insert, update on table analytics.player_period_scoring to court_context_ingest;

grant select, insert on table raw.player_game_stat_document to court_context_ingest;
grant select, insert, update on table raw.player_game_stats_row to court_context_ingest;
grant usage, select on sequence raw.player_game_stat_document_document_id_seq to court_context_ingest;

-- Production identity arguments from pg_get_function_identity_arguments, PostgreSQL 17.6:
-- upsert_player_game_stat(p_id integer, p_min text, p_fgm integer, p_fga integer,
--   p_fg_pct numeric, p_fg3m integer, p_fg3a integer, p_fg3_pct numeric, p_ftm integer,
--   p_fta integer, p_ft_pct numeric, p_oreb integer, p_dreb integer, p_reb integer,
--   p_ast integer, p_stl integer, p_blk integer, p_turnover integer, p_pf integer,
--   p_pts integer, p_plus_minus integer, p_player_id integer, p_team_id integer,
--   p_game_id integer, p_player jsonb, p_team jsonb, p_game jsonb)
-- upsert_player_game_stat_document(p_document jsonb)
grant execute on function raw.upsert_player_game_stat(
  integer, text, integer, integer, numeric, integer, integer, numeric,
  integer, integer, numeric, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, integer, integer,
  jsonb, jsonb, jsonb
) to court_context_ingest;
grant execute on function raw.upsert_player_game_stat_document(jsonb) to court_context_ingest;

commit;
