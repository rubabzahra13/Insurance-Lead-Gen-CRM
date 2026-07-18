// Runtime search plan: AI resolves INTENT (roles, synonyms, signals).
// SerpAPI lanes are ALWAYS assembled in code from that intent — never free-written by AI.

import { openaiAvailable } from './openai-structure.js';
import { parseJsonFromText } from './parse-json.js';
import { buildAvatarSearch } from './avatar-prompts.js';
import {
  resolveLocationHybrid,
  queryMentionsGeographicPlace,
  mergeFilterTokens,
} from './location-resolver.js';
import { applyHardVeto } from './plan-filter.js';
import { assembleLanesFromIntent } from './lane-assembler.js';

const OPENAI_API = 'https://api.openai.com/v1/chat/completions';

const QUERY_STOPWORDS = new Set([
  'a', 'an', 'the', 'in', 'on', 'at', 'for', 'and', 'or', 'with', 'who', 'looking',
  'seeking', 'new', 'find', 'leads', 'lead', 'people', 'major', 'majors', 'recent',
  'graduate', 'graduates', 'entry', 'level', 'near', 'around',
]);

const AVATAR_RULES = {
  avatar1: {
    label: 'Recent graduates (entry-level)',
    goal:
      'Recent graduates (last ~3 years), ideally with internship experience. Role comes from the user query — do not force insurance/sales/finance when the user named another career.',
    default_role_terms: [],
    default_include: [
      'recent graduate',
      'class of',
      'internship',
      'entry level',
      'student',
      'new grad',
    ],
    default_exclude_titles: ['ceo', 'founder', 'owner', 'director', 'vp', 'president', 'partner', 'principal'],
    default_exclude_roles: [],
  },
  avatar2: {
    label: 'Upgraders (employees at small firms)',
    goal:
      'Insurance producers/agents WORKING at small agencies OR talking about upskilling/career growth. NOT CEOs/founders/owners.',
    default_role_terms: [
      'insurance producer',
      'insurance agent',
      'producer',
      'agent',
      'advisor',
      'broker',
      'account manager',
    ],
    default_include: [
      'small agency',
      'independent agency',
      'family-owned',
      '2-10 employees',
      '11-50 employees',
      'upskill',
      'career growth',
      'looking to grow',
    ],
    default_exclude_titles: [
      'ceo',
      'founder',
      'co-founder',
      'owner',
      'proprietor',
      'managing director',
      'president',
      'chairman',
      'partner',
      'principal',
      'vice president',
    ],
    default_exclude_roles: [
      'actuary',
      'actuarial',
      'attorney',
      'lawyer',
      'counsel',
      'marketing',
      'consulate',
      'chief advisor',
    ],
  },
};

function apiKey() {
  return (process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY)?.trim();
}

function normList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => String(v ?? '').trim().toLowerCase()).filter(Boolean))];
}

const KNOWN_ROLE_PHRASES = [
  'software engineer', 'software developer', 'software engineering',
  'cyber security', 'cybersecurity', 'information security', 'security analyst',
  'data scientist', 'data analyst', 'machine learning', 'ml engineer',
  'product manager', 'project manager', 'business analyst',
  'insurance producer', 'insurance agent', 'insurance advisor', 'account manager',
  'sales rep', 'sales representative', 'financial analyst', 'finance major',
  'claims adjuster', 'underwriting associate', 'full stack developer', 'fullstack developer',
  'frontend developer', 'backend developer', 'web developer',
];

