-- Query performance indexes for common LeadScout filters and sorts

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_runs_run_id ON lead_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_reviews_pending_created
  ON duplicate_reviews(created_at ASC)
  WHERE status = 'pending';
