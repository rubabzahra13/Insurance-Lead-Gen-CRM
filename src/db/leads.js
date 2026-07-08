import { toIsoOrNull } from './dates.js';
import { getSql } from './index.js';
import { leadToRow, rowToLead } from './lead-mapper.js';
import { linkedinSlugFromUrl, personIdentityKey } from '../utils.js';

export async function findExistingLead(lead) {
  const slug = lead.linkSlug ?? linkedinSlugFromUrl(lead.link);
  const sql = getSql();

  if (slug) {
    const [row] = await sql`SELECT * FROM leads WHERE link_slug = ${slug}`;
    if (row) return { lead: rowToLead(row), reason: 'link' };
  }

  const identityKey = personIdentityKey(lead);
  if (identityKey && identityKey !== '|') {
    const [row] = await sql`SELECT * FROM leads WHERE identity_key = ${identityKey}`;
    if (row) return { lead: rowToLead(row), reason: 'identity' };
  }

  return null;
}

export async function insertLead(lead) {
  const now = new Date().toISOString();
  const row = leadToRow(lead, { created_at: now });
  const sql = getSql();
  const extraJson = row.extra_json ? JSON.parse(row.extra_json) : null;
  const [inserted] = await sql`
    INSERT INTO leads (
      identity_key, link_slug, name, title, company, location, link,
      snippet, evidence, confidence, status, verification_notes,
      search_prompt, scraped_at, extra_json, created_at, updated_at
    ) VALUES (
      ${row.identity_key}, ${row.link_slug}, ${row.name}, ${row.title}, ${row.company},
      ${row.location}, ${row.link}, ${row.snippet}, ${row.evidence}, ${row.confidence},
      ${row.status}, ${row.verification_notes}, ${row.search_prompt}, ${row.scraped_at},
      ${extraJson ? sql.json(extraJson) : null}, ${row.created_at}, ${row.updated_at}
    )
    RETURNING id
  `;
  return getLeadById(Number(inserted.id));
}

export async function linkLeadToRun(leadId, runId, accepted = true) {
  const createdAt = new Date().toISOString();
  const sql = getSql();
  await sql`
    INSERT INTO lead_runs (lead_id, run_id, accepted, created_at)
    VALUES (${leadId}, ${runId}, ${accepted}, ${createdAt})
    ON CONFLICT (lead_id, run_id) DO NOTHING
  `;
}

export async function getLeadById(id) {
  const sql = getSql();
  const [row] = await sql`SELECT * FROM leads WHERE id = ${id}`;
  return rowToLead(row);
}

export async function updateLead(id, patch) {
  const sql = getSql();
  const now = new Date().toISOString();
  const keys = Object.keys(patch ?? {});

  if (keys.length === 1 && patch.starred !== undefined) {
    const [updated] = await sql`
      UPDATE leads SET starred = ${Boolean(patch.starred)}, updated_at = ${now}
      WHERE id = ${id}
      RETURNING *
    `;
    return updated ? rowToLead(updated) : null;
  }

  const existing = await getLeadById(id);
  if (!existing) return null;

  const merged = { ...existing, ...patch };
  const row = leadToRow(merged, {
    created_at: existing.createdAt,
    starred: patch.starred !== undefined ? (patch.starred ? 1 : 0) : existing.starred ? 1 : 0,
    tags_json: JSON.stringify(patch.tags ?? existing.tags ?? []),
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
  });

  const tagsJson = JSON.parse(row.tags_json ?? '[]');
  const extraJson = row.extra_json ? JSON.parse(row.extra_json) : null;
  const [updated] = await sql`
    UPDATE leads SET
      identity_key = ${row.identity_key},
      link_slug = ${row.link_slug},
      name = ${row.name},
      title = ${row.title},
      company = ${row.company},
      location = ${row.location},
      link = ${row.link},
      snippet = ${row.snippet},
      evidence = ${row.evidence},
      confidence = ${row.confidence},
      status = ${row.status},
      verification_notes = ${row.verification_notes},
      search_prompt = ${row.search_prompt},
      scraped_at = ${row.scraped_at},
      starred = ${Boolean(row.starred)},
      tags_json = ${sql.json(tagsJson)},
      notes = ${row.notes},
      extra_json = ${extraJson ? sql.json(extraJson) : null},
      updated_at = ${row.updated_at}
    WHERE id = ${id}
    RETURNING *
  `;
  return rowToLead(updated);
}

