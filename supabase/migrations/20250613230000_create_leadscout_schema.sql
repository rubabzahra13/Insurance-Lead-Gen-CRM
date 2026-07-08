-- LeadScout knowledge base schema (applied to project voipjpjgxiyagysexbob)

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  search_prompt TEXT NOT NULL,
  max_results INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  error TEXT,
  provider TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  raw_path TEXT,
  stats_json JSONB,
  trace_json JSONB,
  result_json JSONB,
  leads_added INTEGER NOT NULL DEFAULT 0,
  duplicates_found INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS leads (
  id BIGSERIAL PRIMARY KEY,
  identity_key TEXT,
  link_slug TEXT,
  name TEXT NOT NULL,
  title TEXT,
  company TEXT,
  location TEXT,
  link TEXT,
  snippet TEXT,
  evidence TEXT,
  confidence DOUBLE PRECISION,
  status TEXT,
  verification_notes TEXT,
  search_prompt TEXT,
  scraped_at TIMESTAMPTZ,
  starred BOOLEAN NOT NULL DEFAULT FALSE,
  tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  extra_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_link_slug ON leads(link_slug);
CREATE INDEX IF NOT EXISTS idx_leads_identity ON leads(identity_key);
CREATE INDEX IF NOT EXISTS idx_leads_company ON leads(company);
CREATE INDEX IF NOT EXISTS idx_leads_location ON leads(location);
CREATE INDEX IF NOT EXISTS idx_leads_starred ON leads(starred);
CREATE INDEX IF NOT EXISTS idx_leads_updated ON leads(updated_at);

CREATE TABLE IF NOT EXISTS lead_runs (
  lead_id BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  accepted BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lead_id, run_id)
);

CREATE TABLE IF NOT EXISTS duplicate_reviews (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  existing_lead_id BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  incoming_json JSONB NOT NULL,
  match_reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_duplicate_reviews_status ON duplicate_reviews(status);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at);

ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE duplicate_reviews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE runs, leads, lead_runs, duplicate_reviews FROM anon, authenticated;
