-- Stage A only. Creates the document dictionary and stat-row table beside raw.player_game_stats.
-- Does not alter, rename, or delete the original table.
-- Does not enable RLS and does not GRANT to anon. Owner permissions stay the default.
-- Stage B (switch readers and writers) and Stage C (drop the old heap) are not in this file.
--
-- Document identity is the jsonb value. content_md5 is only a lookup key.
-- A matching md5 with a different jsonb raises player_game_stat_document_hash_collision
-- and does not reuse the row. Player, team, and game ids stay on the stat row, so the
-- same entity id can point at more than one document.
-- Foreign keys are ON DELETE RESTRICT. Deleting a stat row does not delete a document.

create table if not exists raw.player_game_stat_document (
  document_id   bigint generated always as identity primary key,
  content_md5   text not null,
  document      jsonb not null,
  created_at    timestamptz not null default now(),
  constraint player_game_stat_document_md5_key unique (content_md5)
);

comment on table raw.player_game_stat_document is
  'Distinct jsonb values from raw player-game stats. Identity is the jsonb value, not a player, team, or game id.';

create table if not exists raw.player_game_stats_row (
  id                  integer primary key,
  min                 text,
  fgm                 integer,
  fga                 integer,
  fg_pct              numeric,
  fg3m                integer,
  fg3a                integer,
  fg3_pct             numeric,
  ftm                 integer,
  fta                 integer,
  ft_pct              numeric,
  oreb                integer,
  dreb                integer,
  reb                 integer,
  ast                 integer,
  stl                 integer,
  blk                 integer,
  turnover            integer,
  pf                  integer,
  pts                 integer,
  plus_minus          integer,
  player_id           integer,
  team_id             integer,
  game_id             integer,
  created_at          timestamptz not null default now(),
  player_document_id  bigint references raw.player_game_stat_document (document_id) on delete restrict,
  team_document_id    bigint references raw.player_game_stat_document (document_id) on delete restrict,
  game_document_id    bigint references raw.player_game_stat_document (document_id) on delete restrict
);

create index if not exists player_game_stats_row_game_id_idx
  on raw.player_game_stats_row (game_id);
create index if not exists player_game_stats_row_player_id_idx
  on raw.player_game_stats_row (player_id);
create index if not exists player_game_stats_row_player_document_idx
  on raw.player_game_stats_row (player_document_id);
create index if not exists player_game_stats_row_team_document_idx
  on raw.player_game_stats_row (team_document_id);
create index if not exists player_game_stats_row_game_document_idx
  on raw.player_game_stats_row (game_document_id);

comment on table raw.player_game_stats_row is
  'Scalar player-game stat rows. JSON values are referenced, not stored again on each row.';

create or replace function raw.upsert_player_game_stat_document(p_document jsonb)
returns bigint
language plpgsql
set search_path = raw, pg_catalog
as $$
declare
  v_md5 text;
  v_id bigint;
  v_existing jsonb;
begin
  if p_document is null then
    return null;
  end if;
  v_md5 := md5(p_document::text);
  select document_id, document into v_id, v_existing
    from raw.player_game_stat_document
   where content_md5 = v_md5;
  if v_id is not null then
    if v_existing is distinct from p_document then
      raise exception 'player_game_stat_document_hash_collision'
        using errcode = '23505';
    end if;
    return v_id;
  end if;
  insert into raw.player_game_stat_document (content_md5, document)
  values (v_md5, p_document)
  on conflict (content_md5) do nothing
  returning document_id into v_id;
  if v_id is null then
    select document_id, document into v_id, v_existing
      from raw.player_game_stat_document
     where content_md5 = v_md5;
    if v_existing is distinct from p_document then
      raise exception 'player_game_stat_document_hash_collision'
        using errcode = '23505';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function raw.upsert_player_game_stat(
  p_id integer,
  p_min text,
  p_fgm integer,
  p_fga integer,
  p_fg_pct numeric,
  p_fg3m integer,
  p_fg3a integer,
  p_fg3_pct numeric,
  p_ftm integer,
  p_fta integer,
  p_ft_pct numeric,
  p_oreb integer,
  p_dreb integer,
  p_reb integer,
  p_ast integer,
  p_stl integer,
  p_blk integer,
  p_turnover integer,
  p_pf integer,
  p_pts integer,
  p_plus_minus integer,
  p_player_id integer,
  p_team_id integer,
  p_game_id integer,
  p_player jsonb,
  p_team jsonb,
  p_game jsonb
) returns void
language plpgsql
set search_path = raw, pg_catalog
as $$
declare
  v_player bigint;
  v_team bigint;
  v_game bigint;