export async function deleteLead(id) {
  const sql = getSql();
  const rows = await sql`DELETE FROM leads WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

function leadFilterClauses({
  q,
  company,
  location,
  title,
  starred,
  tag,
  runId,
  createdSince,
}) {
  const starredOnly = starred === true || starred === 'true' || starred === 1 || starred === '1';
  const qTrim = q?.trim() ?? '';
  const qPattern = qTrim ? `%${qTrim}%` : '';
  const companyTrim = company?.trim() ?? '';
  const companyPattern = companyTrim ? `%${companyTrim}%` : '';
  const locationTrim = location?.trim() ?? '';
  const locationPattern = locationTrim ? `%${locationTrim}%` : '';
  const titleTrim = title?.trim() ?? '';
  const titlePattern = titleTrim ? `%${titleTrim}%` : '';
  const tagTrim = tag?.trim() ?? '';
  const tagPattern = tagTrim ? `%${tagTrim}%` : '';
  const runFilter = runId?.trim() ?? '';
  const sinceTrim = createdSince?.trim() ?? '';
  const since = sinceTrim || '1970-01-01T00:00:00.000Z';
  const applySince = Boolean(sinceTrim);

  return {
    qTrim,
    qPattern,
    companyTrim,
    companyPattern,
    locationTrim,
    locationPattern,
    titleTrim,
    titlePattern,
    tagTrim,
    tagPattern,
    starredOnly,
    runFilter,
    since,
    applySince,
  };
}

function leadScopedWhere(sql, f) {
  return sql`
    (${f.qTrim} = '' OR (
      l.name ILIKE ${f.qPattern} OR
      l.title ILIKE ${f.qPattern} OR
      l.company ILIKE ${f.qPattern} OR
      l.location ILIKE ${f.qPattern} OR
      l.snippet ILIKE ${f.qPattern} OR
      l.search_prompt ILIKE ${f.qPattern}
    ))
    AND (${f.companyTrim} = '' OR l.company ILIKE ${f.companyPattern})
    AND (${f.locationTrim} = '' OR l.location ILIKE ${f.locationPattern})
    AND (${f.titleTrim} = '' OR l.title ILIKE ${f.titlePattern})
    AND (${!f.starredOnly} OR l.starred = TRUE)
    AND (${f.tagTrim} = '' OR l.tags_json::text ILIKE ${f.tagPattern})
    AND (${f.runFilter} = '' OR EXISTS (
      SELECT 1 FROM lead_runs lr WHERE lr.lead_id = l.id AND lr.run_id = ${f.runFilter}
    ))
    AND (${!f.applySince} OR l.created_at >= ${f.since})
  `;
}

export async function listLeads({
  q,
  company,
  location,
  title,
  starred,
  tag,
  runId,
  createdSince,
  limit = 50,
  offset = 0,
  sort = 'updated_at',
  order = 'desc',
} = {}) {
  const sortColumn = ['name', 'title', 'company', 'location', 'confidence', 'created_at', 'updated_at'].includes(
    sort,
  )
    ? sort
    : 'updated_at';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
  const sql = getSql();
  const f = leadFilterClauses({ q, company, location, title, starred, tag, runId, createdSince });

  const rows = await sql`
    SELECT l.*, COUNT(*) OVER()::int AS total_count
    FROM leads l
    WHERE ${leadScopedWhere(sql, f)}
    ORDER BY ${sql.unsafe(`l.${sortColumn}`)} ${sql.unsafe(sortOrder)}
    LIMIT ${limit} OFFSET ${offset}
  `;

  const total = rows.length ? rows[0].total_count : 0;

  return {
    leads: rows.map(({ total_count: _total, ...row }) => rowToLead(row)),
    total,
    limit,
    offset,
  };
}

export async function getLeadFacets({
  q,
  company,
  location,
  title,
  starred,
  tag,
  runId,
  createdSince,
} = {}) {
  const sql = getSql();
  const f = leadFilterClauses({ q, company, location, title, starred, tag, runId, createdSince });
  const scopedWhere = leadScopedWhere(sql, f);

  const [row] = await sql`
    WITH scoped AS (
      SELECT l.company, l.location, l.title, l.tags_json
      FROM leads l
      WHERE ${scopedWhere}
    )
    SELECT json_build_object(
      'companies', COALESCE((
        SELECT json_agg(t ORDER BY t.count DESC, t.value ASC)
        FROM (
          SELECT company AS value, COUNT(*)::int AS count
          FROM scoped
          WHERE company IS NOT NULL AND TRIM(company) != ''
          GROUP BY company
          ORDER BY count DESC, company ASC
          LIMIT 30
        ) t
      ), '[]'::json),
      'locations', COALESCE((
        SELECT json_agg(t ORDER BY t.count DESC, t.value ASC)
        FROM (
          SELECT location AS value, COUNT(*)::int AS count
          FROM scoped
          WHERE location IS NOT NULL AND TRIM(location) != ''
          GROUP BY location
          ORDER BY count DESC, location ASC
          LIMIT 30
        ) t
      ), '[]'::json),
      'titles', COALESCE((
        SELECT json_agg(t ORDER BY t.count DESC, t.value ASC)
        FROM (
          SELECT title AS value, COUNT(*)::int AS count
          FROM scoped
          WHERE title IS NOT NULL AND TRIM(title) != ''
          GROUP BY title
          ORDER BY count DESC, title ASC
          LIMIT 20
        ) t
      ), '[]'::json),
      'tags', COALESCE((
        SELECT json_agg(t ORDER BY t.count DESC, t.value ASC)
        FROM (
          SELECT elem AS value, COUNT(*)::int AS count
          FROM scoped s
          CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s.tags_json, '[]'::jsonb)) AS elem
          WHERE elem IS NOT NULL AND TRIM(elem) != ''
          GROUP BY elem
          ORDER BY count DESC, elem ASC
          LIMIT 30
        ) t
      ), '[]'::json)
    ) AS facets_json
  `;

  const facets = row?.facets_json ?? {
    companies: [],
    locations: [],
    titles: [],
    tags: [],
  };

  return {
    companies: facets.companies ?? [],
    locations: facets.locations ?? [],
    titles: facets.titles ?? [],
    tags: facets.tags ?? [],
    scoped: Boolean(
      f.runFilter ||
        f.starredOnly ||
        f.applySince ||
        f.qTrim ||
        f.companyTrim ||
        f.locationTrim ||
        f.titleTrim ||
        f.tagTrim,
    ),
  };
}

export async function getDashboardStats() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const sql = getSql();
  const [row] = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM leads) AS total_leads,
      (SELECT COUNT(*)::int FROM leads WHERE starred = TRUE) AS starred_count,
      (SELECT COUNT(*)::int FROM leads WHERE created_at >= ${weekAgo}) AS new_this_week,
      (SELECT COUNT(*)::int FROM duplicate_reviews WHERE status = 'pending') AS pending_duplicates,
      (SELECT COUNT(*)::int FROM runs) AS total_runs
  `;

  return {
    totalLeads: row.total_leads,
    starredCount: row.starred_count,
    newThisWeek: row.new_this_week,
    pendingDuplicates: row.pending_duplicates,
    totalRuns: row.total_runs,
  };
}

