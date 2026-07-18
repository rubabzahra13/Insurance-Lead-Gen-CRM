// Find public emails via Google (SerpAPI / Serper) for avatar12 leads.
// Blank-only: never overwrites contact_email. Uses 0–1 SERP credit per lead.

import { runOneSearch, serpAvailable } from './serp-search.js';
import { mapWithConcurrency, normalizePersonName } from './utils.js';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const BAD_LOCAL = new Set([
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'mailer-daemon',
  'postmaster',
  'privacy',
  'abuse',
  'webmaster',
  'support',
  'helpdesk',
  'info',
  'contact',
  'hello',
  'sales',
  'marketing',
  'newsletter',
  'admin',
  'customerservice',
]);

const BAD_DOMAIN_FRAGMENTS = [
  'example.com',
  'email.com',
  'domain.com',
  'sentry.io',
  'wixpress.com',
  'cloudflare',
  'github.com',
  'githubusercontent',
  'linkedin.com',
  'google.com',
  'gstatic.com',
  'schema.org',
  'w3.org',
  'sentry-next',
];

const BAD_TLDS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'css', 'js', 'map']);

function envFlag(name, fallback = true) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(raw).trim().toLowerCase());
}

export function emailSerpEnabled() {
  return envFlag('EMAIL_SERP', true) && serpAvailable();
}