begin
  v_player := raw.upsert_player_game_stat_document(p_player);
  v_team := raw.upsert_player_game_stat_document(p_team);
  v_game := raw.upsert_player_game_stat_document(p_game);
  insert into raw.player_game_stats_row (
    id, min, fgm, fga, fg_pct, fg3m, fg3a, fg3_pct, ftm, fta, ft_pct,
    oreb, dreb, reb, ast, stl, blk, turnover, pf, pts, plus_minus,
    player_id, team_id, game_id, player_document_id, team_document_id, game_document_id
  ) values (
    p_id, p_min, p_fgm, p_fga, p_fg_pct, p_fg3m, p_fg3a, p_fg3_pct, p_ftm, p_fta, p_ft_pct,
    p_oreb, p_dreb, p_reb, p_ast, p_stl, p_blk, p_turnover, p_pf, p_pts, p_plus_minus,
    p_player_id, p_team_id, p_game_id, v_player, v_team, v_game
  )
  on conflict (id) do update set
    min = excluded.min, fgm = excluded.fgm, fga = excluded.fga, fg_pct = excluded.fg_pct,
    fg3m = excluded.fg3m, fg3a = excluded.fg3a, fg3_pct = excluded.fg3_pct,
    ftm = excluded.ftm, fta = excluded.fta, ft_pct = excluded.ft_pct,
    oreb = excluded.oreb, dreb = excluded.dreb, reb = excluded.reb,
    ast = excluded.ast, stl = excluded.stl, blk = excluded.blk,
    turnover = excluded.turnover, pf = excluded.pf, pts = excluded.pts, plus_minus = excluded.plus_minus,
    player_id = excluded.player_id, team_id = excluded.team_id, game_id = excluded.game_id,
    player_document_id = excluded.player_document_id,
    team_document_id = excluded.team_document_id,
    game_document_id = excluded.game_document_id
  where player_game_stats_row.min is distinct from excluded.min
     or player_game_stats_row.fgm is distinct from excluded.fgm
     or player_game_stats_row.fga is distinct from excluded.fga
     or player_game_stats_row.fg_pct is distinct from excluded.fg_pct
     or player_game_stats_row.fg3m is distinct from excluded.fg3m
     or player_game_stats_row.fg3a is distinct from excluded.fg3a
     or player_game_stats_row.fg3_pct is distinct from excluded.fg3_pct
     or player_game_stats_row.ftm is distinct from excluded.ftm
     or player_game_stats_row.fta is distinct from excluded.fta
     or player_game_stats_row.ft_pct is distinct from excluded.ft_pct
     or player_game_stats_row.oreb is distinct from excluded.oreb
     or player_game_stats_row.dreb is distinct from excluded.dreb
     or player_game_stats_row.reb is distinct from excluded.reb
     or player_game_stats_row.ast is distinct from excluded.ast
     or player_game_stats_row.stl is distinct from excluded.stl
     or player_game_stats_row.blk is distinct from excluded.blk
     or player_game_stats_row.turnover is distinct from excluded.turnover
     or player_game_stats_row.pf is distinct from excluded.pf
     or player_game_stats_row.pts is distinct from excluded.pts
     or player_game_stats_row.plus_minus is distinct from excluded.plus_minus
     or player_game_stats_row.player_id is distinct from excluded.player_id
     or player_game_stats_row.team_id is distinct from excluded.team_id
     or player_game_stats_row.game_id is distinct from excluded.game_id
     or player_game_stats_row.player_document_id is distinct from excluded.player_document_id
     or player_game_stats_row.team_document_id is distinct from excluded.team_document_id
     or player_game_stats_row.game_document_id is distinct from excluded.game_document_id;
