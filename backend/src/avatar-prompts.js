// Avatar 1/2 main-search recipes (requirements doc §2).
//
// The avatar's qualifying criteria are built INTO the search itself:
//   Avatar 1 — RECENT GRADUATES (ideally with some internship experience) in
//              insurance/sales/finance. We match on graduation-year + school +
//              intern signals, NOT on an explicit "open to work" badge.
//   Avatar 2 — two-hop search: find SMALL companies first (employee range is
//              visible on indexed linkedin.com/company pages), then find the
//              people who work at them. Small-company fit is confirmed by
//              construction, not guessed afterwards.
//
// Each lead must carry fit_evidence (exact text seen) and fit_source
// (profile | own_post | company_page | other). Data seen only on pages other
// than the person's own profile/post is allowed but flagged weak.
// Avatar 3 (business owners) is a separate workflow and is NOT handled here.

const INDUSTRY_WORDS = [
  'insurance', 'sales', 'finance', 'financial', 'banking', 'mortgage',
  'agent', 'broker', 'producer', 'advisor',
];

function hasIndustryWord(query) {
  const lower = query.toLowerCase();
  return INDUSTRY_WORDS.some((word) => lower.includes(word));
}

// "Recent" = graduated within the last ~3 years (dynamic so it never goes stale).
function recentGradYears() {
  const year = new Date().getFullYear();
  return [year, year - 1, year - 2];
}

// Graduation-year signal, e.g. ("Class of 2026" OR "Class of 2025" OR "Class of 2024").
function classOfTerms() {
  return `(${recentGradYears().map((y) => `"Class of ${y}"`).join(' OR ')})`;
}

const GRAD_TERMS = '("recent graduate" OR "new grad" OR "recent grad" OR "aspiring" OR "entry level" OR "entry-level")';
const INTERN_TERMS = '(intern OR internship OR "summer analyst")';

function avatar1Recipe(query) {
  const industry = hasIndustryWord(query) ? '' : ' (insurance OR sales OR finance)';
  return [
    'Target: RECENT GRADUATES (graduated in the last ~3 years), ideally with some',
    'internship experience, interested in insurance/sales/finance. NOT seasoned',
    'professionals, and NOT just anyone who wrote "open to work".',
    'Run these search lanes (multiple searches allowed):',
    '',
    `LANE 1 — graduation year: site:linkedin.com/in ${query}${industry} ${classOfTerms()}`,
    `LANE 2 — recent-grad / entry-level wording: site:linkedin.com/in ${query}${industry} ${GRAD_TERMS}`,
    `LANE 3 — grad + internship: site:linkedin.com/in ${query}${industry} ${INTERN_TERMS} ${classOfTerms()}`,
    '',
    'A good lead shows a recent graduation year, a university, and/or an internship.',
    'For every person, record fit evidence: the exact graduation-year / recent-grad /',
    'internship text you saw, and where you saw it (usually their profile).',
    'Prefer people who show BOTH a recent degree and an internship, but a recent',
    'graduate with no internship still qualifies.',
  ].join('\n');
}

function avatar2Recipe(query) {
  const industry = hasIndustryWord(query) ? query : `insurance ${query}`;
  return [
    'Target: Job UPGRADERS — working individuals changing jobs for better opportunities',
    '(career growth / upskilling), often at small insurance agencies.',
    'NOT CEOs, founders, owners, or people looking to grow a company/team.',
    '',
    'Run these parallel profile search lanes (same pattern as Avatar 1):',
    '',
    `LANE 1 — small/independent agency: site:linkedin.com/in ${industry} (producer OR agent) ("independent agency" OR "family-owned" OR "2-10 employees" OR "11-50 employees")`,
    `LANE 2 — career-move talk: site:linkedin.com/in ${industry} (producer OR agent) (upskill OR "career growth" OR "looking for a new role" OR "open to opportunities")`,
    `LANE 3 — insurance producer/agent in area: site:linkedin.com/in ${industry} (producer OR agent) -CEO -founder -owner`,
    '',
    'EXCLUDE anyone whose title is CEO, founder, co-founder, owner, or proprietor.',
    'fit_evidence = company-size text, small-firm wording, OR career-growth / job-change wording.',
  ].join('\n');
}

