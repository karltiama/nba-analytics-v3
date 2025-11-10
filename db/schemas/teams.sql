-- TEAMS
create table if not exists teams (
  team_id       text primary key,         -- your canonical ID (store provider ID as text to start)
  abbreviation  text not null,            -- e.g. ATL
  full_name     text not null,            -- Atlanta Hawks
  name          text not null,            -- Hawks
  city          text not null,            -- Atlanta
  conference    text,                     -- East / West (nullable)
  division      text,                     -- e.g. Southeast (nullable)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Keep abbreviations unique in NBA context
create unique index if not exists teams_abbreviation_key on teams (abbreviation);
create index if not exists teams_conference_division_idx on teams (conference, division);
