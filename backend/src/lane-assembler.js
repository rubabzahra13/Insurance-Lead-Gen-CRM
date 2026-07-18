// Assemble SerpAPI lanes from structured search intent.
// Google Boolean is built in code — AI supplies roles, synonyms, and discovery phrases.

import { buildDiscoveryClause } from './discovery-phrases.js';

function recentGradYears() {
  const year = new Date().getFullYear();
  return [year, year - 1, year - 2];
}

function classOfTerms() {
  return `(${recentGradYears().map((y) => `"Class of ${y}"`).join(' OR ')})`;
}

const GRAD_TERMS =
  '("recent graduate" OR "new grad" OR "recent grad" OR aspiring OR "entry level" OR "entry-level")';
const INTERN_TERMS = '(intern OR internship OR "summer analyst")';
/** Universal early-career wording — career-agnostic; role terms come from AI. */
const EDUCATION_TERMS =
  '(student OR undergraduate OR bachelor OR alumni OR "graduated from" OR university OR institute OR college OR polytechnic)';

function quoteTerm(term) {
  const t = String(term || '').trim();
  if (!t) return '';
  return t.includes(' ') ? `"${t}"` : t;
}

/** Build OR-group from role terms + synonyms (longest / most specific first). */
export function buildRoleClause(roleTerms = [], roleSynonyms = [], { maxTerms = 8 } = {}) {
  // Bare category words flood Google; prefer AI-expanded titles (software engineer…).
  const GENERIC = new Set([
    'graduate', 'graduates', 'grad', 'grads', 'student', 'students', 'intern', 'internship',
    'entry', 'level', 'major', 'majors', 'new', 'recent', 'aspiring',
    'tech', 'talent', 'people', 'candidates', 'professionals', 'jobs', 'job',
  ]);
  const merged = [...roleTerms, ...roleSynonyms]
    .map((t) => String(t || '').toLowerCase().trim())
    .filter((t) => t.length >= 3 && !GENERIC.has(t));
  const unique = [...new Set(merged)].sort((a, b) => b.length - a.length);

  // Prefer phrases; drop tokens already covered by a longer phrase ("software"
  // / "engineer" when "software engineer" is present) — bare tokens flood Google
  // with wrong careers. Keep career stems of "X graduate/student".
  const selected = [];
  for (const t of unique) {
    const parent = selected.find((s) => s !== t && s.includes(t));
    if (parent) {
      const stemOfGrad = new RegExp(
        `(?:^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(graduate|graduates|student|students|major|majors)$`,
      );
      if (!stemOfGrad.test(parent)) continue;
    }
    selected.push(t);
    if (selected.length >= maxTerms) break;
  }
  if (!selected.length) return '';
  return `(${selected.map(quoteTerm).join(' OR ')})`;
}

function locationPhrase(location) {
  if (!location) return '';
  const city = String(location.city || '').trim();
  const label = String(location.label || '').trim();
  if (location.scope === 'city' && city) return `"${city}"`;
  if (location.scope === 'city' && label) return `"${label.split(',')[0].trim()}"`;
  if (location.scope === 'country') {
    const country = String(location.country || label.split(',').pop() || label).trim();
    return country ? `"${country}"` : '';
  }
  return label ? `"${label}"` : '';
}

/**
 * Build parallel SerpAPI lanes from avatar + resolved intent.
 * Discovery lane (optional): AI phrases for THIS market — not a hardcoded list.
 * @returns {{ lanes: Array<{query,num,note}>, source: 'assembled' }}
 */
export function assembleLanesFromIntent(avatarType, plan) {
  const roleClause = buildRoleClause(plan.roleTerms, plan.roleSynonyms);
  const loc = locationPhrase(plan.location);
  const locPart = loc ? ` ${loc}` : '';
  const rolePart = roleClause ? ` ${roleClause}` : '';
  const discoveryClause = buildDiscoveryClause(plan.discoveryPhrases);

  if (avatarType === 'avatar1') {
    // When the user named a concrete role, do NOT inject insurance/sales/finance —
    // that was pulling wrong-career grads into software / cyber / etc. searches.
    const userNamedRole = Boolean(roleClause);
    const industryFallback = userNamedRole ? '' : ' (insurance OR sales OR finance)';

    const lanes = [
      {
        query: `site:linkedin.com/in${rolePart}${locPart}${industryFallback} ${classOfTerms()}`,
        num: 25,
        note: 'recent graduate — graduation year on profile',
      },
      {
        query: `site:linkedin.com/in${rolePart}${locPart}${industryFallback} ${GRAD_TERMS}`,
        num: 25,
        note: 'recent-grad / entry-level wording on profile',
      },
      {
        query: `site:linkedin.com/in${rolePart}${locPart}${industryFallback} ${INTERN_TERMS} ${classOfTerms()}`,
        num: 25,
        note: 'recent graduate with internship experience',
      },
      {
        query: `site:linkedin.com/in${rolePart}${locPart}${industryFallback} ${EDUCATION_TERMS}`,
        num: 25,
        note: 'early-career / education wording (universal)',
      },
    ];

    if (discoveryClause) {
      lanes.push({
        query: `site:linkedin.com/in${rolePart}${locPart} ${discoveryClause}`,
        num: 25,
        note: 'local discovery phrases for this search',
      });
    }

    return { source: 'assembled', lanes };
  }

  if (avatarType === 'avatar2') {
    // Broad recall — hard veto drops owners/CEOs after structuring.
    const fromIntent = buildRoleClause(plan.roleTerms, plan.roleSynonyms, { maxTerms: 6 });
    const roles = fromIntent
      ? `(${fromIntent.replace(/^\(|\)$/g, '')} OR producer OR agent OR broker OR advisor OR "account manager")`
      : '(producer OR agent OR "insurance agent" OR "insurance producer" OR broker OR advisor OR "account manager")';
    const industry = ' (insurance OR "insurance agency" OR "insurance agent")';
    const smallFirm =
      '("independent agency" OR "family-owned" OR "2-10 employees" OR "11-50 employees" OR "small agency" OR boutique)';
    const upskill =
      '(upskill OR upskilling OR "career growth" OR "looking to grow" OR "grow my book")';
    const lightExcludes = '-CEO -founder -"co-founder" -owner -proprietor';
    const cityHint = plan.location?.city
      ? ` ${String(plan.location.city).replace(/\b\w/g, (c) => c.toUpperCase())}`
      : '';

    const lanes = [
      {
        query: `site:linkedin.com/in${cityHint} ${roles}${industry} ${smallFirm} ${lightExcludes}`,
        num: 25,
        note: 'producer/agent at small or independent agency',
      },
      {
        query: `site:linkedin.com/in${cityHint} ${roles}${industry} ${upskill} ${lightExcludes}`,
        num: 25,
        note: 'producer/agent talking about upskilling or career growth',
      },
      {
        query: `site:linkedin.com/in${cityHint} ${roles}${industry} ${lightExcludes}`,
        num: 25,
        note: 'insurance producer/agent in target area',
      },
    ];

    if (discoveryClause) {
      lanes.push({
        query: `site:linkedin.com/in${cityHint} ${roles}${industry} ${discoveryClause} ${lightExcludes}`,
        num: 25,
        note: 'local agency-style discovery for this search',
      });
    }

    return { source: 'assembled', lanes };
  }

  return { source: 'assembled', lanes: [] };
}
