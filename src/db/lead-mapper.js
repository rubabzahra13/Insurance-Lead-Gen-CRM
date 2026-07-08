import { linkedinSlugFromUrl, personIdentityKey } from '../utils.js';
import { toIsoOrNull } from './dates.js';

export function leadToRow(lead, overrides = {}) {
  const now = new Date().toISOString();
  const slug = lead.linkSlug ?? linkedinSlugFromUrl(lead.link);
  const identityKey = personIdentityKey(lead);

  return {
    identity_key: identityKey && identityKey !== '|' ? identityKey : null,
    link_slug: slug,
    name: lead.name ?? '',
    title: lead.title ?? null,
    company: lead.company ?? null,
    location: lead.location ?? null,
    link: lead.link ?? null,
    snippet: lead.snippet ?? null,
    evidence: lead.evidence ?? null,
    confidence: lead.confidence ?? null,
    status: lead.status ?? null,
    verification_notes: lead.verificationNotes ?? null,
    search_prompt: lead.searchPrompt ?? null,
    scraped_at: lead.scrapedAt ?? null,
    extra_json: JSON.stringify({
      linkSlug: slug,
      linkSource: lead.linkSource ?? null,
      source: lead.source ?? null,
      urlVerification: lead.urlVerification ?? null,
    }),
    updated_at: now,
    ...overrides,
  };
}

export function rowToLead(row) {
  if (!row) return null;

  let extra = {};
  try {
    const rawExtra = row.extra_json;
    extra =
      rawExtra && typeof rawExtra === 'object'
        ? rawExtra
        : rawExtra
          ? JSON.parse(rawExtra)
          : {};
  } catch {
    extra = {};
  }

  let tags = [];
  try {
    const rawTags = row.tags_json;
    tags = Array.isArray(rawTags) ? rawTags : rawTags ? JSON.parse(rawTags) : [];
  } catch {
    tags = [];
  }

  return {
    id: row.id != null ? Number(row.id) : null,
    name: row.name,
    title: row.title,
    company: row.company,
    location: row.location,
    link: row.link,
    linkSlug: row.link_slug ?? extra.linkSlug ?? null,
    linkSource: extra.linkSource ?? null,
    snippet: row.snippet,
    evidence: row.evidence,
    confidence: row.confidence,
    status: row.status,
    verificationNotes: row.verification_notes,
    searchPrompt: row.search_prompt,
    scrapedAt: toIsoOrNull(row.scraped_at),
    starred: Boolean(row.starred),
    tags,
    notes: row.notes,
    urlVerification: extra.urlVerification ?? null,
    source: extra.source ?? null,
    identityKey: row.identity_key,
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
  };
}
