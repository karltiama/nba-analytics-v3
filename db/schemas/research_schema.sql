-- Research schema: evaluation-oriented views (holdout filters applied in API/query).
-- Run after analytics_schema.sql, raw_player_prop_snapshots_v2.sql, analytics.games populated.
--
-- Quick install: run db/schemas/research_install_all.sql once in Supabase (all views).
-- Or apply in order:
--   1. research_schema.sql
--   2. research_v_player_outcomes.sql
--   3. research_v_prop_decision_lines.sql
--   4. research_v_prop_eval_units.sql

create schema if not exists research;
