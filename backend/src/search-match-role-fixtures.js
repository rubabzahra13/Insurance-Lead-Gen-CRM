/**
 * Role catalog for QA — finance, sales, insurance, and other careers.
 * Each scenario simulates AI intent output at runtime (no hardcoded filters).
 */

export const USA_LOCATIONS = {
  dallas: {
    label: 'Dallas, TX, USA',
    scope: 'city',
    city: 'Dallas',
    country: 'United States',
    gl: 'us',
    tokens: ['dallas', 'texas', 'united states', 'usa'],
    mustInclude: ['dallas'],
  },
  newYork: {
    label: 'New York, NY, USA',
    scope: 'city',
    city: 'New York',
    country: 'United States',
    gl: 'us',
    tokens: ['new york', 'united states', 'usa'],
    mustInclude: ['new york'],
  },
  chicago: {
    label: 'Chicago, IL, USA',
    scope: 'city',
    city: 'Chicago',
    country: 'United States',
    gl: 'us',
    tokens: ['chicago', 'illinois', 'united states', 'usa'],
    mustInclude: ['chicago'],
  },
  austin: {
    label: 'Austin, TX, USA',
    scope: 'city',
    city: 'Austin',
    country: 'United States',
    gl: 'us',
    tokens: ['austin', 'texas', 'united states', 'usa'],
    mustInclude: ['austin'],
  },
  atlanta: {
    label: 'Atlanta, GA, USA',
    scope: 'city',
    city: 'Atlanta',
    country: 'United States',
    gl: 'us',
    tokens: ['atlanta', 'georgia', 'united states', 'usa'],
    mustInclude: ['atlanta'],
  },
};

/** @typedef {'insurance'|'sales'|'finance'|'other'} RoleCategory */

/**
 * @type {Array<{
 *   id: string,
 *   category: RoleCategory,
 *   userQuery: string,
 *   avatarType: 'avatar1'|'avatar2',
 *   locationKey: keyof typeof USA_LOCATIONS,
 *   intent: object,
 *   shouldPass: Array<{ title: string, name?: string, company?: string, snippet?: string, location?: string }>,
 *   shouldBlock: Array<{ title: string, snippet?: string, location?: string, reason?: string }>,
 *   laneMustMatch?: RegExp,
 *   laneMustNotMatch?: RegExp,
 * }>}
 */
