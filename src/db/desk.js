import { toIsoOrNull } from './dates.js';
import { listDuplicateReviews } from './duplicates.js';
import { getLeadFacets, listLeads } from './leads.js';
import { getSql } from './index.js';
import { getCached, setCached } from './query-cache.js';

const SHELL_TTL_MS = 60_000;
const SNAPSHOT_TTL_MS = 30_000;

function resolveListParams({ view, createdSince, ...rest }) {
  const params = { ...rest };

  if (view === 'starred') {
    params.starred = '1';
  }

  if (view === 'new') {
    params.createdSince =
      createdSince ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  } else if (createdSince) {
    params.createdSince = createdSince;
  }

  return params;
}

function snapshotCacheKey(params) {
  return `desk:snapshot:${JSON.stringify({
    view: params.view ?? 'all',
    q: params.q ?? '',
    company: params.company ?? '',
    location: params.location ?? '',
    title: params.title ?? '',
    tag: params.tag ?? '',
    runId: params.runId ?? '',
    createdSince: params.createdSince ?? '',
    sort: params.sort ?? 'updated_at',
    order: params.order ?? 'desc',
    limit: params.limit ?? 50,
    offset: params.offset ?? 0,
  })}`;
}

function mapRunRow(row) {
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
    leadsAdded: row.leads_added,
    duplicatesFound: row.duplicates_found,
  };
}

function mapSavedViewRow(row) {
  let filterJson = row.filter_json ?? {};
  if (typeof filterJson === 'string') {
    try {
      filterJson = JSON.parse(filterJson);
    } catch {
      filterJson = {};
    }
  }
  return {
    id: Number(row.id),
    name: row.name,
    filterJson,
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
  };
}

/**
 * Desk shell: global stats + recent searches + saved views in a single SQL round-trip.
 * Cached independently so tab/filter changes reuse it.
 */
export async function getDeskShell() {
  const cacheKey = 'desk:shell';
  const cached = getCached(cacheKey, SHELL_TTL_MS);
  if (cached) return cached;

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const sql = getSql();
  const [row] = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM leads) AS total_leads,
      (SELECT COUNT(*)::int FROM leads WHERE starred = TRUE) AS starred_count,
      (SELECT COUNT(*)::int FROM leads WHERE created_at >= ${weekAgo}) AS new_this_week,
      (SELECT COUNT(*)::int FROM duplicate_reviews WHERE status = 'pending') AS pending_duplicates,
      (SELECT COUNT(*)::int FROM runs) AS total_runs,
      (
        SELECT COALESCE(json_agg(r ORDER BY r.started_at DESC), '[]'::json)
        FROM (
          SELECT id, query, search_prompt, max_results, status, error, provider,
                 started_at, finished_at, leads_added, duplicates_found
          FROM runs
          ORDER BY started_at DESC
          LIMIT 8
        ) r
      ) AS recent_runs_json,
      (
        SELECT COALESCE(json_agg(sv ORDER BY sv.updated_at DESC), '[]'::json)
        FROM (
          SELECT id, name, filter_json, created_at, updated_at
          FROM saved_views
          ORDER BY updated_at DESC
        ) sv
      ) AS saved_views_json
  `;

  const shell = {
    stats: {
      totalLeads: row.total_leads,
      starredCount: row.starred_count,
      newThisWeek: row.new_this_week,
      pendingDuplicates: row.pending_duplicates,
      totalRuns: row.total_runs,
    },
    recentRuns: (row.recent_runs_json ?? []).map(mapRunRow),
    savedViews: (row.saved_views_json ?? []).map(mapSavedViewRow),
  };

  setCached(cacheKey, shell, ['desk']);
  return shell;
}

/**
 * BFF read model: one HTTP response backed by up to 3 parallel DB queries.
 * - Shell (stats, runs, saved views) — 1 query, shared cache
 * - Leads or duplicate reviews — 1 query
 * - Facets — 1 query (skipped on review view and page > 1)
 */
export async function getDeskSnapshot({
  view = 'all',
  q,
  company,
  location,
  title,
  tag,
  runId,
  createdSince,
  sort,
  order,
  limit = 50,
  offset = 0,
} = {}) {
  const params = {
    view,
    q,
    company,
    location,
    title,
    tag,
    runId,
    createdSince,
    sort,
    order,
    limit,
    offset,
  };
  const cacheKey = snapshotCacheKey(params);
  const cached = getCached(cacheKey, SNAPSHOT_TTL_MS);
  if (cached) return cached;

  const listParams = resolveListParams(params);
  const facetParams = {
    q: listParams.q,
    company: listParams.company,
    location: listParams.location,
    title: listParams.title,
    starred: listParams.starred,
    tag: listParams.tag,
    runId: listParams.runId,
    createdSince: listParams.createdSince,
  };

  const includeFacets = view !== 'review' && offset === 0;

  const [shell, content, facets] = await Promise.all([
    getDeskShell(),
    view === 'review'
      ? listDuplicateReviews({ status: 'pending', limit, offset })
      : listLeads(listParams),
    includeFacets ? getLeadFacets(facetParams) : Promise.resolve(null),
  ]);

  const snapshot =
    view === 'review'
      ? {
          ...shell,
          facets: null,
          leads: [],
          leadsTotal: 0,
          duplicates: content.reviews,
          duplicatesTotal: content.total,
        }
      : {
          ...shell,
          facets,
          leads: content.leads,
          leadsTotal: content.total,
          duplicates: [],
          duplicatesTotal: 0,
        };

  setCached(cacheKey, snapshot, ['desk', 'leads']);
  return snapshot;
}
