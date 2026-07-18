// Shared hard veto rules applied after code filter AND after LLM filter.
// These cannot be overridden by the LLM.

import {
  isOwnerOrFounderTitle,
  hasProducerRole,
  hasUpgraderFitSignal,
  isOffRole,
} from './avatar2-fit.js';

const RECENT_GRAD_RE =
  /(class of (20\d{2})|recent grad(uate)?|new grad\b|aspiring|entry.?level|seeking entry|\bstudent\b|\bintern(ship)?\b|summer analyst|undergraduate|graduated from|studying at|alumni|bachelor)/i;

export function leadBlob(lead) {
  return [
    lead.name,
    lead.title,
    lead.headline,
    lead.role,
    lead.company,
    lead.location,
    lead.snippet,
    lead.evidence,
    lead.fit_evidence,
    lead.past_experience,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function tokenHit(corpus, token) {
  if (!token) return false;
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (token.length <= 3) {
    return new RegExp(`(?:^|[^a-z])${esc}(?:[^a-z]|$)`, 'i').test(corpus);
  }
  return corpus.includes(token);
}

export function leadMatchesPlanLocation(lead, location) {
  if (!location?.tokens?.length) return true;
  const corpus = leadBlob(lead);
  const locField = String(lead.location ?? '').toLowerCase().trim();

  // Explicit profile location that contradicts the required city → drop.
  if (location.scope === 'city' && (location.mustInclude || []).length && locField) {
    const locOk = location.mustInclude.some((token) => tokenHit(locField, token));
    if (!locOk) return false;
  }

  if (!corpus.trim()) {
    // Empty text: city searches already used SerpAPI geo — allow.
    return location.scope === 'city';
  }

  // City/region strict scope.
  const must = location.mustInclude || [];
  const mustHit = must.length === 0 || must.some((token) => tokenHit(corpus, token));

  if (!mustHit && location.scope === 'city') {
    // LinkedIn SERP snippets often omit the city even when Google was geo-scoped.
    // Trust SerpAPI location bias unless another city clearly appears.
    if (locField) return false;
    if (hasConflictingCitySignal(corpus, location)) return false;
    return true;
  }

  if (!mustHit) return false;

  // Country-wide: any city/region token for that country counts.
  const hit = location.tokens.some((token) => tokenHit(corpus, token));
  if (!hit) return false;

  const wantsUs = location.gl === 'us' || location.tokens.includes('united states');
  if (!wantsUs) {
    const usSignals = [
      /\bunited states\b/i,
      /\busa\b/i,
      /\bu\.s\.a?\b/i,
      /\b\w+,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV)\b/,
    ];
    const loc = String(lead.location ?? '');
    if (usSignals.some((re) => re.test(loc) || re.test(corpus))) {
      const strong = location.tokens.filter((t) => t.length >= 5).some((t) => corpus.includes(t));
      if (!strong) return false;
    }
  }
  return true;
}

/** Other cities mentioned without the required city — used for soft city matching. */
function hasConflictingCitySignal(corpus, location) {
  const must = new Set((location.mustInclude || []).map((t) => t.toLowerCase()));
  // Common alternate cities (esp. Pakistan) + any long filter tokens that aren't required.
  const extras = [
    'karachi', 'lahore', 'peshawar', 'multan', 'faisalabad', 'quetta', 'rawalpindi',
    'hyderabad', 'sialkot', 'gujranwala', 'chicago', 'new york', 'houston', 'dallas',
    'london', 'toronto', 'dubai',
    ...(location.tokens || []).filter((t) => t.length >= 5 && !must.has(t)),
  ];
  // Country names are not city conflicts.
  const countries = new Set(['pakistan', 'united states', 'usa', 'canada', 'uk', 'uae', 'india']);
  return extras.some((city) => !countries.has(city) && !must.has(city) && tokenHit(corpus, city));
}

function leadPassesExcludes(lead, plan) {
  const title = String(lead.title || lead.headline || lead.role || '');
  const blob = leadBlob(lead);

  if (isOwnerOrFounderTitle(title)) return false;
  if (plan.avatarType === 'avatar2' && isOwnerOrFounderTitle(blob) && !hasProducerRole(title)) return false;
  if (plan.avatarType === 'avatar2' && isOffRole(title)) return false;
  if (plan.avatarType === 'avatar2' && isOffRole(blob) && !hasProducerRole(title)) return false;

  for (const t of plan.excludeTitles || []) {
    const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(title)) return false;
  }
  for (const r of plan.excludeRoles || []) {
    const re = new RegExp(`\\b${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(title)) return false;
  }
  return true;
}

function stemToken(token) {
  return String(token || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.]/g, '')
    .replace(/ining$/, 'ine')
    .replace(/ings$/, '')
    .replace(/ing$/, '')
    .replace(/ers$/, 'er')
    .replace(/ies$/, 'y')
    .replace(/s$/, '');
}

function textHasTerm(text, term) {
  if (!term) return false;
  if (text.includes(term)) return true;
  const stem = stemToken(term);
  if (stem.length < 4) return false;
  return text.split(/[^a-z0-9+#.]+/).some((w) => stemToken(w) === stem);
}

function hasRoleMatch(lead, plan) {
  const roleTerms = (plan.roleTerms || [])
    .map((t) => String(t || '').toLowerCase().trim())
    .filter((t) => t.length >= 3);
  const synonyms = (plan.roleSynonyms || [])
    .map((t) => String(t || '').toLowerCase().trim())
    .filter((t) => t.length >= 3);
  const terms = [...roleTerms, ...synonyms];
  if (!terms.length) return false;

  // Generic avatar words alone must not count as a role match.
  const GENERIC = new Set([
    'graduate', 'graduates', 'student', 'students', 'intern', 'internship',
    'entry', 'level', 'major', 'majors', 'new', 'recent', 'aspiring',
    'insurance', 'sales', 'finance',
  ]);
  const pool = terms.filter((t) => !GENERIC.has(t)).sort((a, b) => b.length - a.length);
  const use = pool.length ? pool : terms;

  // Title/headline first — snippet blob alone caused wrong-career keeps
  // (e.g. "Software Engineer" buried next to an unrelated primary title).
  const title = [lead.title, lead.headline, lead.role].filter(Boolean).join(' ').toLowerCase();
  const blob = leadBlob(lead);
  const inTitle = (t) => textHasTerm(title, t);
  const inBlob = (t) => textHasTerm(blob, t);

  const phrases = use.filter((t) => /\s/.test(t));
  if (phrases.some(inTitle)) return true;

  const primaryPhrases = roleTerms.filter((t) => /\s/.test(t) && !GENERIC.has(t));
  for (const phrase of primaryPhrases) {
    const words = phrase.split(/\s+/).filter((w) => w.length >= 3 && !GENERIC.has(w));
    if (words.length >= 2 && words.every((w) => inTitle(w))) return true;
  }

  // Synonym singles / tails must appear in the TITLE (not only snippet).
  const primaryWords = new Set(primaryPhrases.flatMap((p) => p.split(/\s+/)));
  const singles = use.filter((t) => !/\s/.test(t) && !primaryWords.has(t) && !GENERIC.has(t));
  const synonymTails = synonyms
    .filter((t) => /\s/.test(t))
    .map((t) => t.split(/\s+/).filter((w) => w.length >= 6 && !GENERIC.has(w)).at(-1))
    .filter((w) => w && !primaryWords.has(w));
  const distinctive = [...new Set([...singles, ...synonymTails])];
  if (distinctive.some((t) => t.length >= 5 && inTitle(t))) return true;

  // Snippet fallback for primary phrases only when the title is empty/weak OR
  // already shares a primary role word (avoids PM titles kept via buried SE text).
  const titleHasPrimaryWord = primaryPhrases.some((phrase) =>
    phrase.split(/\s+/).some((w) => w.length >= 3 && !GENERIC.has(w) && inTitle(w)),
  );
  if (!title.trim() || titleHasPrimaryWord) {
    if (primaryPhrases.some(inBlob)) return true;
    for (const phrase of primaryPhrases) {
      const words = phrase.split(/\s+/).filter((w) => w.length >= 3 && !GENERIC.has(w));
      if (words.length >= 2 && words.every((w) => inBlob(w))) return true;
    }
  }

  if (!phrases.length) {
    if (use.some(inTitle)) return true;
    return use.some(inBlob);
  }
  return false;
}

const SENIOR_TITLE_RE =
  /\b(senior|staff|principal|lead|manager|director|head of|vp\b|vice president|chief|ceo|cto|cfo)\b/i;

function hasIncludeMatch(lead, plan) {
  const blob = leadBlob(lead);
  return (plan.includeSignals || []).some((s) => s.length >= 3 && blob.includes(s));
}

/** Avatar 1: recent grad AND searched role. Avatar 2: producer + fit signal. */
export function leadMatchesAvatarSignals(lead, plan) {
  if (!leadPassesExcludes(lead, plan)) return false;
  const blob = leadBlob(lead);

  if (plan.avatarType === 'avatar1') {
    if (!hasRoleMatch(lead, plan)) return false;
    const title = String(lead.title || lead.headline || lead.role || '');
    // Prefer explicit recent-grad signals; also allow non-senior titles that
    // already match the searched role (many juniors omit "student"/"intern").
    const hasGrad = RECENT_GRAD_RE.test(blob) || hasIncludeMatch(lead, plan);
    if (hasGrad) return true;
    return Boolean(title.trim()) && !SENIOR_TITLE_RE.test(title);
  }

  if (plan.avatarType === 'avatar2') {
    const title = String(lead.title || lead.headline || lead.role || '');
    const roleOk = hasProducerRole(title) || hasRoleMatch(lead, plan);
    const fitOk =
      hasUpgraderFitSignal(blob, lead)
      || hasIncludeMatch(lead, plan)
      || (roleOk && Boolean(String(lead.company ?? '').trim()) && !isOwnerOrFounderTitle(title));
    return roleOk && fitOk;
  }

  return true;
}

/** Full hard veto — location + avatar fit + owner excludes. */
export function passesHardVeto(lead, plan) {
  if (!leadPassesExcludes(lead, plan)) return false;
  if (!leadMatchesPlanLocation(lead, plan.location)) return false;
  if (!leadMatchesAvatarSignals(lead, plan)) return false;
  return true;
}

export function applyHardVeto(leads, plan) {
  const kept = [];
  const dropped = [];
  for (const lead of leads) {
    if (passesHardVeto(lead, plan)) kept.push(lead);
    else dropped.push({ lead, reason: 'hard veto' });
  }
  return { leads: kept, dropped };
}