export const ROLE_SCENARIOS = [
  // ── Insurance ─────────────────────────────────────────────────────────────
  {
    id: 'INS-001',
    category: 'insurance',
    userQuery: 'insurance telesales reps looking to upgrade',
    avatarType: 'avatar2',
    locationKey: 'dallas',
    intent: {
      role_terms: ['insurance telesales', 'insurance sales'],
      role_synonyms: ['insurance agent', 'insurance producer', 'insurance sales representative'],
      related_titles: ['customer service representative', 'call center agent', 'inside sales representative'],
      exclude_roles: ['software engineer', 'registered nurse'],
      summary: 'Insurance telesales professionals in Dallas open to growth.',
    },
    shouldPass: [
      { title: 'Insurance Agent', name: 'Agent A', company: 'State Farm', location: 'Dallas, TX' },
      { title: 'Insurance Producer', name: 'Agent B', location: 'Dallas, TX' },
      { title: 'Customer Service Representative', name: 'CSR C', company: 'Concentrix', location: 'Dallas, TX' },
    ],
    shouldBlock: [
      { title: 'Software Engineer', snippet: 'Software Engineer in Dallas, TX', reason: 'exclude_roles' },
      { title: 'CEO', company: 'Agency', reason: 'owner exclude' },
    ],
    laneMustMatch: /insurance agent|insurance telesales|insurance producer/i,
    laneMustNotMatch: /\(producer OR agent OR "insurance agent" OR "insurance producer"/,
  },
  {
    id: 'INS-002',
    category: 'insurance',
    userQuery: 'life insurance agents at small agencies',
    avatarType: 'avatar2',
    locationKey: 'chicago',
    intent: {
      role_terms: ['life insurance agent'],
      role_synonyms: ['life insurance producer', 'life insurance advisor', 'insurance agent'],
      related_titles: ['financial advisor', 'insurance sales associate'],
      exclude_roles: ['software engineer', 'nurse'],
      summary: 'Life insurance agents at small agencies in Chicago.',
    },
    shouldPass: [
      { title: 'Life Insurance Agent', location: 'Chicago, IL' },
      { title: 'Life Insurance Producer', location: 'Chicago, IL' },
    ],
    shouldBlock: [{ title: 'Registered Nurse', location: 'Chicago, IL' }],
    laneMustMatch: /life insurance agent|life insurance producer/i,
  },
  {
    id: 'INS-003',
    category: 'insurance',
    userQuery: 'recent grads interested in insurance sales careers',
    avatarType: 'avatar1',
    locationKey: 'dallas',
    intent: {
      role_terms: ['insurance sales', 'insurance agent'],
      role_synonyms: ['insurance sales trainee', 'associate insurance agent', 'licensed insurance agent'],
      related_titles: ['customer service representative', 'sales development representative'],
      exclude_roles: ['software engineer'],
      summary: 'Entry-level insurance sales candidates in Dallas.',
    },
    shouldPass: [
      { title: 'Insurance Sales Trainee', location: 'Dallas, TX' },
      { title: 'Associate Insurance Agent', location: 'Dallas, TX' },
    ],
    shouldBlock: [{ title: 'Software Engineer', location: 'Dallas, TX' }],
    laneMustNotMatch: /\(insurance OR sales OR finance\)/,
  },

  // ── Sales ─────────────────────────────────────────────────────────────────
  {
    id: 'SAL-001',
    category: 'sales',
    userQuery: 'inside sales reps for B2B SaaS',
    avatarType: 'avatar2',
    locationKey: 'atlanta',
    intent: {
      role_terms: ['inside sales representative', 'inside sales'],
      role_synonyms: ['inside sales rep', 'B2B sales representative', 'sales development representative'],
      related_titles: ['account executive', 'business development representative', 'customer success manager'],
      exclude_roles: ['registered nurse', 'software engineer'],
      summary: 'Inside sales reps selling B2B SaaS in Atlanta.',
    },
    shouldPass: [
      { title: 'Inside Sales Representative', location: 'Atlanta, GA' },
      { title: 'B2B Sales Representative', location: 'Atlanta, GA' },
      { title: 'Business Development Representative', location: 'Atlanta, GA' },
    ],
    shouldBlock: [{ title: 'Registered Nurse', location: 'Atlanta, GA' }],
    laneMustMatch: /inside sales|B2B sales|sales development representative/i,
  },
  {
    id: 'SAL-002',
    category: 'sales',
    userQuery: 'account executives hunting enterprise deals',
    avatarType: 'avatar2',
    locationKey: 'newYork',
    intent: {
      role_terms: ['account executive', 'enterprise sales'],
      role_synonyms: ['senior account executive', 'enterprise account executive', 'strategic account manager'],
      related_titles: ['sales manager', 'regional sales director'],
      exclude_roles: ['nurse', 'teacher'],
      summary: 'Enterprise account executives in New York.',
    },
    shouldPass: [
      { title: 'Account Executive', location: 'New York, NY' },
      { title: 'Enterprise Account Executive', location: 'New York, NY' },
    ],
    shouldBlock: [{ title: 'Elementary School Teacher', location: 'New York, NY' }],
    laneMustMatch: /account executive|enterprise account executive/i,
  },
  {
    id: 'SAL-003',
    category: 'sales',
    userQuery: 'college grads looking for entry level sales jobs',
    avatarType: 'avatar1',
    locationKey: 'dallas',
    intent: {
      role_terms: ['sales representative', 'entry level sales'],
      role_synonyms: ['sales associate', 'junior sales representative', 'sales trainee'],
      related_titles: ['customer service representative', 'retail sales associate'],
      exclude_roles: ['software engineer'],
      summary: 'Recent grads seeking entry-level sales in Dallas.',
    },
    shouldPass: [
      { title: 'Sales Associate', location: 'Dallas, TX' },
      { title: 'Junior Sales Representative', location: 'Dallas, TX' },
    ],
    shouldBlock: [{ title: 'Software Engineer', location: 'Dallas, TX' }],
  },

  // ── Finance ───────────────────────────────────────────────────────────────
  {
    id: 'FIN-001',
    category: 'finance',
    userQuery: 'financial advisors building a client book',
    avatarType: 'avatar2',
    locationKey: 'newYork',
    intent: {
      role_terms: ['financial advisor', 'wealth advisor'],
      role_synonyms: ['financial consultant', 'wealth management advisor', 'investment advisor representative'],
      related_titles: ['financial planner', 'relationship banker', 'private banker'],
      exclude_roles: ['software engineer', 'nurse'],
      summary: 'Financial advisors growing client books in New York.',
    },
    shouldPass: [
      { title: 'Financial Advisor', location: 'New York, NY' },
      { title: 'Wealth Management Advisor', location: 'New York, NY' },
      { title: 'Financial Planner', location: 'New York, NY' },
    ],
    shouldBlock: [{ title: 'Software Engineer', location: 'New York, NY' }],
    laneMustMatch: /financial advisor|wealth management advisor|financial consultant/i,
  },
  {
    id: 'FIN-002',
    category: 'finance',
    userQuery: 'mortgage loan officers at local banks',
    avatarType: 'avatar2',
    locationKey: 'dallas',
    intent: {
      role_terms: ['mortgage loan officer', 'loan officer'],
      role_synonyms: ['mortgage banker', 'home lending officer', 'mortgage originator'],
      related_titles: ['relationship banker', 'credit analyst'],
      exclude_roles: ['registered nurse'],
      summary: 'Mortgage loan officers at banks in Dallas.',
    },
    shouldPass: [
      { title: 'Mortgage Loan Officer', location: 'Dallas, TX' },
      { title: 'Mortgage Banker', location: 'Dallas, TX' },
    ],
    shouldBlock: [{ title: 'Registered Nurse', location: 'Dallas, TX' }],
    laneMustMatch: /mortgage loan officer|mortgage banker|loan officer/i,
  },
  {
    id: 'FIN-003',
    category: 'finance',
    userQuery: 'finance majors seeking analyst internships',
    avatarType: 'avatar1',
    locationKey: 'chicago',
    intent: {
      role_terms: ['financial analyst', 'finance intern'],
      role_synonyms: ['investment banking analyst', 'corporate finance analyst', 'finance associate'],
      related_titles: ['accounting intern', 'business analyst'],
      exclude_roles: ['registered nurse', 'chef'],
      summary: 'Finance students seeking analyst internships in Chicago.',
    },
    shouldPass: [
      { title: 'Financial Analyst Intern', location: 'Chicago, IL' },
      { title: 'Corporate Finance Analyst', location: 'Chicago, IL' },
    ],
    shouldBlock: [{ title: 'Executive Chef', location: 'Chicago, IL' }],
  },

  // ── Other roles ───────────────────────────────────────────────────────────
  {
    id: 'OTH-001',
    category: 'other',
    userQuery: 'recent computer science graduates looking for software jobs',
    avatarType: 'avatar1',
    locationKey: 'austin',
    intent: {
      role_terms: ['software engineer', 'software developer'],
      role_synonyms: ['junior software engineer', 'entry-level software developer'],
      related_titles: ['web developer', 'frontend developer', 'full stack developer'],
      exclude_roles: ['registered nurse', 'insurance agent'],
      summary: 'CS grads seeking software roles in Austin.',
    },
    shouldPass: [
      { title: 'Junior Software Engineer', location: 'Austin, TX' },
      { title: 'Software Developer', location: 'Austin, TX' },
    ],
    shouldBlock: [{ title: 'Insurance Agent', location: 'Austin, TX' }],
    laneMustNotMatch: /\(insurance OR sales OR finance\)/,
  },
  {
    id: 'OTH-002',
    category: 'other',
    userQuery: 'nursing graduates seeking hospital jobs',
    avatarType: 'avatar1',
    locationKey: 'chicago',
    intent: {
      role_terms: ['registered nurse', 'nursing'],
      role_synonyms: ['RN', 'BSN nurse', 'staff nurse'],
      related_titles: ['patient care technician', 'nursing assistant'],
      exclude_roles: ['software engineer', 'account executive'],
      summary: 'Nursing graduates seeking hospital roles in Chicago.',
    },
    shouldPass: [
      { title: 'Registered Nurse', location: 'Chicago, IL' },
      { title: 'Staff Nurse', location: 'Chicago, IL' },
    ],
    shouldBlock: [{ title: 'Account Executive', location: 'Chicago, IL' }],
    laneMustMatch: /registered nurse|staff nurse|"RN"/i,
  },
  {
    id: 'OTH-003',
    category: 'other',
    userQuery: 'marketing coordinators at startups',
    avatarType: 'avatar1',
    locationKey: 'austin',
    intent: {
      role_terms: ['marketing coordinator', 'marketing specialist'],
      role_synonyms: ['digital marketing coordinator', 'marketing associate', 'growth marketing coordinator'],
      related_titles: ['social media coordinator', 'content marketing specialist'],
      exclude_roles: ['registered nurse', 'mortgage loan officer'],
      summary: 'Marketing coordinators at startups in Austin.',
    },
    shouldPass: [
      { title: 'Marketing Coordinator', location: 'Austin, TX' },
      { title: 'Digital Marketing Coordinator', location: 'Austin, TX' },
    ],
    shouldBlock: [{ title: 'Mortgage Loan Officer', location: 'Austin, TX' }],
    laneMustMatch: /marketing coordinator|digital marketing coordinator/i,
  },
  {
    id: 'OTH-004',
    category: 'other',
    userQuery: 'HR generalists at mid-size companies',
    avatarType: 'avatar2',
    locationKey: 'atlanta',
    intent: {
      role_terms: ['HR generalist', 'human resources generalist'],
      role_synonyms: ['people operations generalist', 'HR coordinator', 'human resources business partner'],
      related_titles: ['recruiter', 'talent acquisition specialist'],
      exclude_roles: ['software engineer', 'financial advisor'],
      summary: 'HR generalists at mid-size companies in Atlanta.',
    },
    shouldPass: [
      { title: 'HR Generalist', location: 'Atlanta, GA' },
      { title: 'Human Resources Coordinator', location: 'Atlanta, GA' },
    ],
    shouldBlock: [{ title: 'Financial Advisor', location: 'Atlanta, GA' }],
  },
];

export function leadFromFixture(base, fixture) {
  return {
    name: fixture.name || 'Test Lead',
    title: fixture.title,
    company: fixture.company || 'Example Co',
    location: fixture.location || 'Dallas, TX',
    snippet: fixture.snippet || `${fixture.title}. ${fixture.location || 'Dallas, TX'}.`,
    link: 'https://www.linkedin.com/in/test-lead',
    ...fixture,
  };
}
