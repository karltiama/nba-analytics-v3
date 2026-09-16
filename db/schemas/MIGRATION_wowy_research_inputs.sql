-- PREPARED ONLY. Do not apply in this slice.
-- Append-only WOWY research inputs. Not a prediction table. Frozen C is unchanged.

create table if not exists analytics.wowy_research_inputs (
  input_id              bigserial primary key,
  captured_at           timestamptz not null default now(),
  player_id             text not null,
  game_id               text not null,
  intended_cutoff_at    timestamptz not null,
  teammate_ids          jsonb not null,
  teammate_selection    text not null,
  wowy_history          jsonb,
  sample_support        jsonb not null,
  calculation_version   text not null,
  pregame_availability  jsonb not null,
  availability_state    text not null,
  value_kind            text not null,
  game_association      jsonb not null,
  constraint wowy_research_inputs_state_check check (
    availability_state in ('with', 'without', 'unknown')
  ),
  constraint wowy_research_inputs_kind_check check (
    value_kind in ('captured_pregame', 'reconstructed_historical')
  ),
  constraint wowy_research_inputs_selection_check check (
    teammate_selection = 'prior_minutes_primary'
  )
);

create index if not exists analytics_wowy_research_inputs_game_idx
  on analytics.wowy_research_inputs (game_id, player_id, intended_cutoff_at);

comment on table analytics.wowy_research_inputs is
  'Research-only append-only WOWY inputs. Do not apply as frozen C adjustments. captured_pregame is distinct from reconstructed_historical.';