export async function getLeadsForRun(runId) {
  const sql = getSql();
  const rows = await sql`
    SELECT l.* FROM leads l
    INNER JOIN lead_runs lr ON lr.lead_id = l.id
    WHERE lr.run_id = ${runId}
    ORDER BY l.name ASC
  `;
  return rows.map(rowToLead);
}

export async function getLeadRunHistory(leadId) {
  const sql = getSql();
  const rows = await sql`
    SELECT r.id, r.search_prompt, r.status, r.started_at, r.leads_added, lr.created_at AS linked_at
    FROM lead_runs lr
    INNER JOIN runs r ON r.id = lr.run_id
    WHERE lr.lead_id = ${leadId}
    ORDER BY lr.created_at DESC
  `;
  return rows.map((row) => ({
    runId: row.id,
    searchPrompt: row.search_prompt,
    status: row.status,
    startedAt: toIsoOrNull(row.started_at),
    leadsAdded: row.leads_added,
    linkedAt: toIsoOrNull(row.linked_at),
  }));
}

export async function bulkLeadsActionByFilter(filter = {}, action, payload = {}) {
  const sql = getSql();
  const f = leadFilterClauses(filter);
  const now = new Date().toISOString();
  const where = leadScopedWhere(sql, f);

  if (action === 'delete') {
    const rows = await sql`
      DELETE FROM leads l
      WHERE ${where}
      RETURNING id
    `;
    return { affected: rows.length };
  }

  if (action === 'star') {
    const rows = await sql`
      UPDATE leads l SET starred = TRUE, updated_at = ${now}
      WHERE ${where} AND l.starred = FALSE
      RETURNING id
    `;
    return { affected: rows.length };
  }

  if (action === 'unstar') {
    const rows = await sql`
      UPDATE leads l SET starred = FALSE, updated_at = ${now}
      WHERE ${where} AND l.starred = TRUE
      RETURNING id
    `;
    return { affected: rows.length };
  }

  if (action === 'add_tag' && payload.tag?.trim()) {
    const tag = payload.tag.trim();
    const rows = await sql`
      UPDATE leads l SET
        tags_json = CASE
          WHEN COALESCE(l.tags_json, '[]'::jsonb) @> jsonb_build_array(${tag})
          THEN l.tags_json
          ELSE COALESCE(l.tags_json, '[]'::jsonb) || jsonb_build_array(${tag})
        END,
        updated_at = ${now}
      WHERE ${where}
      RETURNING id
    `;
    return { affected: rows.length };
  }

  throw new Error(`Unknown bulk action: ${action}`);
}

