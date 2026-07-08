import { toIsoOrNull } from './dates.js';
import { getSql } from './index.js';

export async function insertRun({ id, query, searchPrompt, maxResults, provider, startedAt }) {
  const sql = getSql();
  await sql`
    INSERT INTO runs (id, query, search_prompt, max_results, status, provider, started_at)
    VALUES (${id}, ${query}, ${searchPrompt}, ${maxResults}, 'running', ${provider ?? null}, ${startedAt})
  `;
}

export async function completeRun({
  id,
  status,
  error,
  finishedAt,
  rawPath,
  stats,
  trace,
  result,
  leadsAdded,
  duplicatesFound,
}) {
  const sql = getSql();
  await sql`
    UPDATE runs SET
      status = ${status},
      error = ${error ?? null},
      finished_at = ${finishedAt},
      raw_path = ${rawPath ?? null},
      stats_json = ${stats ? sql.json(stats) : null},
      trace_json = ${trace ? sql.json(trace) : null},
      result_json = ${result ? sql.json(result) : null},
      leads_added = ${leadsAdded ?? 0},
      duplicates_found = ${duplicatesFound ?? 0}
    WHERE id = ${id}
  `;
}

export async function getRun(id) {
  const sql = getSql();
  const [row] = await sql`SELECT * FROM runs WHERE id = ${id}`;
  return row ? runRowToObject(row) : null;
}

export async function listRuns({ limit = 50, offset = 0 } = {}) {
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM runs ORDER BY started_at DESC LIMIT ${limit} OFFSET ${offset}
  `;
  return rows.map(runRowToObject);
}

export async function countRuns() {
  const sql = getSql();
  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM runs`;
  return count;
}

function runRowToObject(row) {
  let stats = row.stats_json ?? null;
  let trace = row.trace_json ?? null;
  let result = row.result_json ?? null;

  if (typeof stats === 'string') {
    try {
      stats = JSON.parse(stats);
    } catch {
      stats = null;
    }
  }
  if (typeof trace === 'string') {
    try {
      trace = JSON.parse(trace);
    } catch {
      trace = null;
    }
  }
  if (typeof result === 'string') {
    try {
      result = JSON.parse(result);
    } catch {
      result = null;
    }
  }

  return {
    id: row.id,
    query: row.query,
    searchPrompt: row.search_prompt,
    maxResults: row.max_results,
    status: row.status,
    error: row.error,
    provider: row.provider,
    startedAt: toIsoOrNull(row.started_at),
    finishedAt: toIsoOrNull(row.finished_at),
    rawPath: row.raw_path,
    stats,
    trace,
    result,
    leadsAdded: row.leads_added,
    duplicatesFound: row.duplicates_found,
  };
}
