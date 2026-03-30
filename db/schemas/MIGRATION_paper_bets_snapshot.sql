-- Add model snapshot columns to paper.bets (run on existing DBs after paper_schema.sql v1).
-- Idempotent: safe to re-run if columns already exist (will error on duplicate column — use IF NOT EXISTS pattern below).

ALTER TABLE paper.bets ADD COLUMN IF NOT EXISTS model_probability numeric;
ALTER TABLE paper.bets ADD COLUMN IF NOT EXISTS projection numeric;
ALTER TABLE paper.bets ADD COLUMN IF NOT EXISTS ev_selected_track text;

COMMENT ON COLUMN paper.bets.model_probability IS 'Model P(side) at decision time (selected EV track).';
COMMENT ON COLUMN paper.bets.projection IS 'Model stat projection at decision time.';
COMMENT ON COLUMN paper.bets.ev_selected_track IS 'EV track label, e.g. trackB_calibrated.';