export async function bulkLeadsAction(ids, action, payload = {}) {
  if (!Array.isArray(ids) || ids.length === 0) return { affected: 0 };
  const numericIds = ids.map(Number).filter((id) => id > 0);
  if (!numericIds.length) return { affected: 0 };

  const sql = getSql();
  const now = new Date().toISOString();

  if (action === 'delete') {
    const rows = await sql`DELETE FROM leads WHERE id IN ${sql(numericIds)} RETURNING id`;
    return { affected: rows.length };
  }

  if (action === 'star') {
    const rows = await sql`
      UPDATE leads SET starred = TRUE, updated_at = ${now}
      WHERE id IN ${sql(numericIds)} AND starred = FALSE
      RETURNING id
    `;
    return { affected: rows.length };
  }

  if (action === 'unstar') {
    const rows = await sql`
      UPDATE leads SET starred = FALSE, updated_at = ${now}
      WHERE id IN ${sql(numericIds)} AND starred = TRUE
      RETURNING id
    `;
    return { affected: rows.length };
  }

  if (action === 'add_tag' && payload.tag?.trim()) {
    const tag = payload.tag.trim();
    const rows = await sql`
      UPDATE leads SET
        tags_json = CASE
          WHEN COALESCE(tags_json, '[]'::jsonb) @> jsonb_build_array(${tag})
          THEN tags_json
          ELSE COALESCE(tags_json, '[]'::jsonb) || jsonb_build_array(${tag})
        END,
        updated_at = ${now}
      WHERE id IN ${sql(numericIds)}
      RETURNING id
    `;
    return { affected: rows.length };
  }

  throw new Error(`Unknown bulk action: ${action}`);
}

export function mergeLeadData(existing, incoming) {
  const score = (lead) =>
    [lead.snippet, lead.title, lead.company, lead.location, lead.link, lead.evidence].filter(Boolean)
      .length;

  return score(incoming) >= score(existing)
    ? { ...existing, ...incoming, id: existing.id, starred: existing.starred, tags: existing.tags, notes: existing.notes }
    : { ...incoming, ...existing, id: existing.id, starred: existing.starred, tags: existing.tags, notes: existing.notes };
}
