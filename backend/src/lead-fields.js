// Shared validation for the two fields users judge a lead by: company and
// location.
//
// The SERP engine builds leads from two independent structurers (code-based
// `structureSerpLeads` and `structureWithOpenAI`), and each used to carry its
// own idea of what a company or a place looks like. That is how a job title
// ("Aspiring Financial Advisor"), a school ("Nazareth University"), a job-status
// fragment ("Student, Class") and a bare ZIP ("77018") all reached the CRM as
// facts. Validating here — once, after the structurers merge — means a fix
// applies to every path instead of only the one it was noticed on.
//
// Rule of thumb: in a CRM an empty field is honest, a wrong one is expensive,
// because outreach copy quotes it back at the prospect.

/** Job/status wording — always a role, never an employer. */
const JOB_TITLE_RE =
  /\b(aspiring|seeking|open to work|student|intern|graduate|advisor|adviser|consultant|planner|analyst|associate|assistant|representative|specialist|manager|director|officer|leader|head of|engineer|developer|designer|coordinator|supervisor|recruiter|major|minor|candidate|professional|entry.?level|junior|senior|trainee|apprentice|class of|mba|bba|phd|bachelors?|masters? in|degree in)\b/i;

/** Education institutions are not the employer we want in a Company column. */
const EDUCATION_RE = /\b(university|college|school|institute|academy|campus)\b/i;

/** Wording that means a phrase is a role, school or employer — never a place. */
const NOT_A_PLACE_RE = new RegExp(
  `${EDUCATION_RE.source}|${JOB_TITLE_RE.source}|\\b(finance|financial|insurance|marketing|sales|wealth|management|services|solutions|group|inc|llc|ltd|corp)\\b`,
  'i',
);

// Unicode-aware letter class: place names carry diacritics ("Islāmābād") and are
// not always capitalised in stored data ("islamabad capital territory"), so
// matching on [A-Za-z] with a required capital deletes real cities.
const WORD = "\\p{L}[\\p{L}.'’-]*";

/** "City, Region" or "City, Region, Country" — 2–3 comma-separated parts. */
const PLACE_SHAPE_RE = new RegExp(
  `^${WORD}(?:\\s+${WORD}){0,3}(?:,\\s*${WORD}(?:\\s+${WORD}){0,3}){1,2}$`,
  'u',
);

/** A metro label such as "New York City Metropolitan Area". */
const METRO_RE = /^(greater\s+.+\s+area|.+\s+metropolitan\s+area)$/i;

/** A city or region with no comma, e.g. "Richmond", "islamabad capital territory". */
const BARE_CITY_RE = new RegExp(`^${WORD}(?:\\s+${WORD}){0,3}$`, 'u');

export function cleanPlaceCandidate(value) {
  return String(value ?? '')
    .replace(/\s*[.·|]+\s*$/, '')
    .replace(/\s*\.\.\.\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function looksLikePlace(value) {
  const text = cleanPlaceCandidate(value);
  if (!text || text.length < 3 || text.length > 60) return false;
  // A ZIP/postal code alone is not a location a human can act on.
  if (!/[A-Za-z]/.test(text)) return false;
  if (NOT_A_PLACE_RE.test(text)) return false;
  if (METRO_RE.test(text)) return true;
  return PLACE_SHAPE_RE.test(text) || BARE_CITY_RE.test(text);
}

export function cleanCompanyCandidate(value) {
  const text = String(value ?? '')
    .replace(/\s*[|·•].*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.length > 60) return null;
  // Checked before trailing punctuation is trimmed, so Google's truncated
  // "Equitable ..." is rejected rather than stored as a half name.
  if (/(\.\.\.|…)$/.test(text)) return null;
  if (!/^[\p{Lu}\p{N}]/u.test(text)) return null;
  if (JOB_TITLE_RE.test(text)) return null;
  if (EDUCATION_RE.test(text)) return null;

  // Trailing "." is left alone — it is part of "Inc.", "Ltd.", "Co.".
  const trimmed = text.replace(/[,;\s]+$/, '').trim();
  return trimmed.length > 1 ? trimmed : null;
}

/**
 * Last gate before a lead is exported. Drops a company or location that cannot
 * be justified, whichever structurer produced it.
 */
export function sanitizeLeadFields(lead) {
  if (!lead || typeof lead !== 'object') return lead;

  const company = cleanCompanyCandidate(lead.company);
  const location = looksLikePlace(lead.location) ? cleanPlaceCandidate(lead.location) : null;

  return { ...lead, company, location };
}
