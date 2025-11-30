-- MARKETS (ODDS)
-- Stores normalized betting odds and lines from odds-api
-- Supports historical tracking via snapshots (pre-game, closing, etc.)
--
-- DATA FLOW:
-- 1. Odds API returns: event -> bookmakers[] -> markets[] -> outcomes[]
-- 2. We normalize: one row per (game_id, market_type, bookmaker, side, snapshot_type)
-- 3. Example: One game with 2 bookmakers, 3 market types = 12+ rows
--
-- SNAPSHOT TYPES:
-- - pre_game: Initial odds (snapshotted daily at 09:00 ET)
-- - closing: Final odds before game starts (snapshotted 5 min before start)
-- - live: Real-time during game (optional, for line movement)
-- - mid_game: Halftime or key moments (optional)
--
-- MARKET TYPES:
-- - moneyline: Win/loss odds (no line, just odds)
-- - spread: Point spread with line (e.g., -3.5) and odds
-- - total: Over/under total points with line and odds
-- - player_prop: Player stat props (uses player_id, stat_type, stat_line)

create table if not exists markets (
  -- Primary key (auto-incrementing)
  id                bigserial primary key,
  
  -- Foreign key: Links to games table
  -- Example: 'bbref_202501151900_LAL_BOS'
  game_id           text not null references games(game_id) on delete cascade,
  
  -- Market classification
  -- Maps from Odds API market.key:
  --   'h2h' -> 'moneyline'
  --   'spreads' -> 'spread'
  --   'totals' -> 'total'
  --   'player_points' -> 'player_prop'
  market_type       text not null,                    -- 'moneyline' | 'spread' | 'total' | 'player_prop'
  
  -- Bookmaker/sportsbook
  -- Maps from Odds API bookmaker.key: 'draftkings', 'fanduel', 'betmgm', etc.
  bookmaker         text not null,                    -- 'draftkings' | 'fanduel' | 'betmgm' | etc.
  
  -- When these odds were captured
  snapshot_type     text not null default 'pre_game', -- 'pre_game' | 'closing' | 'live' | 'mid_game'
  
  -- Market details (varies by market_type)
  -- For moneyline/spread/total:
  --   side: 'home' | 'away' (for moneyline/spread) or 'over' | 'under' (for total)
  --   line: Spread value (e.g., -3.5) or total points (e.g., 225.5) or NULL for moneyline
  --   odds: American odds format (e.g., -110, +150)
  side              text,                             -- 'home' | 'away' | 'over' | 'under'
  line              numeric,                          -- Spread value, total points, or null for moneyline
  odds              integer not null,                 -- American odds (e.g., -110, +150)
  
  -- For player props only (market_type = 'player_prop'):
  --   player_id: Links to players table
  --   stat_type: Over/Under props: 'points', 'rebounds', 'assists', 'threes', 'blocks'
  --              Yes/No props: 'double_double', 'triple_double', 'first_basket'
  --   stat_line: Over/under line (e.g., 25.5 points) or NULL for Yes/No bets
  --   side: 'over'/'under' for Over/Under props, 'yes'/'no' for Yes/No props
  -- Note: For player props, line is stored in stat_line, not line field
  player_id         text references players(player_id),
  stat_type         text,                             -- 'points' | 'rebounds' | 'assists' | etc.
  stat_line         numeric,                          -- Over/under line (e.g., 25.5 points)
  
  -- Metadata
  -- provider_id: Odds API event ID (e.g., 'abc123def456') for reference/debugging
  -- raw_data: Full market object from API (stored as JSONB for debugging)
  provider_id       text,                             -- Odds API event/market ID for reference
  raw_data          jsonb,                            -- Store full market object for debugging
  fetched_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  
  -- Constraints
  constraint markets_market_type_check check (
    market_type in ('moneyline', 'spread', 'total', 'player_prop')
  ),
  constraint markets_snapshot_type_check check (
    snapshot_type in ('pre_game', 'closing', 'live', 'mid_game')
  ),
  constraint markets_side_check check (
    (market_type in ('moneyline', 'spread') and side in ('home', 'away')) or
    (market_type = 'total' and side in ('over', 'under')) or
    (market_type = 'player_prop' and side in ('over', 'under', 'yes', 'no')) or
    side is null
  ),
  constraint markets_player_prop_check check (
    (market_type = 'player_prop' and player_id is not null and stat_type is not null) or
    (market_type != 'player_prop' and player_id is null)
  )
);

-- ============================================
-- INDEXES
-- ============================================

-- Fast lookup by game (most common query)
-- Query: SELECT * FROM markets WHERE game_id = '...'
create index if not exists markets_game_id_idx on markets (game_id);

-- Composite index for common query pattern: get specific market type for a game
-- Query: SELECT * FROM markets WHERE game_id = '...' AND market_type = 'moneyline' AND snapshot_type = 'pre_game'
create index if not exists markets_game_market_idx on markets (game_id, market_type, snapshot_type);

-- Partial index for player props (only indexes rows where market_type = 'player_prop')
-- Smaller and faster than full index since it excludes non-prop rows
-- Query: SELECT * FROM markets WHERE player_id = '...' AND stat_type = 'points' AND market_type = 'player_prop'
create index if not exists markets_player_prop_idx on markets (player_id, stat_type, snapshot_type) 
  where market_type = 'player_prop';

-- Index for bookmaker-specific queries
-- Query: SELECT * FROM markets WHERE bookmaker = 'draftkings' ORDER BY fetched_at DESC
create index if not exists markets_bookmaker_idx on markets (bookmaker, fetched_at);

-- Index for time-based queries
-- Query: SELECT * FROM markets WHERE fetched_at > NOW() - INTERVAL '24 hours'
create index if not exists markets_fetched_at_idx on markets (fetched_at);

-- ============================================
-- UNIQUE CONSTRAINT
-- ============================================

-- Prevent duplicate pre-game/closing snapshots for same game/market/bookmaker/side
-- This ensures we only have one pre-game and one closing snapshot per unique combination
-- Note: Uses COALESCE to handle NULL values in unique constraint
-- Note: Only applies to 'pre_game' and 'closing' (partial index via WHERE clause)
--
-- Example: This prevents duplicate pre-game moneyline odds from same bookmaker
-- But allows multiple 'live' snapshots to track line movement
create unique index if not exists markets_unique_snapshot_idx on markets (
  game_id,           -- Which game
  market_type,       -- moneyline, spread, total, etc.
  bookmaker,         -- draftkings, fanduel, etc.
  snapshot_type,     -- pre_game, closing, etc.
  coalesce(side, ''),        -- home/away/over/under (NULL -> '' for constraint)
  coalesce(player_id, ''),   -- For player props (NULL -> '' for constraint)
  coalesce(stat_type, '')    -- For player props (NULL -> '' for constraint)
) where snapshot_type in ('pre_game', 'closing');

-- For live/mid_game snapshots, we intentionally allow multiple rows
-- This enables tracking line movement over time
-- To get latest live odds: ORDER BY fetched_at DESC LIMIT 1

