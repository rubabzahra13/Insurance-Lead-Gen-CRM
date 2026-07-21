import pg from 'pg';

const { Pool } = pg;

let pool;

function connectionString() {
  const value = (process.env.SUPABASE_CONNECTION_STRING || process.env.DATABASE_URL || '').trim();
  if (!value) {
    throw new Error(
      'SUPABASE_CONNECTION_STRING (or DATABASE_URL) is missing. Set it in Vercel Environment Variables.',
    );
  }
  return value;
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: connectionString(),
      ssl: connectionString().includes('localhost') ? false : { rejectUnauthorized: false },
      max: process.env.VERCEL ? 1 : 4,
    });
  }
  return pool;
}

function rowToJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    query: row.query,
    role: row.role,
    location: row.location,
    maxResults: row.max_results,
    avatarType: row.avatar_type,
    provider: row.provider,
    events: Array.isArray(row.events) ? row.events : [],
    result: row.result,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

export async function createScrapeJob(job) {
  const client = await getPool().connect();
  try {
    const { rows } = await client.query(
      `INSERT INTO scrape_job (
        id, status, query, role, location, max_results, avatar_type, provider, events, started_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10)
      RETURNING *`,
      [
        job.id,
        job.status,
        job.query,
        job.role,
        job.location ? JSON.stringify(job.location) : null,
        job.maxResults,
        job.avatarType,
        job.provider,
        JSON.stringify(job.events || []),
        job.startedAt || null,
      ],
    );
    return rowToJob(rows[0]);
  } finally {
    client.release();
  }
}

export async function getScrapeJob(jobId) {
  const { rows } = await getPool().query('SELECT * FROM scrape_job WHERE id = $1', [jobId]);
  return rowToJob(rows[0]);
}

export async function claimScrapeJob(jobId) {
  const { rows } = await getPool().query(
    `UPDATE scrape_job
     SET status = 'running', started_at = COALESCE(started_at, now())
     WHERE id = $1 AND status = 'queued'
     RETURNING *`,
    [jobId],
  );
  return rowToJob(rows[0]);
}

export async function appendScrapeEvent(jobId, event) {
  const { rows } = await clientQuery(
    `UPDATE scrape_job
     SET events = events || $2::jsonb
     WHERE id = $1
     RETURNING events`,
    [jobId, JSON.stringify([event])],
  );
  return rows[0]?.events || [];
}

async function clientQuery(sql, params) {
  const client = await getPool().connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

export async function finishScrapeJob(jobId, { status, result = null, error = null }) {
  const { rows } = await clientQuery(
    `UPDATE scrape_job
     SET status = $2, result = $3::jsonb, error = $4, finished_at = now()
     WHERE id = $1
     RETURNING *`,
    [jobId, status, result ? JSON.stringify(result) : null, error],
  );
  return rowToJob(rows[0]);
}

export async function waitForScrapeEvents(jobId, knownCount, { timeoutMs = 120_000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = await getScrapeJob(jobId);
    if (!job) return null;
    if (job.events.length > knownCount || job.status === 'done' || job.status === 'error') {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return getScrapeJob(jobId);
}
