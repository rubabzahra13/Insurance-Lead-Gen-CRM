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
import { sanitizeDiscoveryPhrases } from './discovery-phrases.js';

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

/**
 * Synonyms: AI expansions for vague roles (tech → software engineer) plus
 * close title alternatives. Ungrounded AI role_terms become synonyms so
 * category searches still get real LinkedIn titles.
 */
export function resolvePlanRoleSynonyms(userQuery, aiSynonyms, roleTerms, aiRoleTerms = []) {
  const synonyms = normList(aiSynonyms);
  const GENERIC = new Set([
    'graduate', 'graduates', 'grad', 'grads', 'student', 'students', 'intern', 'internship',
    'entry', 'level', 'major', 'majors', 'new', 'recent', 'aspiring',
    'insurance', 'sales', 'finance', 'professional', 'specialist', 'associate',
    'tech', 'talent', 'people', 'candidates', 'professionals',
  ]);
  const roleSet = new Set(normList(roleTerms));
  // Titles AI suggested that grounding dropped from role_terms (e.g. "tech grads"
  // → "software engineer") — keep them as synonyms so lanes actually search them.
  const expandedFromAi = normList(aiRoleTerms).filter((t) => {
    if (roleSet.has(t) || GENERIC.has(t)) return false;
    if (/\s/.test(t)) return t.length >= 5;
    return t.length >= 6;
  });

  const roleBlob = [...roleTerms, userQuery].join(' ').toLowerCase();
  const cleaned = [...synonyms, ...expandedFromAi].filter((s) => {
    if (GENERIC.has(s)) return false;
    if (s.length < 3) return false;
    if (roleSet.has(s)) return false;
    if (/\s/.test(s)) return true;
    return s.length >= 5;
  });

  const unique = [...new Set(cleaned)];

  // If user asked for a tech role, drop insurance/sales synonym noise.
  const techish =
    /software|developer|engineer|cyber|security|data|programmer|coder|fullstack|frontend|backend|\btech\b|\bit\b|\bcs\b/i.test(
      roleBlob,
    );
  if (techish) {
    return unique.filter((s) => !/\binsurance\b|\bagent\b|\bproducer\b|\bbroker\b/i.test(s)).slice(0, 10);
  }
  return unique.slice(0, 10);
}

function resolveIncludeSignals(userQuery, aiSignals, avatarDefaults) {
  const ai = normList(aiSignals);
  const defaults = normList(avatarDefaults);
  return [...new Set([...defaults, ...ai])];
}

/** Offline safety net when AI intent is unavailable — category → LinkedIn titles. */
function fallbackCategorySynonyms(userQuery, avatarType) {
  const lower = String(userQuery || '').toLowerCase();
  if (avatarType === 'avatar1') {
    if (/\btech\b|\bit\b|\bcs\b|computer|software|developer|engineer/.test(lower) && /\b(grad|student|talent|junior|entry)/.test(lower)) {
      return ['software engineer', 'software developer', 'computer science', 'developer'];
    }
    if (/\btech\b/.test(lower) && !/\binsurance|sales|finance|producer|agent/.test(lower)) {
      return ['software engineer', 'software developer', 'computer science', 'developer'];
    }
  }
  if (avatarType === 'avatar2') {
    if (/\bproduc/.test(lower) || /\bagents?\b/.test(lower) || /\bbrokers?\b/.test(lower)) {
      return ['insurance producer', 'insurance agent', 'broker', 'advisor', 'account manager'];
    }
  }
  return [];
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
    : '# Location: none grounded. Leave discovery_phrases empty unless the query itself names a place.';

  const discoveryRules =
    avatarType === 'avatar1'
      ? [
          '- discovery_phrases (avatar1): 3-6 short phrases people in THIS market type on LinkedIn.',
          '  Prefer the ACRONYMS and short names grads actually write (often WITHOUT the word',
          '  "university") plus common degree labels for the role. Example STYLE only: local',
          '  campus acronyms, "BSCS", "computer science" — generate for the grounded location.',
          '  Do NOT invent obscure names. Empty if no location.',
        ].join('\n')
      : [
          '- discovery_phrases (avatar2): 3-6 short agency-style or local insurance-industry phrases',
          '  people in THIS market put on LinkedIn (independent agency wording, local carrier/agency',
          '  style labels, license-adjacent phrases). Not a global mega-brand list. Empty if no location.',
        ].join('\n');

  return [
    'You resolve a recruiter search into INTENT only (roles + synonyms + signals + discovery phrases).',
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
    '  "role_synonyms": ["concrete LinkedIn job titles in the same career family"],',
    '  "discovery_phrases": ["local school/agency phrases for THIS place — see rules"],',
    '  "include_signals": ["optional extra fit phrases beyond avatar defaults"],',
    '  "exclude_titles": ["extra title excludes if needed"],',
    '  "exclude_roles": ["careers that must NOT match this search"],',
    '  "summary": "one sentence: who to find"',
    '}',
    '',
    '# Rules',
    '- role_terms must reflect the user text (e.g. "software engineer" stays software engineer).',
    '- If the user is VAGUE (e.g. "tech grads", "finance students", "producers"), put CONCRETE',
    '  LinkedIn titles in role_synonyms (tech → software engineer, software developer, computer science;',
    '  producers → insurance producer, insurance agent, broker, advisor).',
    '- Also put common degree / field labels for THAT career into role_synonyms or include_signals',
    '  when helpful (e.g. nursing → "nursing student", BSN; architecture → "architecture student").',
    '- role_synonyms: expand carefully; same career family only.',
    '- Do NOT add insurance/sales/finance synonyms unless the user asked for those careers.',
    discoveryRules,
    '- discovery_phrases: short plain phrases only — no OR/AND, no site:, no quotes in the string.',
    '- exclude_roles: list clearly wrong careers for THIS query (e.g. for software engineer: finance, nurse).',
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
            'You output strict JSON search INTENT only: roles, synonyms, discovery_phrases, signals, excludes, summary. ' +
            'For vague queries, expand into real LinkedIn job titles in role_synonyms. ' +
            'discovery_phrases are local market hints for this location only — never Google query strings. ' +
            'Never invent a location.',
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
  const roleSynonyms = resolvePlanRoleSynonyms(
    userQuery,
    raw?.role_synonyms,
    roleTerms,
    raw?.role_terms,
  );
  const withFallbackSynonyms =
    roleSynonyms.length > 0
      ? roleSynonyms
      : resolvePlanRoleSynonyms(
          userQuery,
          fallbackCategorySynonyms(userQuery, avatarType),
          roleTerms,
          [],
        );
  const discoveryPhrases = sanitizeDiscoveryPhrases(raw?.discovery_phrases);
  const includeSignals = resolveIncludeSignals(userQuery, raw?.include_signals, rules.default_include);
  const excludeTitles = normList([...(rules.default_exclude_titles), ...(raw?.exclude_titles || [])]);
  const excludeRoles = normList([...(rules.default_exclude_roles), ...(raw?.exclude_roles || [])]);

  const summary = String(raw?.summary ?? `${rules.label}: ${userQuery}`).trim();

  const planCore = {
    avatarType,
    userQuery: String(userQuery ?? '').trim(),
    summary,
    roleTerms,
    roleSynonyms: withFallbackSynonyms,
    discoveryPhrases,
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
      onLog?.('Resolving search intent with AI (roles + synonyms + discovery)...');
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
      if (plan.discoveryPhrases?.length) {
        onLog?.(`  discovery: ${plan.discoveryPhrases.slice(0, 6).join(', ')}`);
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
