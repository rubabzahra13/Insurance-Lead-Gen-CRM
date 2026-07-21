// Assemble SerpAPI lanes from structured search intent.
// Google Boolean is built in code — AI supplies roles, synonyms, and discovery phrases.

import { buildDiscoveryClause } from './discovery-phrases.js';
import { isSmallUsaCity, usaLocationFallbacks } from './usa-search-expand.js';

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

/** Space-separated role string — reuses buildRoleClause filtering (no industry hardcoding). */
export function buildSimpleRoleWords(plan, { max = 4 } = {}) {
  const hasPrimary = (plan.roleTerms || []).length || (plan.roleSynonyms || []).length;
  const clause = hasPrimary
    ? buildRoleClause(plan.roleTerms || [], plan.roleSynonyms || [], { maxTerms: max })
    : buildRoleClause([], plan.roleSynonyms || plan.relatedTitles || [], { maxTerms: max });
  if (!clause) return '';
  return clause
    .slice(1, -1)
    .split(' OR ')
    .map((s) => s.trim().replace(/^"|"$/g, ''))
    .join(' ');
}

function dedupeLanesByQuery(lanes) {
  const seen = new Set();
  return lanes.filter((lane) => {
    const q = String(lane?.query || '').trim();
    if (!q || seen.has(q)) return false;
    seen.add(q);
    return true;
  });
}

/** Simplified lanes from AI intent — reliable when Boolean OR queries return empty. */
export function assembleSimplifiedRecallLanes(avatarType, plan, { maxRoleWords = 5 } = {}) {
  const loc = locationPhrase(plan.location);
  const locPart = loc ? ` ${loc}` : '';
  const excludes = avatarType === 'avatar2' ? ` ${lightExcludes()}` : '';
  const roleWords = buildSimpleRoleWords(plan, { max: maxRoleWords });
  if (!roleWords) return [];

  const lanes = [
    {
      query: `site:linkedin.com/in ${roleWords}${locPart}${excludes}`,
      num: 25,
      note: 'simplified AI role recall (space-separated titles)',
    },
  ];

  const related = buildSimpleRoleWords({ roleSynonyms: plan.relatedTitles }, { max: 3 });
  if (related) {
    lanes.push({
      query: `site:linkedin.com/in ${related}${locPart}${excludes}`,
      num: 20,
      note: 'simplified related-title recall',
    });
  }

  return lanes;
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

function lightExcludes() {
  return '-CEO -founder -"co-founder" -owner -proprietor';
}

/** USA metro/state lanes when the selected city is too small for LinkedIn recall. */
export function assembleUsaRecallLanes(avatarType, plan, { simplified = false } = {}) {
  const location = plan.location;
  if (!location || !isSmallUsaCity(location)) return [];

  const roleWords = buildSimpleRoleWords(plan, { max: simplified ? 3 : 5 });
  if (!roleWords) return [];

  const excludes = avatarType === 'avatar2' ? ` ${lightExcludes()}` : '';
  const lanes = [];

  for (const fb of usaLocationFallbacks(location)) {
    lanes.push({
      query: `site:linkedin.com/in ${roleWords} ${fb.phrase}${excludes}`,
      num: 25,
      note: fb.note,
      usaRecall: fb.type,
      serpLocation: fb.serpLocation,
    });

    if (!simplified && (plan.relatedTitles || []).length) {
      const related = buildSimpleRoleWords({ roleSynonyms: plan.relatedTitles }, { max: 3 });
      if (related) {
        lanes.push({
          query: `site:linkedin.com/in ${related} ${fb.phrase}${excludes}`,
          num: 20,
          note: `${fb.note} — related titles`,
          usaRecall: fb.type,
          serpLocation: fb.serpLocation,
        });
      }
    }
  }

  return lanes;
}

function appendUsaRecallLanes(lanes, avatarType, plan) {
  if (!isSmallUsaCity(plan.location)) return lanes;
  const recall = assembleUsaRecallLanes(avatarType, plan);
  return [...lanes, ...recall];
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

    const relatedClause = buildRoleClause([], plan.relatedTitles || [], { maxTerms: 8 });
    if (relatedClause) {
      lanes.push({
        query: `site:linkedin.com/in ${relatedClause}${locPart}${industryFallback}`,
        num: 25,
        note: 'related titles from AI intent (near-match recall)',
      });
    }

    return { source: 'assembled', lanes: appendUsaRecallLanes(lanes, avatarType, plan) };
  }

  if (avatarType === 'avatar2') {
    const smallCity = isSmallUsaCity(plan.location);
    const fromIntent = buildRoleClause(plan.roleTerms, plan.roleSynonyms, { maxTerms: 10 });
    const synonymOnly = buildRoleClause([], plan.roleSynonyms || [], { maxTerms: 10 });
    const relatedClause = buildRoleClause([], plan.relatedTitles || [], { maxTerms: 8 });
    const roles = fromIntent || roleClause;
    const lightExcludesStr = lightExcludes();
    const simpleRoles = buildSimpleRoleWords(plan, { max: 4 });
    const cityHint = plan.location?.city
      ? ` ${String(plan.location.city).replace(/\b\w/g, (c) => c.toUpperCase())}`
      : '';
    // Small USA cities: skip useless micro-city lane; recall lanes use Reno/state instead.
    const locSuffix = smallCity ? '' : locPart || cityHint;

    const lanes = [];

    if (roles) {
      lanes.push({
        query: `site:linkedin.com/in${roles}${locSuffix} ${lightExcludesStr}`,
        num: 25,
        note: 'primary role titles from AI intent',
      });
    }

    // Dedicated synonym lane — catches profiles that use variant titles not in the OR mix above.
    if (synonymOnly && synonymOnly !== roles) {
      lanes.push({
        query: `site:linkedin.com/in ${synonymOnly}${locSuffix} ${lightExcludesStr}`,
        num: 25,
        note: 'synonym title expansion from AI intent',
      });
    }

    if (relatedClause) {
      lanes.push({
        query: `site:linkedin.com/in ${relatedClause}${locSuffix} ${lightExcludesStr}`,
        num: 25,
        note: 'related titles from AI intent (near-match recall)',
      });
    }

    const signalClause = buildDiscoveryClause([
      ...(plan.includeSignals || []),
      ...(plan.discoveryPhrases || []),
    ].slice(0, 6));
    if (signalClause && roles) {
      lanes.push({
        query: `site:linkedin.com/in${roles}${locSuffix} ${signalClause} ${lightExcludesStr}`,
        num: 25,
        note: 'credentials and industry signals from AI intent',
      });
    } else if (discoveryClause && roles) {
      lanes.push({
        query: `site:linkedin.com/in${roles}${locSuffix} ${discoveryClause} ${lightExcludesStr}`,
        num: 25,
        note: 'local discovery phrases for this search',
      });
    }

    if (!lanes.length && simpleRoles) {
      lanes.push({
        query: `site:linkedin.com/in ${simpleRoles}${locSuffix} ${lightExcludesStr}`,
        num: 25,
        note: 'simplified role recall',
      });
    }

    if (!lanes.length) {
      lanes.push({
        query: `site:linkedin.com/in${locSuffix} ${lightExcludesStr}`,
        num: 25,
        note: 'broad recall — role terms from query',
      });
    }

    const simplified = assembleSimplifiedRecallLanes('avatar2', plan, { maxRoleWords: 4 });
    return {
      source: 'assembled',
      lanes: dedupeLanesByQuery([...simplified, ...appendUsaRecallLanes(lanes, avatarType, plan)]),
    };
  }

  return { source: 'assembled', lanes: [] };
}
