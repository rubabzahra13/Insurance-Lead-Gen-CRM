// Code-based structuring for the SERP engine — turns Google/LinkedIn results
// into lead objects WITHOUT an LLM call. Keeps the fast engine independent of
// Claude credits and near-instant. Field quality is a bit lower than the LLM
// structurer, which is an acceptable trade for the experimental engine.

import { linkedinSlugFromUrl, normalizeProfileUrl, normalizePersonName } from './utils.js';
import { extractQueryLocation, leadMatchesLocation } from './location.js';
import { cleanCompanyCandidate, cleanPlaceCandidate, looksLikePlace } from './lead-fields.js';

// Job-status phrases are valid headlines but never a company/role.
const STATUS_RE = /(open to work|#?opentowork|seeking new opportunities|looking for (my next|new|opportunities))/i;

const EDUCATION_RE = /\b(university|college|school|institute|academy|polytechnic|campus)\b/i;

const SENIOR_HEADLINE_RE =
  /\b(senior|staff|principal|director|head of|vp\b|vice president|chief|ceo|cto|cfo|manager)\b/i;

const ROLE_GENERIC = new Set([
  'graduate', 'graduates', 'grad', 'grads', 'student', 'students', 'intern', 'internship',
  'entry', 'level', 'major', 'majors', 'new', 'recent', 'aspiring',
  'tech', 'talent', 'people', 'candidates', 'professionals', 'jobs', 'job',
  'insurance', 'sales', 'finance',
]);

// Avatar 1 = recent graduates / early career. Prefer explicit grad signals, but
// also keep people who match THIS search's roles (from AI) without needing
// the word "university" — works for any career, any country.
function isRecentGrad(text) {
  if (!text) return false;
  const years = [0, 1, 2].map((d) => new Date().getFullYear() - d);
  const classOfRecent = new RegExp(`class of (${years.join('|')})`, 'i');
  if (classOfRecent.test(text)) return true;
  return /(recent grad(uate)?|new grad\b|aspiring|entry.?level|seeking entry|\bstudent\b|\bintern(ship)?\b|summer analyst|undergraduate)/i.test(
    text,
  );
}

/** Light, career-agnostic education wording (not a school-name list). */
function hasLightEducationSignal(text) {
  if (!text) return false;
  if (isRecentGrad(text)) return true;
  if (/\b(graduated from|studying at|student at|alumni of|alumnus|alumna|bachelor)\b/i.test(text)) {
    return true;
  }
  return EDUCATION_RE.test(text);
}

/**
 * Does this profile text match the roles AI resolved for THIS search?
 * Dynamic: nursing search → nurse titles; tech search → engineer titles; etc.
 */
function matchesSearchRoles(text, roleTerms = [], roleSynonyms = []) {
  const lower = String(text || '').toLowerCase();
  if (!lower.trim()) return false;

  const terms = [...roleTerms, ...roleSynonyms]
    .map((t) => String(t || '').toLowerCase().trim())
    .filter((t) => t.length >= 3 && !ROLE_GENERIC.has(t))
    .sort((a, b) => b.length - a.length);

  for (const term of terms) {
    if (lower.includes(term)) return true;
    const words = term.split(/\s+/).filter((w) => w.length >= 3 && !ROLE_GENERIC.has(w));
    if (words.length >= 2 && words.every((w) => lower.includes(w))) return true;
  }
  return false;
}

/** Keep non-senior profiles that fit this search's role intent. */
function matchesSearchAsJunior(text, roleTerms, roleSynonyms) {
  if (!text) return false;
  if (SENIOR_HEADLINE_RE.test(text)) return false;
  if (OWNER_RE.test(text)) return false;
  return matchesSearchRoles(text, roleTerms, roleSynonyms);
}

// Avatar 2 = STAFF at small firms / upskillers — never the person who runs the
// business. An owner wanting to grow their own company is the wrong lead, so
// drop them in code too (not only via the LLM prompt).
const OWNER_RE = /\b(ceo|chief executive|founder|co-?founder|owner|proprietor|president|principal|managing director|managing partner|business owner)\b/i;

function isOwner(text) {
  return Boolean(text) && OWNER_RE.test(text);
}

/**
 * LinkedIn's own profile card, passed through by Google as rich-snippet
 * extensions:
 *   ["Mount Dora, Florida, United States", "Server", "Seasons 52 Restaurant"]
 *    location                              role      company
 *
 * This is the source of truth — LinkedIn's structured data rather than prose, so
 * it is never truncated and never mistakes a school for an employer. The card
 * omits fields on some profiles, so identify the location by shape instead of
 * trusting a fixed index.
 */
function factsFromExtensions(extensions) {
  const values = (Array.isArray(extensions) ? extensions : [])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  if (values.length === 0) return {};

  const placeIndex = values.findIndex((value) => looksLikePlace(value));
  const rest = values.filter((_, index) => index !== placeIndex);

  return {
    location: placeIndex >= 0 ? cleanPlaceCandidate(values[placeIndex]) : null,
    // Remaining card order is [role, company]; a single leftover is the role.
    role: rest[0] ?? null,
    company: rest.length > 1 ? cleanCompanyCandidate(rest[rest.length - 1]) : null,
  };
}

/**
 * Light optional headline hint: "Intern at Acme". Odd / Experience layouts are
 * left to enrichLeadFields (AI) so we do not hardcode every Google snippet shape.
 */
function matchCompanyAfterAt(text) {
  const source = String(text ?? '');
  const pattern = /\bat\s+([A-Z][^|·•.]{1,60})/g;

  for (const match of source.matchAll(pattern)) {
    const before = source.slice(0, match.index);
    const tail = before.slice(-48);
    if (EDUCATION_RE.test(tail.split(/[|·•]/).pop() ?? '')) continue;
    if (/\b(student|studying|alumni|alumnus|alumna|undergraduate)\s+$/i.test(tail)) continue;

    const candidate = String(match[1])
      .split(/\s+[-–—]\s+/)[0]
      .replace(/\s+/g, ' ')
      .trim();
    if (!candidate || EDUCATION_RE.test(candidate)) continue;
    const cleaned = cleanCompanyCandidate(candidate);
    if (cleaned) return cleaned;
  }

  return null;
}

function fitSourceFromUrl(url) {
  if (!url) return 'other';
  if (url.includes('/in/')) return 'profile';
  if (url.includes('/posts/') || url.includes('/feed/')) return 'own_post';
  if (url.includes('/company/')) return 'company_page';
  return 'other';
}

// LinkedIn result titles look like "Name - Headline | LinkedIn" for profiles,
// or "Name on LinkedIn: <post text>" for posts.
function extractName(title) {
  if (!title) return null;
  let text = title.replace(/\s*[|–—-]\s*LinkedIn.*$/i, '').trim();

  const onLinkedIn = text.match(/^(.+?)\s+on\s+LinkedIn/i);
  if (onLinkedIn) text = onLinkedIn[1];
  else text = text.split(' - ')[0];

  const name = text.replace(/[’']s$/i, '').replace(/\s+/g, ' ').trim();
  const words = name.split(/\s+/);
  if (words.length < 1 || words.length > 5) return null;
  if (!/[A-Za-z]/.test(name)) return null;
  return name;
}

/**
 * Pull the profile location out of a Google/LinkedIn snippet.
 *
 * Google renders profile snippets in a fixed order:
 *   "<Name>. <Headline>. <Company> <School>. <City, Region, Country>. N followers"
 * so the location is the sentence immediately before the follower/connection
 * count. Anchoring on that beats scanning left-to-right for the first
 * "Word, Word" pair, which nearly always hits the headline or the school first
 * (that is how "Advisor, Financial" and "University, Northridge" became
 * locations).
 */
function locationFromSnippet(snippet) {
  if (!snippet) return null;

  // 1) The segment just before the follower/connection count. Google often cuts
  // the snippet mid-count ("Accra, Greater Accra Region, Ghana. 261 ..."), so the
  // trailing word is optional — requiring it lost every truncated result.
  const beforeCount = snippet.match(
    /(?:^|[.·])\s*([^.·]{3,60}?)\s*[.·]\s*[\d,.]+\+?\s*(?:followers|connections|\.\.\.|…|$)/i,
  );
  if (beforeCount && looksLikePlace(beforeCount[1])) return cleanPlaceCandidate(beforeCount[1]);

  // 2) An explicit "based in / located in <place>".
  const explicit = snippet.match(/\b(?:based in|located in)\s+([A-Z][^.·|]{2,60})/);
  if (explicit && looksLikePlace(explicit[1])) return cleanPlaceCandidate(explicit[1]);

  // 3) A "Greater X Area" style metro label anywhere in the text.
  const metro = snippet.match(/\bGreater\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)*\s+Area\b/);
  if (metro) return cleanPlaceCandidate(metro[0]);

  return null;
}

export function structureSerpLeads(rawItems, { avatarType, searchPrompt, roleTerms = [], roleSynonyms = [] } = {}) {
  const profiles = rawItems.filter((item) => item.title && item.title !== 'model_research_notes');
  const byName = new Map();
  const locationHint = extractQueryLocation(searchPrompt);

  for (const item of profiles) {
    const name = extractName(item.title);
    if (!name) continue;

    // Avatar 1: recent-grad wording, light education signal, OR match to THIS
    // search's AI role terms (dynamic — not a fixed software-title list).
    if (avatarType === 'avatar1') {
      const headline = `${item.title} ${(item.snippet || '').split(/[·;|]\s*(Experience|Education)/i)[0]}`;
      const early = `${item.title} ${String(item.snippet || '').slice(0, 320)}`;
      if (
        !isRecentGrad(headline)
        && !hasLightEducationSignal(early)
        && !matchesSearchAsJunior(headline, roleTerms, roleSynonyms)
        && !matchesSearchAsJunior(early, roleTerms, roleSynonyms)
      ) {
        continue;
      }
    }

    // Avatar 2: drop owners/founders/CEOs — we want the staff, not the boss.
    // Same headline-only check, so a past "founder" deep in their history
    // doesn't wrongly disqualify a current producer.
    if (avatarType === 'avatar2') {
      const headline = `${item.title} ${(item.snippet || '').split(/[·;|]\s*(Experience|Education)/i)[0]}`;
      if (isOwner(headline)) continue;
    }

    const url = item.url || '';
    const isProfile = url.includes('/in/');
    const link = isProfile ? normalizeProfileUrl(url) : null;

    const headline = item.title.replace(/\s*[|–—-]\s*LinkedIn.*$/i, '').split(' - ').slice(1).join(' - ').trim() || null;

    // Break the headline into clauses and drop job-status phrases.
    const clauses = (headline || '')
      .split(/\s*[|·•]\s*|\s+-\s+/)
      .map((c) => c.trim())
      .filter(Boolean);
    const realClauses = clauses.filter((c) => !STATUS_RE.test(c));
    // Title = first meaningful (non-status) clause.
    const titleClause = realClauses[0] || null;

    // LinkedIn's own profile card, when Google passed it through, beats anything
    // we can infer from the snippet prose.
    const facts = factsFromExtensions(item.extensions);

    // Company: LinkedIn card first, then a light "at Company" headline hint.
    // School / internship / odd layouts → enrichLeadFields (AI), any structure.
    const company =
      facts.company
      || matchCompanyAfterAt(headline)
      || matchCompanyAfterAt(item.snippet)
      || null;

    const snippet = item.snippet || '';
    // The lane note was folded into the snippet as "[...]" by serpResultsToRawItems.
    const noteMatch = snippet.match(/\[([^\]]+)\]\s*$/);
    const laneNote = noteMatch ? noteMatch[1] : null;
    const cleanSnippet = snippet.replace(/\s*\[[^\]]+\]\s*$/, '').trim();

    const fitSource = fitSourceFromUrl(url);
    // Evidence: the snippet text (holds "seeking new opportunities" / "11-50 employees").
    const fitEvidence = (cleanSnippet || laneNote || headline || '').slice(0, 240) || null;

    const lead = {
      name,
      title: titleClause || facts.role || null,
      company,
      school: null,
      location: facts.location || locationFromSnippet(cleanSnippet),
      // Fields taken from LinkedIn's card are verified; anything inferred from
      // snippet prose stays flagged as weak so the CRM never shows a guess as fact.
      fieldSource: {
        company: facts.company ? 'linkedin_card' : company ? 'snippet' : null,
        location: facts.location ? 'linkedin_card' : 'snippet',
      },
      link,
      linkSlug: link ? linkedinSlugFromUrl(link) : null,
      linkSource: link ? 'serp' : null,
      snippet: cleanSnippet || null,
      evidence: fitEvidence,
      past_experience: null,
      fit_evidence: fitEvidence,
      fit_source: fitSource,
      weak_fields: fitSource === 'other' ? ['company', 'location'] : [],
      source: 'serp_structured',
      searchPrompt,
      scrapedAt: new Date().toISOString(),
    };

    if (locationHint && !leadMatchesLocation(lead, locationHint)) continue;

    const key = normalizePersonName(name);
    const existing = byName.get(key);
    // Prefer the entry that has a profile link.
    if (!existing || (!existing.link && lead.link)) byName.set(key, lead);
  }

  return [...byName.values()];
}
