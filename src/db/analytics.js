import { getSql } from './index.js';
import { toIsoOrNull } from './dates.js';
import { getCached, setCached } from './query-cache.js';
import { aggregateRoleGroups } from '../lib/role-groups.js';

const TOP_N = 10;

function parseSince(since) {
  if (!since || since === 'all') return null;
  const days = { '7d': 7, '30d': 30, '90d': 90 }[since];
  if (!days) return null;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function rollupTopN(rows, limit = TOP_N) {
  if (rows.length <= limit) return rows;
  const top = rows.slice(0, limit);
  const otherCount = rows.slice(limit).reduce((sum, row) => sum + row.count, 0);
  if (otherCount > 0) top.push({ value: 'Other', count: otherCount });
  return top;
}

function shortPrompt(prompt, max = 42) {
  if (!prompt) return 'Untitled search';
  const trimmed = prompt.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function sortByCount(rows) {
  return [...rows].sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
}

function splitDimensions(rows) {
  const buckets = { search: [], company: [], location: [], title: [] };
  for (const row of rows ?? []) {
    if (buckets[row.dim]) buckets[row.dim].push({ value: row.value, count: Number(row.count) });
  }
  return buckets;
}

function parsePayload(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function getAnalytics({ since = 'all' } = {}) {
  const cacheKey = `analytics:${since}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const sql = getSql();
  const sinceIso = parseSince(since);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const scopedWhere = sinceIso ? sql`created_at >= ${sinceIso}` : sql`TRUE`;

  const [row] = await sql`
    WITH scoped AS (
      SELECT * FROM leads WHERE ${scopedWhere}
    ),
    summary AS (
      SELECT
        COUNT(*)::int AS total_leads,
        COUNT(*) FILTER (WHERE created_at >= ${weekAgo})::int AS new_this_week,
        COUNT(*) FILTER (WHERE starred = TRUE)::int AS starred_count,
        COUNT(DISTINCT search_prompt) FILTER (
          WHERE search_prompt IS NOT NULL AND BTRIM(search_prompt) <> ''
        )::int AS group_search,
        COUNT(DISTINCT company) FILTER (
          WHERE company IS NOT NULL AND BTRIM(company) <> ''
        )::int AS group_company,
        COUNT(DISTINCT location) FILTER (
          WHERE location IS NOT NULL AND BTRIM(location) <> ''
        )::int AS group_location,
        COUNT(DISTINCT title) FILTER (
          WHERE title IS NOT NULL AND BTRIM(title) <> ''
        )::int AS group_title,
        (SELECT COUNT(*)::int FROM duplicate_reviews WHERE status = 'pending') AS pending_duplicates,
        (SELECT COUNT(*)::int FROM runs) AS total_runs
      FROM scoped
    ),
    dimensions AS (
      SELECT 'search'::text AS dim, search_prompt AS value, COUNT(*)::int AS count
      FROM scoped
      WHERE search_prompt IS NOT NULL AND BTRIM(search_prompt) <> ''
      GROUP BY search_prompt
      UNION ALL
      SELECT 'company', company, COUNT(*)::int
      FROM scoped
      WHERE company IS NOT NULL AND BTRIM(company) <> ''
      GROUP BY company
      UNION ALL
      SELECT 'location', location, COUNT(*)::int
      FROM scoped
      WHERE location IS NOT NULL AND BTRIM(location) <> ''
      GROUP BY location
      UNION ALL
      SELECT 'title', title, COUNT(*)::int
      FROM scoped
      WHERE title IS NOT NULL AND BTRIM(title) <> ''
      GROUP BY title
    ),
    tags AS (
      SELECT tag AS value, COUNT(*)::int AS count
      FROM scoped s,
        LATERAL jsonb_array_elements_text(COALESCE(s.tags_json, '[]'::jsonb)) AS tag
      GROUP BY tag
    ),
    time_buckets AS (
      SELECT 'day'::text AS grain, DATE(created_at)::text AS bucket, COUNT(*)::int AS count
      FROM scoped
      GROUP BY DATE(created_at)
      UNION ALL
      SELECT 'month', TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YYYY'), COUNT(*)::int
      FROM scoped
      GROUP BY DATE_TRUNC('month', created_at)
    ),
    overlap AS (
      SELECT
        CASE WHEN run_count = 1 THEN 'one' ELSE 'multiple' END AS bucket,
        COUNT(*)::int AS count
      FROM (
        SELECT lead_id, COUNT(run_id)::int AS run_count
        FROM lead_runs
        GROUP BY lead_id
      ) lr
      GROUP BY 1
    ),
    recent AS (
      SELECT id, name, title, company, location, search_prompt, starred, created_at
      FROM scoped
      ORDER BY created_at DESC
      LIMIT 8
    )
    SELECT json_build_object(
      'summary', (SELECT row_to_json(s) FROM summary s),
      'dimensions', COALESCE((SELECT json_agg(row_to_json(d)) FROM dimensions d), '[]'::json),
      'tags', COALESCE((SELECT json_agg(row_to_json(t)) FROM tags t), '[]'::json),
      'time_buckets', COALESCE((SELECT json_agg(row_to_json(tb)) FROM time_buckets tb), '[]'::json),
      'overlap', COALESCE((SELECT json_agg(row_to_json(o)) FROM overlap o), '[]'::json),
      'recent', COALESCE((SELECT json_agg(row_to_json(r)) FROM recent r), '[]'::json)
    ) AS payload
  `;

  const payload = parsePayload(row?.payload);
  const summaryRow = payload.summary ?? {};
  const dims = splitDimensions(payload.dimensions);
  const tags = (payload.tags ?? []).map((t) => ({ value: t.value, count: Number(t.count) }));
  const totalLeads = summaryRow.total_leads ?? 0;
  const starredCount = summaryRow.starred_count ?? 0;
  const overlapRows = payload.overlap ?? [];
  const multiSearchLeads = overlapRows.find((r) => r.bucket === 'multiple')?.count ?? 0;
  const singleSearchLeads = overlapRows.find((r) => r.bucket === 'one')?.count ?? 0;

  const overTime = [];
  const byMonth = [];
  for (const bucket of payload.time_buckets ?? []) {
    if (bucket.grain === 'day') overTime.push({ date: bucket.bucket, count: Number(bucket.count) });
    else byMonth.push({ month: bucket.bucket, count: Number(bucket.count) });
  }

  const result = {
    since,
    summary: {
      totalLeads,
      newThisWeek: summaryRow.new_this_week ?? 0,
      starredCount,
      pendingDuplicates: summaryRow.pending_duplicates ?? 0,
      totalRuns: summaryRow.total_runs ?? 0,
      multiSearchLeads: Number(multiSearchLeads),
      singleSearchLeads: Number(singleSearchLeads),
    },
    groupCounts: {
      search: summaryRow.group_search ?? 0,
      company: summaryRow.group_company ?? 0,
      location: summaryRow.group_location ?? 0,
      title: summaryRow.group_title ?? 0,
      tag: tags.length,
    },
    overTime,
    byMonth,
    bySearch: sortByCount(dims.search)
      .slice(0, 20)
      .map((r) => ({ ...r, label: shortPrompt(r.value, 40) })),
    byCompany: rollupTopN(sortByCount(dims.company)),
    byLocation: rollupTopN(sortByCount(dims.location)),
    byTitle: rollupTopN(sortByCount(dims.title), 8),
    byRoleGroup: aggregateRoleGroups(dims.title).filter((r) => r.count > 0),
    byTag: rollupTopN(tags),
    byStarred: [
      { value: 'starred', label: 'Starred', count: starredCount },
      { value: 'not_starred', label: 'Not starred', count: Math.max(0, totalLeads - starredCount) },
    ].filter((r) => r.count > 0),
    bySearchOverlap: [
      { value: 'one', label: 'One search', count: Number(singleSearchLeads) },
      { value: 'multiple', label: 'Multiple searches', count: Number(multiSearchLeads) },
    ].filter((r) => r.count > 0),
    recentLeads: (payload.recent ?? []).map((lead) => ({
      id: lead.id,
      name: lead.name,
      title: lead.title,
      company: lead.company,
      location: lead.location,
      searchPrompt: lead.search_prompt,
      searchLabel: shortPrompt(lead.search_prompt, 28),
      starred: lead.starred,
      createdAt: toIsoOrNull(lead.created_at),
    })),
  };

  setCached(cacheKey, result, ['analytics']);
  return result;
}