const AVATAR_STRUCTURE_CONTEXT = {
  avatar1: [
    '# Avatar context: Recent graduates (entry-level)',
    'Only include RECENT GRADUATES (graduated in roughly the last 3 years), ideally',
    'with internship experience, oriented toward insurance/sales/finance. Exclude',
    'seasoned professionals with many years of full-time experience.',
    'LOCATION is a hard filter from the search intent: if the query names a city,',
    'region, or country (e.g. "Pakistan", "Dallas"), ONLY include people whose',
    'result text places them there. Drop people listed in a different country',
    '(e.g. "US", "Tucson") even if their major/role matches.',
    'fit_evidence = the exact text proving they are a recent grad (graduation year,',
    'university + recent degree, "recent graduate", or an internship role).',
    'past_experience = internship(s) if the profile shows them (e.g. "Sales Intern at X, 2025").',
    'fit_source = "profile" (their own profile page), "own_post", "company_page", or "other".',
  ].join('\n'),
  avatar2: [
    '# Avatar context: Upgraders (career movers / better opportunities)',
    'Include ONLY working individuals who may change jobs for better opportunities,',
    'often at a small insurance/sales agency OR who talk about upskilling / career growth.',
    'HARD EXCLUDE: CEO, founder, co-founder, owner, proprietor, managing director,',
    'president, even if their company is small. Business owners are NOT upgraders.',
    'Do NOT target people looking to grow a team or hire. Upgraders are changing their own job.',
    'Prefer titles like producer, agent, advisor, broker, account manager.',
    'Drop actuaries, lawyers, marketers, consulate staff, and other non-producer roles.',
    'LOCATION is a hard filter from the search intent: if the query names a city,',
    'region, or country, ONLY include people whose result text places them there.',
    'fit_evidence = small-firm size text, independent/family-owned wording, OR',
    'upskilling / career-growth wording from their profile.',
    'fit_source = "company_page" when size came from the company page, "profile" when',
    'from their own profile, "other" otherwise.',
  ].join('\n'),
};

const ENRICHED_PROFILE_CONTRACT = [
  '# Enriched profile fields (add to every person)',
  '- past_experience: previous roles/employers IF the result text states them',
  '  (e.g. "Former Allstate agent", "10 years in mortgage lending") | null',
  '- fit_evidence: exact quote proving the avatar fit (required — drop the person if you have none)',
  '- fit_source: "profile" | "own_post" | "company_page" | "other"',
  '- weak_fields: array of field names whose value came from a page OTHER than the',
  '  person\'s own profile or own post (e.g. a directory, someone else\'s post, a news page).',
  '  Such values are allowed but are NOT strong evidence — always list them. [] if none.',
  '',
  'Extended output example:',
  '{"name":"Jane Doe","title":"Producer","company":"Acme Insurance","location":null,',
  ' "past_experience":"Former Allstate agent (2018-2023)","fit_evidence":"Acme Insurance · 11-50 employees",',
  ' "fit_source":"company_page","weak_fields":["past_experience"],"snippet":"...","evidence":"...","link":null}',
].join('\n');

const AVATAR_LABELS = {
  avatar1: 'Recent graduates (entry-level)',
  avatar2: 'Upgraders (agents at smaller firms)',
};

export function buildAvatarSearch(avatarType, userQuery) {
  const query = String(userQuery ?? '').trim();
  if (!AVATAR_LABELS[avatarType] || !query) {
    return { searchPrompt: query, recipe: null, structureContext: null, label: null, enriched: false };
  }

  const recipe = avatarType === 'avatar1' ? avatar1Recipe(query) : avatar2Recipe(query);
  const structureContext = `${AVATAR_STRUCTURE_CONTEXT[avatarType]}\n\n${ENRICHED_PROFILE_CONTRACT}`;

  return {
    // Human-readable intent: drives the structuring stage's "# Search intent"
    // and is stored on each lead as search_prompt.
    searchPrompt: `${AVATAR_LABELS[avatarType]} — ${query}`,
    recipe,
    structureContext,
    label: AVATAR_LABELS[avatarType],
    enriched: true,
  };
}

