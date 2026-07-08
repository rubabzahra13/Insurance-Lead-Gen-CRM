-- Phase 2: saved views for filter presets

CREATE TABLE IF NOT EXISTS saved_views (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  filter_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_views_updated ON saved_views(updated_at DESC);

ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE saved_views FROM anon, authenticated;
