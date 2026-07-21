/**
 * TC-ROLE: Role-category test matrix — insurance, sales, finance, and other careers.
 * USA locations only. Uses simulated AI intent (runtime synonyms + related titles).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlan } from './search-plan.js';
import { passesHardVeto } from './plan-filter.js';
import { assembleLanesFromIntent } from './lane-assembler.js';
import { rankLeadsByMatchTier, annotateLeadMatchTier } from './match-tiers.js';
import { ROLE_SCENARIOS, USA_LOCATIONS, leadFromFixture } from './search-match-role-fixtures.js';

function planForScenario(scenario) {
  return normalizePlan(
    { ...scenario.intent, source: 'ai', discovery_phrases: scenario.intent.discovery_phrases || [] },
    scenario.userQuery,
    scenario.avatarType,
    {
      location: USA_LOCATIONS[scenario.locationKey],
      locationStripped: false,
      locationSource: 'ui',
    },
  );
}

const CATEGORIES = ['insurance', 'sales', 'finance', 'other'];

for (const category of CATEGORIES) {
  const scenarios = ROLE_SCENARIOS.filter((s) => s.category === category);

  test(`TC-ROLE-${category.toUpperCase()}-SUMMARY: ${scenarios.length} scenarios in ${category} catalog`, () => {
    assert.ok(scenarios.length >= 3, `${category} should have at least 3 scenarios`);
  });

  for (const scenario of scenarios) {
    test(`TC-ROLE-${scenario.id}: [${category}] plan normalizes synonyms and related titles — ${scenario.userQuery}`, () => {
      const plan = planForScenario(scenario);
      assert.ok(plan.roleTerms.length >= 1, `${scenario.id}: missing role_terms`);
      assert.ok(plan.roleSynonyms.length >= 1, `${scenario.id}: missing role_synonyms`);
      assert.ok(plan.lanes.length >= 1, `${scenario.id}: no search lanes assembled`);

      for (const syn of plan.roleSynonyms) {
        assert.ok(
          !plan.relatedTitles.includes(syn),
          `${scenario.id}: synonym "${syn}" must not duplicate in related_titles`,
        );
      }
    });

    test(`TC-ROLE-${scenario.id}-PASS: [${category}] expected leads pass hard veto`, () => {
      const plan = planForScenario(scenario);
      for (const fixture of scenario.shouldPass) {
        const person = leadFromFixture({}, fixture);
        assert.equal(
          passesHardVeto(person, plan),
          true,
          `${scenario.id}: "${fixture.title}" should pass veto (${fixture.name || fixture.title})`,
        );
      }
    });

    test(`TC-ROLE-${scenario.id}-BLOCK: [${category}] wrong careers are hard-vetoed`, () => {
      const plan = planForScenario(scenario);
      for (const fixture of scenario.shouldBlock) {
        const person = leadFromFixture({}, fixture);
        assert.equal(
          passesHardVeto(person, plan),
          false,
          `${scenario.id}: "${fixture.title}" should be blocked (${fixture.reason || 'off-role'})`,
        );
      }
    });

    if (scenario.laneMustMatch || scenario.laneMustNotMatch) {
      test(`TC-ROLE-${scenario.id}-LANES: [${category}] SerpAPI lanes match intent`, () => {
        const plan = planForScenario(scenario);
        const { lanes } = assembleLanesFromIntent(scenario.avatarType, plan);
        const queries = lanes.map((l) => l.query).join('\n');
        if (scenario.laneMustMatch) {
          assert.match(queries, scenario.laneMustMatch, `${scenario.id}: lane query missing expected terms`);
        }
        if (scenario.laneMustNotMatch) {
          assert.doesNotMatch(queries, scenario.laneMustNotMatch, `${scenario.id}: lane has forbidden hardcoded injection`);
        }
      });
    }
  }
}

test('TC-ROLE-CROSS-001: insurance search does not block finance-adjacent related title at veto stage', () => {
  const scenario = ROLE_SCENARIOS.find((s) => s.id === 'INS-002');
  const plan = planForScenario(scenario);
  const advisor = leadFromFixture({}, {
    title: 'Financial Advisor',
    location: 'Chicago, IL',
    snippet: 'Financial Advisor at independent firm. Chicago, IL.',
  });
  assert.equal(passesHardVeto(advisor, plan), true);
});

test('TC-ROLE-CROSS-002: sales SDR scenario keeps marketing roles in related lane not synonyms', () => {
  const scenario = ROLE_SCENARIOS.find((s) => s.id === 'SAL-001');
  const plan = planForScenario(scenario);
  assert.ok(plan.roleSynonyms.some((s) => /inside sales|B2B sales|sales development/i.test(s)));
  assert.ok(plan.relatedTitles.some((s) => /customer success|business development/i.test(s)));
});

test('TC-ROLE-CROSS-003: finance and insurance tiers rank independently per search', () => {
  const insuranceRanked = rankLeadsByMatchTier([
    annotateLeadMatchTier({ name: 'Near CSR' }, 'near'),
    annotateLeadMatchTier({ name: 'Perfect Agent' }, 'perfect'),
  ]);
  const financeRanked = rankLeadsByMatchTier([
    annotateLeadMatchTier({ name: 'Near Banker' }, 'near'),
    annotateLeadMatchTier({ name: 'Perfect Advisor' }, 'perfect'),
  ]);
  assert.equal(insuranceRanked[0].name, 'Perfect Agent');
  assert.equal(financeRanked[0].name, 'Perfect Advisor');
});

test('TC-ROLE-CROSS-004: each category has both avatar1 and avatar2 coverage', () => {
  for (const category of CATEGORIES) {
    const items = ROLE_SCENARIOS.filter((s) => s.category === category);
    const avatars = new Set(items.map((s) => s.avatarType));
    assert.ok(avatars.has('avatar1') || avatars.has('avatar2'), `${category} missing avatar coverage`);
  }
});

test('TC-ROLE-CROSS-005: all scenarios use USA city locations', () => {
  for (const scenario of ROLE_SCENARIOS) {
    const loc = USA_LOCATIONS[scenario.locationKey];
    assert.equal(loc.gl, 'us', `${scenario.id} must use US geo`);
    assert.match(loc.label, /USA/, `${scenario.id} location label must include USA`);
  }
});
