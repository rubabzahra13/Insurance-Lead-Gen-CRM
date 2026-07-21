/**
 * Search & match-tier pipeline — senior QA test matrix.
 *
 * Categories:
 *   TC-PLAN   — AI search plan normalization (roles, synonyms, related titles)
 *   TC-VETO   — Hard veto / code filter (minimal gates only)
 *   TC-TIER   — Match tier labels, normalization, export eligibility
 *   TC-RANK   — Sort order: perfect > strong > near, then confidence
 *   TC-LANE   — SerpAPI lane assembly (no hardcoded career injection)
 *   TC-AI     — AI match scorer (mocked OpenAI)
 *   TC-REG    — Regression fixtures from real user queries
 *   TC-EDGE   — Edge cases & negative paths
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePlan,
  resolvePlanRelatedTitles,
  resolvePlanRoleSynonyms,
  resolvePlanRoleTerms,
  planToStructureContext,
} from './search-plan.js';
import {
  applyHardVeto,
  leadMatchesAvatarSignals,
  leadMatchesPlanLocation,
  passesHardVeto,
} from './plan-filter.js';
import {
  annotateLeadMatchTier,
  compareMatchTier,
  isExportableTier,
  matchTierLabel,
  normalizeMatchTier,
  rankLeadsByMatchTier,
} from './match-tiers.js';
import { assembleLanesFromIntent } from './lane-assembler.js';
import { scoreLeadsWithLlm } from './lead-llm-filter.js';
import { annotateLeadConfidence } from './confidence.js';

// ─── Fixtures (USA) ─────────────────────────────────────────────────────────

const DALLAS_LOC = {
  label: 'Dallas, TX, USA',
  scope: 'city',
  city: 'Dallas',
  country: 'United States',
  gl: 'us',
  tokens: ['dallas', 'texas', 'united states', 'usa'],
  mustInclude: ['dallas'],
};

const AUSTIN_LOC = {
  label: 'Austin, TX, USA',
  scope: 'city',
  city: 'Austin',
  country: 'United States',
  gl: 'us',
  tokens: ['austin', 'texas', 'united states', 'usa'],
  mustInclude: ['austin'],
};

const CHICAGO_LOC = {
  label: 'Chicago, IL, USA',
  scope: 'city',
  city: 'Chicago',
  country: 'United States',
  gl: 'us',
  tokens: ['chicago', 'illinois', 'united states', 'usa'],
  mustInclude: ['chicago'],
};

function aiTelesalesIntent() {
  return {
    role_terms: ['insurance telesales', 'insurance sales'],
    role_synonyms: [
      'insurance sales agent',
      'insurance telesales representative',
      'insurance agent',
    ],
    related_titles: [
      'customer service representative',
      'call center agent',
      'inside sales representative',
    ],
    discovery_phrases: ['call center', 'independent agency'],
    include_signals: [],
    exclude_titles: ['ceo', 'founder'],
    exclude_roles: ['software engineer', 'nurse'],
    summary: 'Find insurance telesales professionals in Dallas, TX.',
  };
}

function aiSoftwareGradIntent() {
  return {
    role_terms: ['software engineer', 'software developer'],
    role_synonyms: ['junior software engineer', 'entry-level software developer'],
    related_titles: ['web developer', 'frontend developer', 'full stack developer'],
    discovery_phrases: ['UT Austin', 'computer science', 'CS degree'],
    include_signals: ['computer science student'],
    exclude_titles: [],
    exclude_roles: ['nurse', 'accountant'],
    summary: 'Find recent CS graduates seeking software engineering roles in Austin, TX.',
  };
}

function planFromIntent(intent, avatarType, userQuery, location) {
  return normalizePlan(
    { ...intent, source: 'ai' },
    userQuery,
    avatarType,
    { location, locationStripped: false, locationSource: 'ui' },
  );
}

function lead(overrides = {}) {
  return {
    name: 'Test Person',
    title: 'Insurance Agent',
    company: 'Progressive Insurance',
    location: 'Dallas, TX',
    snippet: 'Insurance Agent at Progressive Insurance. Dallas, TX.',
    link: 'https://www.linkedin.com/in/test-person',
    ...overrides,
  };
}

function mockOpenAiScorer(decisions) {
  return async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.ok(body.messages?.length >= 2, 'OpenAI scorer should send system + user messages');
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(decisions) } }],
      }),
    };
  };
}

// ─── TC-PLAN: Search plan normalization ─────────────────────────────────────

test('TC-PLAN-001: normalizePlan preserves AI role_terms from natural-language query', () => {
  const plan = planFromIntent(
    aiSoftwareGradIntent(),
    'avatar1',
    'recent computer science graduates looking for software jobs',
    AUSTIN_LOC,
  );
  assert.ok(plan.roleTerms.includes('software engineer'));
  assert.ok(plan.roleSynonyms.includes('junior software engineer'));
});

test('TC-PLAN-002: related_titles are stored separately from role_synonyms', () => {
  const plan = planFromIntent(aiTelesalesIntent(), 'avatar2', 'insurance telesales', DALLAS_LOC);
  assert.ok(plan.relatedTitles.includes('customer service representative'));
  assert.ok(!plan.roleSynonyms.includes('customer service representative'));
});

test('TC-PLAN-003: related_titles dedupe against role_terms and synonyms', () => {
  const related = resolvePlanRelatedTitles(
    ['insurance agent', 'call center agent', 'insurance agent'],
    ['insurance telesales'],
    ['insurance agent', 'insurance sales agent'],
  );
  assert.deepEqual(related, ['call center agent']);
});

test('TC-PLAN-004: resolvePlanRoleSynonyms caps list and removes duplicates', () => {
  const synonyms = resolvePlanRoleSynonyms(
    'insurance telesales',
    ['insurance agent', 'insurance agent', 'insurance producer'],
    ['insurance telesales'],
    [],
  );
  assert.equal(synonyms.length, 2);
  assert.ok(synonyms.includes('insurance agent'));
});

test('TC-PLAN-005: planToStructureContext includes related titles for structurer', () => {
  const plan = planFromIntent(aiTelesalesIntent(), 'avatar2', 'insurance telesales', DALLAS_LOC);
  const ctx = planToStructureContext(plan);
  assert.match(ctx, /Related titles \(near match\)/);
  assert.match(ctx, /customer service representative/);
});

test('TC-PLAN-006: empty AI synonyms fall back to user query as role term', () => {
  const terms = resolvePlanRoleTerms('tele sales for insurance', [], []);
  assert.deepEqual(terms, ['tele sales for insurance']);
});

// ─── TC-VETO: Hard veto / code filter ───────────────────────────────────────

test('TC-VETO-001: customer service rep passes code filter (AI scores tier later)', () => {
  const plan = planFromIntent(aiTelesalesIntent(), 'avatar2', 'insurance telesales', DALLAS_LOC);
  const csr = lead({
    title: 'Customer Service Representative',
    company: 'Concentrix',
    snippet: 'Customer Service Representative at Concentrix. Dallas, TX.',
  });
  assert.equal(leadMatchesAvatarSignals(csr, plan), true);
  assert.equal(passesHardVeto(csr, plan), true);
});

test('TC-VETO-002: insurance agent passes without hardcoded producer regex gate', () => {
  const plan = planFromIntent(aiTelesalesIntent(), 'avatar2', 'insurance telesales', DALLAS_LOC);
  const agent = lead({ title: 'Insurance Agent at State Farm' });
  assert.equal(passesHardVeto(agent, plan), true);
});

test('TC-VETO-003: CEO title is hard-vetoed for avatar2', () => {
  const plan = planFromIntent(aiTelesalesIntent(), 'avatar2', 'insurance telesales', DALLAS_LOC);
  const ceo = lead({ title: 'CEO at Insurance Agency' });
  assert.equal(passesHardVeto(ceo, plan), false);
});

test('TC-VETO-004: software engineer dropped when AI exclude_roles lists it', () => {
  const plan = planFromIntent(aiTelesalesIntent(), 'avatar2', 'insurance telesales', DALLAS_LOC);
  const dev = lead({
    title: 'Software Engineer',
    company: 'Tech Co',
    snippet: 'Software Engineer in Dallas, TX',
  });
  assert.equal(passesHardVeto(dev, plan), false);
});

test('TC-VETO-005: wrong city in profile location is vetoed', () => {
  const plan = planFromIntent(aiTelesalesIntent(), 'avatar2', 'insurance telesales', DALLAS_LOC);
  const houston = lead({
    title: 'Insurance Agent',
    location: 'Houston, TX',
    snippet: 'Insurance Agent in Houston, TX',
  });
  assert.equal(leadMatchesPlanLocation(houston, plan.location), false);
});

test('TC-VETO-006: Dallas lead with empty snippet still passes city scope', () => {
  const plan = planFromIntent(aiTelesalesIntent(), 'avatar2', 'insurance telesales', DALLAS_LOC);
  const sparse = lead({ title: 'Insurance Agent', location: '', snippet: '', company: 'Agency' });
  assert.equal(leadMatchesPlanLocation(sparse, plan.location), true);
});

test('TC-VETO-007: applyHardVeto returns kept + dropped arrays', () => {
  const plan = planFromIntent(aiTelesalesIntent(), 'avatar2', 'insurance telesales', DALLAS_LOC);
  const { leads, dropped } = applyHardVeto(
    [lead(), lead({ title: 'CEO' })],
    plan,
  );
  assert.equal(leads.length, 1);
  assert.equal(dropped.length, 1);
});

// ─── TC-TIER: Match tier module ─────────────────────────────────────────────

test('TC-TIER-001: normalizeMatchTier maps aliases', () => {
  assert.equal(normalizeMatchTier('Perfect'), 'perfect');
  assert.equal(normalizeMatchTier('DROP'), 'drop');
  assert.equal(normalizeMatchTier('rejected'), 'drop');
  assert.equal(normalizeMatchTier(''), 'near');
});

test('TC-TIER-002: matchTierLabel returns UI strings', () => {
  assert.equal(matchTierLabel('perfect'), 'Best Match');
  assert.equal(matchTierLabel('strong'), 'Good Match');
  assert.equal(matchTierLabel('near'), 'Possible Match');
  assert.equal(matchTierLabel('drop'), null);
});

test('TC-TIER-003: isExportableTier excludes drop only', () => {
  assert.equal(isExportableTier('perfect'), true);
  assert.equal(isExportableTier('near'), true);
  assert.equal(isExportableTier('drop'), false);
});

test('TC-TIER-004: annotateLeadMatchTier attaches label and reason', () => {
  const out = annotateLeadMatchTier({ name: 'A' }, 'perfect', 'Title matches synonym');
  assert.equal(out.match_tier, 'perfect');
  assert.equal(out.match_label, 'Best Match');
  assert.equal(out.match_reason, 'Title matches synonym');
});

// ─── TC-RANK: Ranking ───────────────────────────────────────────────────────

test('TC-RANK-001: perfect ranks above strong above near', () => {
  const ranked = rankLeadsByMatchTier([
    annotateLeadMatchTier({ name: 'Near', confidence: 0.99 }, 'near'),
    annotateLeadMatchTier({ name: 'Perfect', confidence: 0.5 }, 'perfect'),
    annotateLeadMatchTier({ name: 'Strong', confidence: 0.8 }, 'strong'),
  ]);
  assert.deepEqual(ranked.map((l) => l.name), ['Perfect', 'Strong', 'Near']);
});

test('TC-RANK-002: within same tier, higher confidence wins', () => {
  assert.ok(
    compareMatchTier(
      annotateLeadMatchTier({ confidence: 0.9 }, 'perfect'),
      annotateLeadMatchTier({ confidence: 0.6 }, 'perfect'),
    ) < 0,
  );
});

test('TC-RANK-003: confidence scoring boosts perfect match tier', () => {
  const base = annotateLeadConfidence(
    { name: 'A', title: 'Agent', company: 'Co', location: 'Dallas, TX', link: 'https://linkedin.com/in/a', snippet: 'x'.repeat(40) },
    { avatarType: 'avatar2' },
  );
  const perfect = annotateLeadConfidence(
    { ...base, match_tier: 'perfect' },
    { avatarType: 'avatar2' },
  );
  assert.ok(perfect.confidence > base.confidence);
  assert.match(perfect.verificationNotes, /Best Match/);
});

// ─── TC-LANE: Lane assembly ─────────────────────────────────────────────────

test('TC-LANE-001: avatar2 lanes use AI role terms not hardcoded insurance producer list', () => {
  const plan = planFromIntent(aiTelesalesIntent(), 'avatar2', 'insurance telesales', DALLAS_LOC);
  const { lanes } = assembleLanesFromIntent('avatar2', plan);
  assert.ok(lanes.length >= 2);
  const primary = lanes.find((l) => l.note.includes('primary role'));
  assert.ok(primary);
  assert.match(primary.query, /insurance telesales|insurance agent/i);
  assert.doesNotMatch(primary.query, /\(producer OR agent OR "insurance agent" OR "insurance producer"/);
});

test('TC-LANE-002: avatar2 includes separate related-title recall lane', () => {
  const plan = planFromIntent(aiTelesalesIntent(), 'avatar2', 'insurance telesales', DALLAS_LOC);
  const { lanes } = assembleLanesFromIntent('avatar2', plan);
  const related = lanes.find((l) => l.note.includes('related titles'));
  assert.ok(related);
  assert.match(related.query, /customer service representative|call center agent/i);
});

test('TC-LANE-002b: avatar2 prepends simplified recall lanes for large cities', () => {
  const plan = planFromIntent(aiTelesalesIntent(), 'avatar2', 'insurance telesales', DALLAS_LOC);
  const { lanes } = assembleLanesFromIntent('avatar2', plan);
  const simplified = lanes.find((l) => l.note.includes('simplified AI role recall'));
  assert.ok(simplified);
  assert.ok(!simplified.query.includes(' OR '));
  assert.match(simplified.query, /insurance telesales|insurance agent/i);
});

test('TC-LANE-003: avatar1 software query does not inject insurance industry fallback', () => {
  const plan = planFromIntent(
    aiSoftwareGradIntent(),
    'avatar1',
    'software engineer graduates',
    AUSTIN_LOC,
  );
  const { lanes } = assembleLanesFromIntent('avatar1', plan);
  for (const lane of lanes) {
    assert.doesNotMatch(lane.query, /\(insurance OR sales OR finance\)/);
  }
});

test('TC-LANE-004: avatar1 lanes include graduation-year and intern lanes', () => {
  const plan = planFromIntent(aiSoftwareGradIntent(), 'avatar1', 'software engineer', AUSTIN_LOC);
  const { lanes } = assembleLanesFromIntent('avatar1', plan);
  assert.ok(lanes.some((l) => l.note.includes('graduation year')));
  assert.ok(lanes.some((l) => l.note.includes('internship')));
});

// ─── TC-AI: Mocked AI match scorer ──────────────────────────────────────────

test('TC-AI-001: scorer assigns perfect tier for insurance agent synonym match', async () => {
  const plan = planFromIntent(aiTelesalesIntent(), 'avatar2', 'insurance telesales', DALLAS_LOC);
  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key-mock';
  process.env.OPENAI_KEY = 'test-key-mock';
  try {
    const { leads, dropped } = await scoreLeadsWithLlm([lead()], plan, {
      fetchFn: mockOpenAiScorer([
        { index: 1, tier: 'perfect', reason: 'Insurance Agent matches role_synonyms' },
      ]),
    });
    assert.equal(leads.length, 1);
    assert.equal(dropped.length, 0);
    assert.equal(leads[0].match_tier, 'perfect');
    assert.equal(leads[0].match_label, 'Best Match');
  } finally {
    if (savedKey) process.env.OPENAI_API_KEY = savedKey;
    else delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_KEY;
  }
});

test('TC-AI-002: scorer assigns near tier for CSR related title', async () => {
  const plan = planFromIntent(aiTelesalesIntent(), 'avatar2', 'insurance telesales', DALLAS_LOC);
  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key-mock';
  process.env.OPENAI_KEY = 'test-key-mock';
  try {
    const csr = lead({ title: 'Customer Service Representative', company: 'BPO' });
    const { leads } = await scoreLeadsWithLlm([csr], plan, {
      fetchFn: mockOpenAiScorer([
        { index: 1, tier: 'near', reason: 'Customer Service Representative is related title' },
      ]),
    });
    assert.equal(leads[0].match_tier, 'near');
    assert.equal(leads[0].match_label, 'Possible Match');
  } finally {
    if (savedKey) process.env.OPENAI_API_KEY = savedKey;
    else delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_KEY;
  }
});

test('TC-AI-003: dropped tier removes lead from export list', async () => {
  const plan = planFromIntent(aiTelesalesIntent(), 'avatar2', 'insurance telesales', DALLAS_LOC);
  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key-mock';
  process.env.OPENAI_KEY = 'test-key-mock';
  try {
    const dev = lead({ title: 'Software Engineer', location: 'Dallas, TX' });
    const { leads, dropped } = await scoreLeadsWithLlm([dev], plan, {
      fetchFn: mockOpenAiScorer([
        { index: 1, tier: 'drop', reason: 'Software engineer — wrong career' },
      ]),
    });
    assert.equal(leads.length, 0);
    assert.equal(dropped.length, 1);
  } finally {
    if (savedKey) process.env.OPENAI_API_KEY = savedKey;
    else delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_KEY;
  }
});

test('TC-AI-004: missing OpenAI decision defaults to near (safe keep)', async () => {
  const plan = planFromIntent(aiTelesalesIntent(), 'avatar2', 'insurance telesales', DALLAS_LOC);
  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key-mock';
  process.env.OPENAI_KEY = 'test-key-mock';
  try {
    const { leads } = await scoreLeadsWithLlm([lead()], plan, {
      fetchFn: mockOpenAiScorer([]),
    });
    assert.equal(leads[0].match_tier, 'near');
  } finally {
    if (savedKey) process.env.OPENAI_API_KEY = savedKey;
    else delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_KEY;
  }
});

test('TC-AI-005: CEO survives AI near score but hard veto removes them', async () => {
  const plan = planFromIntent(aiTelesalesIntent(), 'avatar2', 'insurance telesales', DALLAS_LOC);
  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key-mock';
  process.env.OPENAI_KEY = 'test-key-mock';
  try {
    const ceo = lead({ title: 'CEO', company: 'Agency' });
    const { leads, dropped } = await scoreLeadsWithLlm([ceo], plan, {
      fetchFn: mockOpenAiScorer([
        { index: 1, tier: 'strong', reason: 'Insurance agency leader' },
      ]),
    });
    assert.equal(leads.length, 0);
    assert.ok(dropped.some((d) => d.reason === 'hard veto' || d.lead.title === 'CEO'));
  } finally {
    if (savedKey) process.env.OPENAI_API_KEY = savedKey;
    else delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_KEY;
  }
});

// ─── TC-REG: Regression scenarios ───────────────────────────────────────────

test('TC-REG-001: telesales regression — CSR and insurance agent both pass veto', () => {
  const plan = planFromIntent(aiTelesalesIntent(), 'avatar2', 'insurance telesales', DALLAS_LOC);
  const fixtures = [
    { title: 'Insurance Agent at Progressive', name: 'Malik Zia' },
    { title: 'Customer Service Representative', name: 'Salman Dogar', company: 'Concentrix' },
    { title: 'Life Insurance Agent at State Farm', name: 'Zeeshan Azad' },
  ];
  for (const f of fixtures) {
    assert.equal(passesHardVeto(lead(f), plan), true, `${f.name} should pass veto`);
  }
});

test('TC-REG-002: software grad regression — junior SE passes, nurse blocked', () => {
  const plan = planFromIntent(
    aiSoftwareGradIntent(),
    'avatar1',
    'recent computer science graduates looking for software jobs',
    AUSTIN_LOC,
  );
  assert.equal(
    passesHardVeto(lead({ title: 'Junior Software Engineer', location: 'Austin, TX' }), plan),
    true,
  );
  assert.equal(
    passesHardVeto(lead({ title: 'Registered Nurse', location: 'Austin, TX' }), plan),
    false,
  );
});

test('TC-REG-003: ranked export order matches Perfect > Strong > Near', () => {
  const batch = rankLeadsByMatchTier([
    annotateLeadMatchTier({ name: 'CSR', confidence: 0.88 }, 'near'),
    annotateLeadMatchTier({ name: 'Agent', confidence: 0.86 }, 'perfect'),
    annotateLeadMatchTier({ name: 'Inside Sales', confidence: 0.9 }, 'strong'),
  ]);
  assert.deepEqual(
    batch.map((l) => l.match_label),
    ['Best Match', 'Good Match', 'Possible Match'],
  );
});

// ─── TC-EDGE: Edge cases ──────────────────────────────────────────────────────

test('TC-EDGE-001: empty related_titles array is valid', () => {
  const related = resolvePlanRelatedTitles([], ['nurse'], ['registered nurse']);
  assert.deepEqual(related, []);
});

test('TC-EDGE-002: rankLeadsByMatchTier handles empty input', () => {
  assert.deepEqual(rankLeadsByMatchTier([]), []);
});

test('TC-EDGE-003: scorer with no API key tags all as near', async () => {
  const plan = planFromIntent(aiTelesalesIntent(), 'avatar2', 'insurance telesales', DALLAS_LOC);
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_KEY;
  try {
    const { leads } = await scoreLeadsWithLlm([lead(), lead({ name: 'B' })], plan);
    assert.equal(leads.length, 2);
    assert.ok(leads.every((l) => l.match_tier === 'near'));
  } finally {
    if (saved) process.env.OPENAI_API_KEY = saved;
  }
});

test('TC-EDGE-004: natural-language sentence becomes searchable role_terms', () => {
  const plan = normalizePlan(
    {
      role_terms: ['nursing', 'registered nurse'],
      role_synonyms: ['RN', 'BSN nursing student'],
      related_titles: ['patient care assistant', 'healthcare aide'],
      summary: 'Find nursing graduates seeking clinical roles.',
    },
    'people who just finished nursing school and want hospital jobs',
    'avatar1',
    { location: CHICAGO_LOC },
  );
  assert.ok(plan.roleTerms.length >= 1);
  assert.ok(plan.relatedTitles.includes('patient care assistant'));
  assert.ok(plan.lanes.length >= 4);
});
