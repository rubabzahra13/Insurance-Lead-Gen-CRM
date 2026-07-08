import { toIsoOrNull } from './dates.js';
import { getSql } from './index.js';
import { rowToLead } from './lead-mapper.js';

export async function createDuplicateReview({ runId, existingLeadId, incomingLead, matchReason }) {
  const createdAt = new Date().toISOString();
  const sql = getSql();
  const [inserted] = await sql`
    INSERT INTO duplicate_reviews (run_id, existing_lead_id, incoming_json, match_reason, status, created_at)
    VALUES (${runId}, ${existingLeadId}, ${sql.json(incomingLead)}, ${matchReason}, 'pending', ${createdAt})
    RETURNING id
  `;
  return getDuplicateReview(Number(inserted.id));
}

export async function getDuplicateReview(id) {
  const sql = getSql();
  const [row] = await sql`
    SELECT dr.*, l.name AS existing_name, l.title AS existing_title,
           l.company AS existing_company, l.location AS existing_location,
           l.link AS existing_link, l.snippet AS existing_snippet,
           l.confidence AS existing_confidence, l.status AS existing_status,
           l.starred AS existing_starred, l.tags_json AS existing_tags_json,
           l.evidence AS existing_evidence, l.verification_notes AS existing_verification_notes
    FROM duplicate_reviews dr
    INNER JOIN leads l ON l.id = dr.existing_lead_id
    WHERE dr.id = ${id}
  `;
  return row ? duplicateRowToObject(row) : null;
}

export async function listDuplicateReviews({ status = 'pending', limit = 50, offset = 0 } = {}) {
  const sql = getSql();
  const rows = await sql`
    SELECT dr.*, l.name AS existing_name, l.title AS existing_title,
           l.company AS existing_company, l.location AS existing_location,
           l.link AS existing_link, l.snippet AS existing_snippet,
           l.confidence AS existing_confidence, l.status AS existing_status,
           l.starred AS existing_starred, l.tags_json AS existing_tags_json,
           l.evidence AS existing_evidence, l.verification_notes AS existing_verification_notes,
           COUNT(*) OVER()::int AS total_count
    FROM duplicate_reviews dr
    INNER JOIN leads l ON l.id = dr.existing_lead_id
    WHERE dr.status = ${status}
    ORDER BY dr.created_at ASC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const total = rows.length ? rows[0].total_count : 0;

  return {
    reviews: rows.map(({ total_count: _total, ...row }) => duplicateRowToObject(row)),
    total,
    limit,
    offset,
  };
}

export async function resolveDuplicateReview(id, status) {
  const resolvedAt = new Date().toISOString();
  const sql = getSql();
  await sql`
    UPDATE duplicate_reviews
    SET status = ${status}, resolved_at = ${resolvedAt}
    WHERE id = ${id}
  `;
  return getDuplicateReview(id);
}

export async function countPendingDuplicates() {
  const sql = getSql();
  const [{ count }] = await sql`
    SELECT COUNT(*)::int AS count FROM duplicate_reviews WHERE status = 'pending'
  `;
  return count;
}

function duplicateRowToObject(row) {
  let incoming = row.incoming_json ?? {};
  let existingTags = row.existing_tags_json ?? [];

  if (typeof incoming === 'string') {
    try {
      incoming = JSON.parse(incoming);
    } catch {
      incoming = {};
    }
  }
  if (typeof existingTags === 'string') {
    try {
      existingTags = JSON.parse(existingTags);
    } catch {
      existingTags = [];
    }
  }

  const existingLead = {
    id: row.existing_lead_id,
    name: row.existing_name,
    title: row.existing_title,
    company: row.existing_company,
    location: row.existing_location,
    link: row.existing_link,
    snippet: row.existing_snippet,
    confidence: row.existing_confidence,
    status: row.existing_status,
    starred: Boolean(row.existing_starred),
    tags: existingTags,
    evidence: row.existing_evidence,
    verificationNotes: row.existing_verification_notes,
  };

  return {
    id: row.id,
    runId: row.run_id,
    status: row.status,
    matchReason: row.match_reason,
    createdAt: toIsoOrNull(row.created_at),
    resolvedAt: toIsoOrNull(row.resolved_at),
    existingLead,
    incomingLead: incoming,
  };
}
