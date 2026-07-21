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
import { assembleLanesFromIntent, assembleSimplifiedRecallLanes, assembleUsaRecallLanes } from './lane-assembler.js';
import { isSmallUsaCity, usaLocationFallbacks } from './usa-search-expand.js';
import { sanitizeDiscoveryPhrases } from './discovery-phrases.js';

const OPENAI_API = 'https://api.openai.com/v1/chat/completions';

const AVATAR_RULES = {
  avatar1: {
    label: 'Recent graduates (entry-level)',
    goal:
      'Recent graduates (last ~3 years), ideally with internship experience. Role comes from the user query — do not force insurance/sales/finance when the user named another career.',
    default_exclude_titles: [],
    default_exclude_roles: [],
  },
  avatar2: {
    label: 'Upgraders (employees at small firms)',
    goal:
      'People in the career the user named — working at small/mid firms or signaling upskilling/career growth. NOT CEOs/founders/owners. Expand the user\'s words into every LinkedIn title variant recruiters actually search for in that industry.',
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

/** Role-ish terms that literally appear in the user's query / role text. */
export function extractRoleTermsFromQuery(userQuery) {
  const raw = String(userQuery ?? '').trim();
  if (!raw) return [];
  return [raw.toLowerCase()];
}

/**
 * Primary role terms from the user query. Synonyms stay separate.
 * Never inject avatar industry defaults when the user named a role.
 */
export function resolvePlanRoleTerms(userQuery, aiTerms, avatarDefaults) {
  const ai = normList(aiTerms).filter((t) => t.length >= 2);
  if (ai.length) return ai;
  const fromQuery = extractRoleTermsFromQuery(userQuery);
  if (fromQuery.length) return fromQuery;
  const defaults = normList(avatarDefaults);
  return defaults.filter((t) => t.length >= 2);
}

/**
 * Synonyms: AI expansions for vague roles (tech → software engineer) plus
 * close title alternatives. Ungrounded AI role_terms become synonyms so
 * category searches still get real LinkedIn titles.
 */
export function resolvePlanRoleSynonyms(userQuery, aiSynonyms, roleTerms, aiRoleTerms = []) {
  const synonyms = normList(aiSynonyms);
  const roleSet = new Set(normList(roleTerms));
  const expandedFromAi = normList(aiRoleTerms).filter((t) => !roleSet.has(t) && t.length >= 2);
  const cleaned = [...synonyms, ...expandedFromAi].filter((s) => s.length >= 2 && !roleSet.has(s));
  return [...new Set(cleaned)].slice(0, 16);
}

/** Adjacent titles AI assigns at runtime for near-match scoring and broader search lanes. */
export function resolvePlanRelatedTitles(aiRelated, roleTerms, roleSynonyms) {
  const blocked = new Set([...normList(roleTerms), ...normList(roleSynonyms)]);
  return normList(aiRelated)
    .filter((t) => t.length >= 2 && !blocked.has(t))
    .slice(0, 12);
}

function resolveIncludeSignals(userQuery, aiSignals, avatarDefaults) {
  return normList(aiSignals);
}

/** Offline safety net when AI intent is unavailable — no hardcoded title injection. */
function fallbackCategorySynonyms() {
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
  const related = plan.relatedTitles?.length
    ? `Related titles (near match): ${plan.relatedTitles.join(', ')}`
    : '';

  return [
    '# Runtime search checklist',
    plan.summary,
    loc,
    `Role focus: ${roles.join(', ')}`,
    related,
    `Fit signals (preferred): ${plan.includeSignals.join(', ')}`,
    `Never include titles: ${plan.excludeTitles.join(', ')}`,
    `Drop off-role: ${plan.excludeRoles.join(', ')}`,
    plan.avatarType === 'avatar1'
      ? 'Prefer recent graduates / entry-level / students / interns in the requested role.'
      : 'Employees open to growth — NEVER CEOs/founders/owners.',
    'CRITICAL: Never invent title, company, or location. Use null when not in the result text.',
    'Extract every person who plausibly matches the role family. AI match scoring ranks them after.',
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
          '- discovery_phrases (avatar1): 4-8 short phrases people in THIS market write on LinkedIn.',
          '  Include local campus acronyms, degree labels, program names, and hiring keywords for the role.',
          '  Entry-level titles: use "associate/junior/trainee + role" OR the plain role alone — both appear on LinkedIn.',
          '  Example STYLE: "BSCS", "UT Austin", "nursing degree", "BSN", "marketing internship",',
          '  "software engineer", "junior software engineer", "sales associate", "associate sales representative",',
          '  "financial analyst", "analyst intern", "insurance agent", "associate insurance agent", "registered nurse".',
          '  Generate for the grounded location and the specific career — not generic filler.',
        ].join('\n')
      : [
          '- discovery_phrases (avatar2): 4-8 industry-specific phrases for THIS career in THIS market.',
          '  Insurance → independent agency, licensed producer, P&C, life & health. Finance → Series 65,',
          '  CFP, wealth management, RIA. Sales → quota carrier, B2B SaaS, SDR team. Mortgage → NMLS,',
          '  home lending, retail banking. Use what real profiles in that industry actually say.',
        ].join('\n');

  return [
    'You are a specialized LinkedIn lead-finding expert for recruiters.',
    'Your job: turn a casual recruiter query into the richest possible title map so Google',
    'can find EVERY plausible person — direct hits first, then adjacent roles.',
    'Think like a sourcer who knows industry jargon, abbreviations, license titles, and how',
    'people actually label themselves on LinkedIn (not HR job-post language).',
    '',
    'Output INTENT only (roles + synonyms + related titles + discovery). No Google queries.',
    'The user may write a full sentence — interpret the ROLE they want.',
    'Output JSON only — no markdown.',
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
    '  "role_terms": ["2-4 core role phrases distilled from the user text"],',
    '  "role_synonyms": ["8-14 concrete LinkedIn titles = PERFECT/STRONG matches — be exhaustive"],',
    '  "related_titles": ["5-8 adjacent titles = NEAR match only — same industry, one step removed"],',
    '  "discovery_phrases": ["local + industry phrases for THIS place and career"],',
    '  "include_signals": ["optional extra fit phrases, credentials, license abbreviations"],',
    '  "exclude_titles": ["senior/exec titles to avoid if relevant"],',
    '  "exclude_roles": ["clearly wrong careers for THIS query"],',
    '  "summary": "one sentence: who to find"',
    '}',
    '',
    '# Lead-finder rules (be creative and thorough)',
    '- Parse natural language: "people who do tele sales for insurance" → telesales + insurance sales + phone sales.',
    '- role_terms: the core role(s) distilled — not the whole sentence verbatim.',
    '- role_synonyms: EVERY LinkedIn title that is a direct hit for what the user asked.',
    '  Include: formal titles, informal variants, abbreviations (RN, LO, FA, SDR, CSR), licensed titles,',
    '  compound titles ("Life Insurance Agent", "Licensed Insurance Producer"), and regional wording.',
    '  Insurance telesales → insurance telesales representative, insurance sales agent, insurance producer,',
    '  licensed insurance agent, phone sales insurance, insurance customer service (if they sell).',
    '  Financial advisor → financial advisor, wealth advisor, investment advisor representative, financial consultant,',
    '  private wealth advisor, financial planner (if client-facing).',
    '  Do NOT put adjacent/support roles in role_synonyms — those go in related_titles.',
    '- related_titles: genuinely adjacent — one step away (CSR/call center for telesales; insurance broker for',
    '  life agent; BDR for inside sales). NOT titles that are direct synonyms.',
    '- If vague ("tech grads"), expand aggressively in role_synonyms: software engineer, developer, SWE, etc.',
    '- If colloquial ("tele sales"), normalize ALL LinkedIn variants into role_synonyms.',
    '- include_signals: credentials and industry keywords (NMLS, Series 6/7, CFP, LUTCF, licensed, producer).',
    '- Do NOT inject insurance/sales/finance unless the user asked for those careers.',
    discoveryRules,
    '- discovery_phrases: short plain phrases only — no OR/AND, no site:, no quotes in the string.',
    '- exclude_roles: clearly wrong careers only (nurse when user asked software engineer).',
    '- Err on MORE synonyms rather than fewer — empty Google results hurt more than a broad synonym list.',
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
      temperature: 0.15,
      messages: [
        {
          role: 'system',
          content:
            'You are a specialized LinkedIn lead-finding expert. Output strict JSON search INTENT only: ' +
            'role_terms, role_synonyms (be exhaustive — every direct LinkedIn title variant), related_titles ' +
            '(adjacent only), discovery_phrases, include_signals, excludes, summary. ' +
            'Interpret natural-language role descriptions like a senior sourcer. Never invent a location.',
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
    [],
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
  const relatedTitles = resolvePlanRelatedTitles(raw?.related_titles, roleTerms, withFallbackSynonyms);
  const discoveryPhrases = sanitizeDiscoveryPhrases(raw?.discovery_phrases);
  const includeSignals = resolveIncludeSignals(userQuery, raw?.include_signals, rules.default_include);
  const excludeTitles = normList([...(rules.default_exclude_titles), ...(raw?.exclude_titles || [])]);
  const excludeRoles = normList([...(rules.default_exclude_roles), ...(raw?.exclude_roles || [])]);

  const summary = String(raw?.summary ?? `${rules.label}: ${userQuery}`).trim();

  const enrichedLocation = enrichUsaLocation(location);

  const planCore = {
    avatarType,
    userQuery: String(userQuery ?? '').trim(),
    summary,
    roleTerms,
    roleSynonyms: withFallbackSynonyms,
    relatedTitles,
    discoveryPhrases,
    location: enrichedLocation,
    includeSignals,
    excludeTitles,
    excludeRoles,
  };

  const assembled = assembleLanesFromIntent(avatarType, planCore);
  const fallbackLanes = [
    ...assembleSimplifiedRecallLanes(avatarType, planCore),
    ...assembleUsaRecallLanes(avatarType, planCore, { simplified: true }),
  ].filter((lane, index, all) => all.findIndex((l) => l.query === lane.query) === index);
  const base = buildAvatarSearch(avatarType, userQuery);

  return {
    source: raw?.source || 'ai',
    ...planCore,
    locationStripped,
    locationSource: resolved.locationSource ?? null,
    lanes: assembled.lanes || [],
    fallbackLanes,
    usaSmallCityRecall: Boolean(enrichedLocation?.usaSmallCityRecall),
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
      include_signals: [],
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

function enrichUsaLocation(location) {
  if (!location || !isSmallUsaCity(location)) return location;
  const fallbacks = usaLocationFallbacks(location);
  const recallTokens = [
    ...new Set(fallbacks.flatMap((f) => f.mustInclude || [])),
  ];
  return {
    ...location,
    usaSmallCityRecall: true,
    recallTokens,
    recallLabel: fallbacks.map((f) => f.note).join('; '),
  };
}

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
      if (plan.relatedTitles?.length) {
        onLog?.(`  related: ${plan.relatedTitles.slice(0, 8).join(', ')}`);
      }
      if (plan.discoveryPhrases?.length) {
        onLog?.(`  discovery: ${plan.discoveryPhrases.slice(0, 6).join(', ')}`);
      }
      if (plan.usaSmallCityRecall) {
        onLog?.(`  USA small-market recall: ${plan.location?.recallLabel || 'metro + state lanes added'}`);
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