end;
$$;

create or replace view raw.player_game_stats_resolved as
select
  s.id, s.min, s.fgm, s.fga, s.fg_pct, s.fg3m, s.fg3a, s.fg3_pct, s.ftm, s.fta, s.ft_pct,
  s.oreb, s.dreb, s.reb, s.ast, s.stl, s.blk, s.turnover, s.pf, s.pts, s.plus_minus,
  s.player_id, s.team_id, s.game_id,
  p.document as player,
  t.document as team,
  g.document as game,
  s.created_at
from raw.player_game_stats_row s
left join raw.player_game_stat_document p on p.document_id = s.player_document_id
left join raw.player_game_stat_document t on t.document_id = s.team_document_id
left join raw.player_game_stat_document g on g.document_id = s.game_document_id;

comment on view raw.player_game_stats_resolved is
  'Read contract for the normalized stat rows. Same column order as raw.player_game_stats. Writers do not insert through this view.';

create or replace function raw.copy_player_game_stats_documents()
returns table (stat_rows bigint, document_rows bigint, mismatched_rows bigint)
language plpgsql
set search_path = raw, pg_catalog
as $$
declare
  v_collision bigint;
  v_mismatch bigint;
  v_stats bigint;
  v_docs bigint;
begin
  lock table raw.player_game_stats in share row exclusive mode;
  select count(*) into v_collision
    from (
      select md5(document::text) as content_md5
        from (
          select player as document from raw.player_game_stats where player is not null
          union
          select team from raw.player_game_stats where team is not null
          union
          select game from raw.player_game_stats where game is not null
        ) docs
       group by md5(document::text)
      having count(distinct document) > 1
    ) collisions;
  if v_collision > 0 then
    raise exception 'player_game_stat_document_hash_collision'
      using errcode = '23505';
  end if;

  insert into raw.player_game_stat_document (content_md5, document)
  select md5(document::text), document
    from (
      select player as document from raw.player_game_stats where player is not null
      union
      select team from raw.player_game_stats where team is not null
      union
      select game from raw.player_game_stats where game is not null
    ) docs
  on conflict (content_md5) do nothing;

  insert into raw.player_game_stats_row (
    id, min, fgm, fga, fg_pct, fg3m, fg3a, fg3_pct, ftm, fta, ft_pct,
    oreb, dreb, reb, ast, stl, blk, turnover, pf, pts, plus_minus,
    player_id, team_id, game_id, created_at,
    player_document_id, team_document_id, game_document_id
  )
  select
    s.id, s.min, s.fgm, s.fga, s.fg_pct, s.fg3m, s.fg3a, s.fg3_pct, s.ftm, s.fta, s.ft_pct,
    s.oreb, s.dreb, s.reb, s.ast, s.stl, s.blk, s.turnover, s.pf, s.pts, s.plus_minus,
    s.player_id, s.team_id, s.game_id, s.created_at,
    p.document_id, t.document_id, g.document_id
  from raw.player_game_stats s
  left join raw.player_game_stat_document p
    on s.player is not null
   and p.content_md5 = md5(s.player::text)
   and p.document is not distinct from s.player
  left join raw.player_game_stat_document t
    on s.team is not null
   and t.content_md5 = md5(s.team::text)
   and t.document is not distinct from s.team
  left join raw.player_game_stat_document g
    on s.game is not null
   and g.content_md5 = md5(s.game::text)
   and g.document is not distinct from s.game
  on conflict (id) do update set
    min = excluded.min, fgm = excluded.fgm, fga = excluded.fga, fg_pct = excluded.fg_pct,
    fg3m = excluded.fg3m, fg3a = excluded.fg3a, fg3_pct = excluded.fg3_pct,
    ftm = excluded.ftm, fta = excluded.fta, ft_pct = excluded.ft_pct,
    oreb = excluded.oreb, dreb = excluded.dreb, reb = excluded.reb,
    ast = excluded.ast, stl = excluded.stl, blk = excluded.blk,
    turnover = excluded.turnover, pf = excluded.pf, pts = excluded.pts, plus_minus = excluded.plus_minus,
    player_id = excluded.player_id, team_id = excluded.team_id, game_id = excluded.game_id,
    created_at = excluded.created_at,
    player_document_id = excluded.player_document_id,
    team_document_id = excluded.team_document_id,
    game_document_id = excluded.game_document_id
  where player_game_stats_row.min is distinct from excluded.min
     or player_game_stats_row.fgm is distinct from excluded.fgm
     or player_game_stats_row.fga is distinct from excluded.fga
     or player_game_stats_row.fg_pct is distinct from excluded.fg_pct
     or player_game_stats_row.fg3m is distinct from excluded.fg3m
     or player_game_stats_row.fg3a is distinct from excluded.fg3a
     or player_game_stats_row.fg3_pct is distinct from excluded.fg3_pct
     or player_game_stats_row.ftm is distinct from excluded.ftm
     or player_game_stats_row.fta is distinct from excluded.fta
     or player_game_stats_row.ft_pct is distinct from excluded.ft_pct
     or player_game_stats_row.oreb is distinct from excluded.oreb
     or player_game_stats_row.dreb is distinct from excluded.dreb
     or player_game_stats_row.reb is distinct from excluded.reb
     or player_game_stats_row.ast is distinct from excluded.ast
     or player_game_stats_row.stl is distinct from excluded.stl
     or player_game_stats_row.blk is distinct from excluded.blk
     or player_game_stats_row.turnover is distinct from excluded.turnover
     or player_game_stats_row.pf is distinct from excluded.pf
     or player_game_stats_row.pts is distinct from excluded.pts
     or player_game_stats_row.plus_minus is distinct from excluded.plus_minus
     or player_game_stats_row.player_id is distinct from excluded.player_id
     or player_game_stats_row.team_id is distinct from excluded.team_id
     or player_game_stats_row.game_id is distinct from excluded.game_id
     or player_game_stats_row.created_at is distinct from excluded.created_at
     or player_game_stats_row.player_document_id is distinct from excluded.player_document_id
     or player_game_stats_row.team_document_id is distinct from excluded.team_document_id
     or player_game_stats_row.game_document_id is distinct from excluded.game_document_id;

  select count(*) into v_mismatch
    from raw.player_game_stats s
    join raw.player_game_stats_resolved r on r.id = s.id
   where s.min is distinct from r.min
      or s.fgm is distinct from r.fgm
      or s.fga is distinct from r.fga
      or s.fg_pct is distinct from r.fg_pct
      or s.fg3m is distinct from r.fg3m
      or s.fg3a is distinct from r.fg3a
      or s.fg3_pct is distinct from r.fg3_pct
      or s.ftm is distinct from r.ftm
      or s.fta is distinct from r.fta
      or s.ft_pct is distinct from r.ft_pct
      or s.oreb is distinct from r.oreb
      or s.dreb is distinct from r.dreb
      or s.reb is distinct from r.reb
      or s.ast is distinct from r.ast
      or s.stl is distinct from r.stl
      or s.blk is distinct from r.blk
      or s.turnover is distinct from r.turnover
      or s.pf is distinct from r.pf
      or s.pts is distinct from r.pts
      or s.plus_minus is distinct from r.plus_minus
      or s.player_id is distinct from r.player_id
      or s.team_id is distinct from r.team_id
      or s.game_id is distinct from r.game_id
      or s.created_at is distinct from r.created_at
      or s.player is distinct from r.player
      or s.team is distinct from r.team
      or s.game is distinct from r.game;
  if v_mismatch > 0 then
    raise exception 'player_game_stats_normalized_mismatch: %', v_mismatch;
  end if;

  select count(*) into v_stats from raw.player_game_stats_row;
  select count(*) into v_docs from raw.player_game_stat_document;
  return query select v_stats, v_docs, v_mismatch;
end;
$$;
