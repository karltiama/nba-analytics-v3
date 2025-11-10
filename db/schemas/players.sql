-- PLAYERS
create table if not exists players (
  player_id     text primary key,         -- your canonical player ID (start with provider's id as text)
  full_name     text not null,            -- e.g. LeBron James
  first_name    text,                     -- optional; easy to add from API if available
  last_name     text,                     -- optional
  position      text,                     -- e.g. F, G, C (nullable)
  height        text,                     -- keep as text for now; normalize later if you want (e.g. inches)
  weight        text,                     -- same reasoning
  dob           date,                     -- nullable
  active        boolean,                  -- nullable (set later if API provides)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists players_full_name_idx on players (full_name);
create index if not exists players_last_first_idx on players (last_name, first_name);