export function extractEmailsFromText(text) {
  if (!text) return [];
  const matches = String(text).match(EMAIL_RE) ?? [];
  const seen = new Set();
  const out = [];
  for (const raw of matches) {
    const email = raw.trim().toLowerCase().replace(/[.,;:)>\]"']+$/g, '');
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

function nameTokens(name) {
  return normalizePersonName(name)
    .split(' ')
    .filter((t) => t.length >= 2);
}

function companyTokens(company) {
  return String(company ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !['the', 'and', 'inc', 'llc', 'ltd', 'corp', 'company'].includes(t));
}

/** Return null if the address is junk / placeholder; else the normalized email. */
export function sanitizeEmailCandidate(email) {
  const value = String(email ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.,;:)>\]"']+$/g, '');
  if (!value || !value.includes('@')) return null;

  const [local, domain] = value.split('@');
  if (!local || !domain || local.length < 2 || domain.length < 4) return null;

  const tld = domain.split('.').pop();
  if (BAD_TLDS.has(tld)) return null;
  if (BAD_LOCAL.has(local.replace(/[0-9._-]/g, ''))) return null;
  if (BAD_LOCAL.has(local)) return null;
  if (BAD_DOMAIN_FRAGMENTS.some((frag) => domain.includes(frag))) return null;
  if (/^(image|img|static|cdn|assets?)\d*$/i.test(local)) return null;

  return value;
}

/**
 * Higher score = more likely this email belongs to the person.
 * Returns -Infinity for rejected candidates.
 */
export function scoreEmailForLead(email, lead) {
  const clean = sanitizeEmailCandidate(email);
  if (!clean) return Number.NEGATIVE_INFINITY;

  const [local, domain] = clean.split('@');
  const localCompact = local.replace(/[^a-z0-9]/g, '');
  const tokens = nameTokens(lead?.name);
  if (tokens.length === 0) return 0;

  let score = 1;
  const first = tokens[0];
  const last = tokens[tokens.length - 1];

  const hasFirst = localCompact.includes(first);
  const hasLast = tokens.length > 1 && localCompact.includes(last);
  if (hasFirst && hasLast) score += 8;
  else if (hasLast && localCompact.startsWith(first[0])) score += 6; // jsmith
  else if (hasFirst || hasLast) score += 3;
  else score -= 4; // no name overlap — usually wrong person

  const cos = companyTokens(lead?.company);
  if (cos.length > 0) {
    const domainCompact = domain.replace(/[^a-z0-9]/g, '');
    if (cos.some((t) => domainCompact.includes(t) || t.includes(domainCompact.slice(0, 6)))) {
      score += 4;
    }
  }

  // Personal inboxes are common for job seekers; slight preference if name matches.
  if (['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'me.com'].includes(domain)) {
    score += hasFirst || hasLast ? 1 : -2;
  }

  return score;
}

export function pickBestEmail(candidates, lead, { minScore = 3 } = {}) {
  let best = null;
  let bestScore = minScore - 0.001;
  for (const email of candidates) {
    const score = scoreEmailForLead(email, lead);
    if (score > bestScore) {
      bestScore = score;
      best = sanitizeEmailCandidate(email);
    }
  }
  return best;
}

function leadSourceText(lead) {
  return [lead.title, lead.headline, lead.snippet, lead.evidence, lead.fit_evidence, lead.past_experience]
    .filter(Boolean)
    .join(' · ');
}

export function buildEmailSearchQuery(lead) {
  const name = String(lead?.name ?? '').trim();
  if (!name) return null;
  const company = String(lead?.company ?? '').trim();
  // Quote the name so Google looks for that person; ask for contact/email signals.
  if (company && company.length >= 2 && !/open to work/i.test(company)) {
    return `"${name}" "${company}" (email OR "@" OR contact)`;
  }
  return `"${name}" (email OR "@gmail.com" OR "@outlook.com" OR contact)`;
}

function resultsToText(results) {
  return (results ?? [])
    .map((r) => [r.title, r.snippet, r.link].filter(Boolean).join(' '))
    .join(' · ');
}

/**
 * Fill contact_email on leads that are missing it.
 * 1) Mine text already on the lead (free).
 * 2) One Google SERP query per remaining lead (uses credits).
 */
export async function enrichLeadEmails(
  leads,
  {
    onLog,
    runSearch = runOneSearch,
    concurrency = Number(process.env.EMAIL_SERP_CONCURRENCY ?? 3),
    maxSearches = Number(process.env.EMAIL_SERP_MAX ?? process.env.MAX_RESULTS ?? 25),
    numResults = Number(process.env.EMAIL_SERP_NUM ?? 8),
    enabled = emailSerpEnabled(),
  } = {},
) {
  if (!Array.isArray(leads) || leads.length === 0) return leads;

  const out = leads.map((lead) => ({ ...lead }));

  // Pass 1 — free extraction from existing snippets.
  let filledFromSnippet = 0;
  for (const lead of out) {
    if ((lead.contact_email || '').trim()) continue;
    const found = pickBestEmail(extractEmailsFromText(leadSourceText(lead)), lead);
    if (found) {
      lead.contact_email = found;
      lead.email_source = 'snippet';
      filledFromSnippet += 1;
    }
  }
  if (filledFromSnippet > 0) {
    onLog?.(`  emails from snippets: ${filledFromSnippet}`);
  }

  if (!enabled) {
    onLog?.('  SerpAPI email search skipped (EMAIL_SERP off or no SERP key)');
    return out;
  }

  const needingSearch = out
    .map((lead, index) => ({ lead, index }))
    .filter(({ lead }) => !(lead.contact_email || '').trim() && lead.name)
    .slice(0, Math.max(0, maxSearches));

  if (needingSearch.length === 0) {
    onLog?.('  SerpAPI email search: nothing left to look up');
    return out;
  }

  onLog?.(`  SerpAPI email search: ${needingSearch.length} lead(s) (1 query each)`);

  let foundViaSerp = 0;
  let failed = 0;

  await mapWithConcurrency(needingSearch, Math.max(1, concurrency), async ({ lead, index }) => {
    const query = buildEmailSearchQuery(lead);
    if (!query) return;

    try {
      const results = await runSearch(query, numResults);
      const candidates = extractEmailsFromText(resultsToText(results));
      const best = pickBestEmail(candidates, lead);
      if (best) {
        out[index] = {
          ...out[index],
          contact_email: best,
          email_source: 'serpapi',
        };
        foundViaSerp += 1;
      }
    } catch (error) {
      failed += 1;
      onLog?.(`  email search failed for ${lead.name}: ${error.message}`);
    }
  });

  onLog?.(
    `  emails found via SerpAPI: ${foundViaSerp}` +
      (failed ? ` (${failed} query error(s))` : ''),
  );

  return out;
}