// Back-compat shim for callers that only need the search text.
export function buildAvatarSearchPrompt(avatarType, userQuery) {
  const { searchPrompt, label, enriched } = buildAvatarSearch(avatarType, userQuery);
  return { searchPrompt, label, enriched };
}

// Concrete Google query strings for the SERP-API engine (not prose for an LLM).
// Avatar 1: three parallel profile/post lanes.
// Avatar 2: three parallel profile lanes (mirrors Avatar 1) — small-firm / upskill
// signals are baked into the Google queries, then hard-filtered after structuring.
export function buildAvatarLanes(avatarType, userQuery, { locationQuery, plan } = {}) {
  const query = String(locationQuery || userQuery || '').trim();
  if (!query) return { avatarType, lanes: [], hop2: null };

  const roleTerms = plan?.role_terms || plan?.roleTerms;
  const roleOr = (terms, fallback) => {
    const list = Array.isArray(terms) ? terms.filter(Boolean) : [];
    if (!list.length) return fallback;
    return `(${list.map((t) => `"${t}"`).join(' OR ')})`;
  };

  if (avatarType === 'avatar1') {
    // Only add industry defaults when the user did not name a concrete role.
    const roleClause = roleOr(roleTerms, '');
    const industry = roleClause || hasIndustryWord(query) ? '' : ' (insurance OR sales OR finance)';
    const rolePrefix = roleClause ? ` ${roleClause}` : '';
    return {
      avatarType,
      lanes: [
        {
          query: `site:linkedin.com/in ${query}${rolePrefix}${industry} ${classOfTerms()}`,
          num: 25,
          note: 'recent graduate — graduation year on profile',
        },
        {
          query: `site:linkedin.com/in ${query}${rolePrefix}${industry} ${GRAD_TERMS}`,
          num: 25,
          note: 'recent-grad / entry-level wording on profile',
        },
        {
          query: `site:linkedin.com/in ${query}${rolePrefix}${industry} ${INTERN_TERMS} ${classOfTerms()}`,
          num: 25,
          note: 'recent graduate with internship experience',
        },
      ],
      hop2: null,
    };
  }

  if (avatarType === 'avatar2') {
    const industry = hasIndustryWord(query) ? '' : ' (insurance OR sales OR finance)';
    const roleClause =
      roleOr(roleTerms, null)
      || '("insurance producer" OR "insurance agent" OR producer OR "insurance advisor" OR broker OR "account manager")';
    const smallFirmTerms =
      '("independent agency" OR "family-owned" OR "family owned" OR "2-10 employees" OR "11-50 employees" OR "small agency" OR "local agency" OR boutique)';
    const upskillTerms =
      '(upskill OR upskilling OR "career growth" OR "looking to grow" OR "grow my book" OR "join a larger" OR "ready for more")';
    const excludeOwners =
      '-CEO -founder -"co-founder" -owner -proprietor -"managing director" -partner -principal -actuary -actuarial';

    return {
      avatarType,
      lanes: [
        {
          query: `site:linkedin.com/in ${query} ${roleClause}${industry} ${smallFirmTerms} ${excludeOwners}`,
          num: 25,
          note: 'producer/agent at small or independent agency',
        },
        {
          query: `site:linkedin.com/in ${query} ${roleClause}${industry} ${upskillTerms} ${excludeOwners}`,
          num: 25,
          note: 'producer/agent talking about upskilling or career growth',
        },
        {
          query: `site:linkedin.com/in ${query} ${roleClause}${industry} ("insurance" OR agency) ${excludeOwners}`,
          num: 25,
          note: 'insurance producer/agent in target area',
        },
      ],
      hop2: null,
    };
  }

  return { avatarType, lanes: [], hop2: null };
}

// Pull a company name from a LinkedIn company-page result title, e.g.
// "Smith Family Insurance | LinkedIn" -> "Smith Family Insurance".
export function companyNameFromResult(title) {
  if (!title) return null;
  const name = title.split('|')[0].split('•')[0].trim();
  if (!name || name.length < 2) return null;
  return name;
}