/** Role-ish terms that literally appear in the user's query / role text. */
export function extractRoleTermsFromQuery(userQuery) {
  const raw = String(userQuery ?? '').trim();
  const lower = raw.toLowerCase();
  if (!lower) return [];

  const phrases = [];
  for (const p of KNOWN_ROLE_PHRASES) {
    if (lower.includes(p)) phrases.push(p);
  }

  // UI role box is often the full role ("software engineer") — keep it as one term.
  const words = lower.match(/[a-z][a-z0-9+#.-]{1,}/g) || [];
  const contentWords = words.filter((w) => !QUERY_STOPWORDS.has(w));
  if (contentWords.length >= 2 && contentWords.length <= 5 && raw.length <= 60) {
    const asPhrase = contentWords.join(' ');
    if (!phrases.includes(asPhrase)) phrases.unshift(asPhrase);
  }

  // "finance graduate" / "cyber security student" → also keep the career stem.
  for (const p of [...phrases]) {
    const stem = p.replace(/\s+(graduate|graduates|student|students|major|majors)$/i, '').trim();
    if (stem && stem !== p && stem.length >= 3) phrases.push(stem);
  }

  const fromWords = contentWords.filter((w) => w.length >= 3);
  return [...new Set([...phrases, ...fromWords])];
}

/**
 * Primary role terms from the user query. Synonyms stay separate.
 * Never inject avatar industry defaults when the user named a role.
 */
export function resolvePlanRoleTerms(userQuery, aiTerms, avatarDefaults) {
  const fromQuery = extractRoleTermsFromQuery(userQuery);
  const ai = normList(aiTerms);
  const defaults = normList(avatarDefaults);
  const lower = String(userQuery ?? '').toLowerCase();

  const groundedAi = ai.filter(
    (t) => fromQuery.some((q) => q.includes(t) || t.includes(q)) || lower.includes(t),
  );

  const primary = [...new Set([...fromQuery, ...groundedAi])].filter((t) => t.length >= 3);
  // Prefer multi-word phrases; drop tokens covered by a longer phrase — except
  // career stems of "finance graduate" / "cyber student" which titles rarely copy verbatim.
  const sorted = primary.sort((a, b) => b.length - a.length);
  const compacted = [];
  for (const t of sorted) {
    const parent = compacted.find((c) => c !== t && c.includes(t));
    if (parent) {
      const stemOfGrad = new RegExp(`(?:^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(graduate|graduates|student|students|major|majors)$`);
      if (stemOfGrad.test(parent)) {
        compacted.push(t);
        continue;
      }
      continue;
    }
    compacted.push(t);
  }
  if (compacted.length) return compacted;
  return defaults.filter((t) => t.length >= 3);
}

/** Synonyms must relate to the user's role — drop generics and off-career noise. */
export function resolvePlanRoleSynonyms(userQuery, aiSynonyms, roleTerms) {
  const synonyms = normList(aiSynonyms);
  const GENERIC = new Set([
    'graduate', 'graduates', 'student', 'students', 'intern', 'internship',
    'entry', 'level', 'major', 'majors', 'new', 'recent', 'aspiring',
    'insurance', 'sales', 'finance', 'professional', 'specialist', 'associate',
  ]);
  const roleBlob = [...roleTerms, userQuery].join(' ').toLowerCase();
  const cleaned = synonyms.filter((s) => {
    if (GENERIC.has(s)) return false;
    if (s.length < 3) return false;
    // Keep multi-word job titles and distinctive singles.
    if (/\s/.test(s)) return true;
    return s.length >= 5;
  });

  // If user asked for a tech role, drop insurance/sales synonym noise.
  const techish = /software|developer|engineer|cyber|security|data|programmer|coder|fullstack|frontend|backend/i.test(roleBlob);
  if (techish) {
    return cleaned.filter((s) => !/\binsurance\b|\bagent\b|\bproducer\b|\bbroker\b/i.test(s)).slice(0, 8);
  }
  return cleaned.slice(0, 8);
}

function resolveIncludeSignals(userQuery, aiSignals, avatarDefaults) {
  const ai = normList(aiSignals);
  const defaults = normList(avatarDefaults);
  return [...new Set([...defaults, ...ai])];
}

/** @deprecated AI lanes are no longer used — kept for import compatibility. */
export function normalizeAiLanes() {
  return null;
}

export function planToStructureContext(plan) {
  const loc = plan.location?.label
    ? plan.location.scope === 'country'
      ? `Location: prefer people in ${plan.location.label}. Copy location ONLY if it appears in the result text — never invent a city.`
      : `Location: search targets ${plan.location.label}. Copy location ONLY if it appears in the result text — never invent "${plan.location.city || plan.location.label}".`
    : 'Location: copy only if present in result text.';

  const roles = [...new Set([...(plan.roleTerms || []), ...(plan.roleSynonyms || [])])];

  return [
    '# Runtime search checklist',
    plan.summary,
    loc,
    `Role focus: ${roles.join(', ')}`,
    `Fit signals (preferred): ${plan.includeSignals.join(', ')}`,
    `Never include titles: ${plan.excludeTitles.join(', ')}`,
    `Drop off-role: ${plan.excludeRoles.join(', ')}`,
    plan.avatarType === 'avatar1'
      ? 'Prefer recent graduates / entry-level / students / interns in the requested role.'
      : 'Only EMPLOYEES at small agencies or people talking about upskilling — NEVER CEOs/founders/owners.',
    'CRITICAL: Never invent title, company, or location. Use null when not in the result text.',
    'Extract every person who plausibly matches. Code filters will cull hard misses.',
  ].join('\n');
}

function interpretIntentPrompt(userQuery, avatarType, groundedLocation = null) {
  const rules = AVATAR_RULES[avatarType];
  const locationBlock = groundedLocation
    ? [
        '# Grounded location (FACT — do not change)',
        JSON.stringify({
          label: groundedLocation.label,
          scope: groundedLocation.scope,
          city: groundedLocation.city,
          country: groundedLocation.country,
        }),
        '- Do not invent a different place. You may ignore location in your JSON (code already has it).',
      ].join('\n')
    : '# Location: none grounded. Do not invent a location.';

  return [
    'You resolve a recruiter search into INTENT only (roles + synonyms + signals).',
    'Do NOT write Google/SerpAPI queries. Output JSON only — no markdown.',
    '',
    `# Avatar: ${rules.label}`,
    rules.goal,
    '',
    `# User role / query`,
    `"${userQuery}"`,
    '',
    locationBlock,
    '',
    '# Output schema',
    '{',
    '  "role_terms": ["primary roles the user asked for — usually 1-3 phrases"],',
    '  "role_synonyms": ["close job-title alternatives only — same career family"],',
    '  "include_signals": ["optional extra fit phrases beyond avatar defaults"],',
    '  "exclude_titles": ["extra title excludes if needed"],',
    '  "exclude_roles": ["careers that must NOT match this search"],',
    '  "summary": "one sentence: who to find"',
    '}',
    '',
    '# Rules',
    '- role_terms must reflect the user text (e.g. "software engineer" stays software engineer).',
    '- role_synonyms: expand carefully (software engineer → software developer, programmer).',
    '- Do NOT add insurance/sales/finance synonyms unless the user asked for those careers.',
    '- exclude_roles: list clearly wrong careers for THIS query (e.g. for software engineer: finance, civil engineer, nurse).',
    '- Keep lists short and precise.',
  ].join('\n');
}

async function interpretIntentWithOpenAI(userQuery, avatarType, groundedLocation = null) {
  const key = apiKey();
  if (!key) throw new Error('OPENAI_API_KEY not set');

  const model = process.env.OPENAI_PLAN_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const res = await fetch(OPENAI_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You output strict JSON search INTENT only: roles, synonyms, signals, excludes, summary. ' +
            'Never write Google query strings or SerpAPI lanes. Never invent a location.',
        },
        { role: 'user', content: interpretIntentPrompt(userQuery, avatarType, groundedLocation) },
      ],
    }),
    signal: AbortSignal.timeout(Number(process.env.OPENAI_TIMEOUT_MS ?? 60_000)),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI intent error ${res.status}: ${body.slice(0, 160)}`);
  }

  const data = await res.json();
  const parsed = parseJsonFromText(data?.choices?.[0]?.message?.content ?? '');
  if (!parsed || typeof parsed !== 'object') throw new Error('invalid intent JSON');
  return parsed;
}

export function normalizePlan(raw, userQuery, avatarType, resolved = {}) {
  const rules = AVATAR_RULES[avatarType];
  const location = 'location' in resolved ? resolved.location : raw?.location ?? null;
  const locationStripped = resolved.locationStripped ?? false;

  const roleTerms = resolvePlanRoleTerms(
    userQuery,
    raw?.role_terms,
    rules.default_role_terms,
  );
  const roleSynonyms = resolvePlanRoleSynonyms(userQuery, raw?.role_synonyms, roleTerms);
  const includeSignals = resolveIncludeSignals(userQuery, raw?.include_signals, rules.default_include);
  const excludeTitles = normList([...(rules.default_exclude_titles), ...(raw?.exclude_titles || [])]);
  const excludeRoles = normList([...(rules.default_exclude_roles), ...(raw?.exclude_roles || [])]);

  const summary = String(raw?.summary ?? `${rules.label}: ${userQuery}`).trim();

  const planCore = {
    avatarType,
    userQuery: String(userQuery ?? '').trim(),
    summary,
    roleTerms,
    roleSynonyms,
    location,
    includeSignals,
    excludeTitles,
    excludeRoles,
  };

  const assembled = assembleLanesFromIntent(avatarType, planCore);
  const base = buildAvatarSearch(avatarType, userQuery);

  return {
    source: raw?.source || 'ai',
    ...planCore,
    locationStripped,
    locationSource: resolved.locationSource ?? null,
    lanes: assembled.lanes || [],
    lanesSource: assembled.source || 'assembled',
    hop2: null,
    structureContext: `${base.structureContext}\n\n${planToStructureContext(planCore)}`,
  };
}

async function buildFallbackPlan(userQuery, avatarType, { onLog, uiLocation } = {}) {
  const rules = AVATAR_RULES[avatarType];
  const loc = await resolveLocationHybrid(userQuery, null, { onLog, uiLocation });

  return normalizePlan(
    {
      source: 'fallback',
      role_terms: extractRoleTermsFromQuery(userQuery),
      role_synonyms: [],
      include_signals: rules.default_include,
      exclude_titles: rules.default_exclude_titles,
      exclude_roles: rules.default_exclude_roles,
      summary: `${rules.label}: ${userQuery}`,
    },
    userQuery,
    avatarType,
    {
      location: loc.location,
      locationStripped: loc.stripped,
      locationSource: loc.source,
    },
  );
}

export { queryMentionsGeographicPlace as querySpecifiesLocation };

export async function buildSearchPlan(userQuery, avatarType, { onLog, uiLocation, role } = {}) {
  const roleText = String(role || userQuery || '').trim();
  const queryForDisplay = uiLocation?.label
    ? `${roleText} in ${uiLocation.label}`
    : roleText;
  if (!roleText) throw new Error('Empty search query');

  onLog?.(
    uiLocation
      ? 'Resolving location from selected place...'
      : 'Resolving location (Places primary → AI fallback)...',
  );
  const loc = await resolveLocationHybrid(queryForDisplay, null, { onLog, uiLocation });

  if (openaiAvailable()) {
    try {
      onLog?.('Resolving search intent with AI (roles + synonyms)...');
      const ai = await interpretIntentWithOpenAI(roleText, avatarType, loc.location);

      let location = loc.location;
      // Location is grounded by Places/UI — never let AI replace it.
      // Only merge filter_tokens when AI adds country city lists (rare for intent-only).
      if (location && ai.location) {
        location = mergeFilterTokens(location, ai.location);
      }

      const plan = normalizePlan({ ...ai, source: 'ai', lanes: undefined }, roleText, avatarType, {
        location,
        locationStripped: loc.stripped && !location,
        locationSource: location?.source || loc.source,
      });

      onLog?.(`  plan: ${plan.summary}`);
      onLog?.(`  SerpAPI: ${plan.lanes.length} assembled lanes from intent`);
      onLog?.(`  roles: ${plan.roleTerms.slice(0, 6).join(', ') || '(defaults)'}`);
      if (plan.roleSynonyms.length) {
        onLog?.(`  synonyms: ${plan.roleSynonyms.slice(0, 8).join(', ')}`);
      }
      return plan;
    } catch (error) {
      onLog?.(`  AI intent failed (${error.message}) — using fallback rules`);
    }
  }

  onLog?.('Using fallback search plan');
  return buildFallbackPlan(roleText, avatarType, { onLog, uiLocation });
}

/** Fast code pass using shared hard veto rules. */
export function applyPlanCodeFilter(leads, plan) {
  return applyHardVeto(leads, plan);
}
