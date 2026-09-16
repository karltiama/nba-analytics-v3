-- PROPOSED schema for Parlay XRay paid-path guardrails.
-- Do NOT apply automatically. Operator/DBA applies this before any production canary.
-- UTC daily buckets. No screenshot blobs.

CREATE TABLE IF NOT EXISTS parlay_xray_daily_counters (
  bucket_date date NOT NULL,
  scope text NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (bucket_date, scope)
);

CREATE TABLE IF NOT EXISTS parlay_xray_inflight (
  user_id text PRIMARY KEY,
  reservation_id uuid NOT NULL,
  acquired_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS parlay_xray_inflight_expires_idx
  ON parlay_xray_inflight (expires_at);

CREATE TABLE IF NOT EXISTS parlay_xray_cooldowns (
  user_id text PRIMARY KEY,
  last_attempt_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS parlay_xray_dedupe (
  identity text PRIMARY KEY,
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS parlay_xray_dedupe_expires_idx
  ON parlay_xray_dedupe (expires_at);

CREATE TABLE IF NOT EXISTS parlay_xray_extraction_usage (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL,
  extraction_version text NOT NULL,
  schema_version text,
  model text,
  image_hash text,
  original_width integer,
  original_height integer,
  original_bytes integer,
  normalized_width integer,
  normalized_height integer,
  normalized_bytes integer,
  cache_hit boolean NOT NULL,
  provider_attempted boolean NOT NULL,
  success boolean NOT NULL,
  latency_ms integer,
  provider_request_id text,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  estimated_cost_usd numeric,
  error_category text
);

CREATE INDEX IF NOT EXISTS parlay_xray_usage_user_created_idx
  ON parlay_xray_extraction_usage (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS parlay_xray_usage_created_idx
  ON parlay_xray_extraction_usage (created_at DESC);
