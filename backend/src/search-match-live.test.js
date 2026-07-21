/**
 * Live role-category tests (USA) — insurance, sales, finance, and other careers.
 * Requires OPENAI + SERP keys. Skipped when keys missing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSerpLeadPipeline } from './serp-pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env'), override: true });

const hasOpenAi = Boolean((process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || '').trim());
const hasSerp = Boolean(
  (process.env.SERPAPI_KEY || process.env.SERP_API || process.env.SERPER_API_KEY || '').trim(),
);
const live = hasOpenAi && hasSerp;

const LOC = {
  dallas: { label: 'Dallas, TX, USA', placeId: 'dallas', city: 'Dallas', state: 'TX', country: 'United States' },
  newYork: { label: 'New York, NY, USA', placeId: 'nyc', city: 'New York', state: 'NY', country: 'United States' },
  chicago: { label: 'Chicago, IL, USA', placeId: 'chicago', city: 'Chicago', state: 'IL', country: 'United States' },
  austin: { label: 'Austin, TX, USA', placeId: 'austin', city: 'Austin', state: 'TX', country: 'United States' },
  atlanta: { label: 'Atlanta, GA, USA', placeId: 'atlanta', city: 'Atlanta', state: 'GA', country: 'United States' },
};

/** @type {Array<{ id: string, category: string, role: string, avatarType: string, location: object, minExported: number, minPerfect?: number, mustNotMatch?: RegExp }>} */
const LIVE_ROLE_CASES = [
  {
    id: 'LIVE-INS-001',
    category: 'insurance',
    role: 'insurance telesales',
    avatarType: 'avatar2',
    location: LOC.dallas,
    minExported: 3,
  },
  {
    id: 'LIVE-INS-002',
    category: 'insurance',
    role: 'life insurance agents at independent agencies',
    avatarType: 'avatar2',
    location: LOC.chicago,
    minExported: 3,
  },
  {
    id: 'LIVE-SAL-001',
    category: 'sales',
    role: 'inside sales representatives for B2B',
    avatarType: 'avatar2',
    location: LOC.atlanta,
    minExported: 3,
  },
  {
    id: 'LIVE-SAL-002',
    category: 'sales',
    role: 'entry level sales jobs for recent graduates',
    avatarType: 'avatar1',
    location: LOC.dallas,
    minExported: 5,
    minPerfect: 2,
  },
  {
    id: 'LIVE-FIN-001',
    category: 'finance',
    role: 'financial advisors building a client book',
    avatarType: 'avatar2',
    location: LOC.newYork,
    minExported: 3,
  },
  {
    id: 'LIVE-FIN-002',
    category: 'finance',
    role: 'mortgage loan officers at banks',
    avatarType: 'avatar2',
    location: LOC.dallas,
    minExported: 3,
  },
  {
    id: 'LIVE-OTH-001',
    category: 'other',
    role: 'recent computer science graduates looking for software jobs',
    avatarType: 'avatar1',
    location: LOC.austin,
    minExported: 8,
    minPerfect: 4,
  },
  {
    id: 'LIVE-OTH-002',
    category: 'other',
    role: 'nursing graduates seeking hospital jobs',
    avatarType: 'avatar1',
    location: LOC.chicago,
    minExported: 3,
    mustNotMatch: /software engineer|software developer|programmer/i,
  },
  {
    id: 'LIVE-OTH-003',
    category: 'other',
    role: 'marketing coordinators at startups',
    avatarType: 'avatar1',
    location: LOC.austin,
    minExported: 3,
    mustNotMatch: /registered nurse|mortgage loan officer/i,
  },
];

function assertTierTags(leads) {
  for (const lead of leads) {
    assert.ok(lead.match_tier, `${lead.name} missing match_tier`);
    assert.ok(lead.match_label, `${lead.name} missing match_label`);
    assert.ok(['Best Match', 'Good Match', 'Possible Match'].includes(lead.match_label));
  }
}

function assertTierSort(leads) {
  const tierOrder = { perfect: 0, strong: 1, near: 2 };
  for (let i = 1; i < leads.length; i += 1) {
    const prev = tierOrder[leads[i - 1].match_tier] ?? 9;
    const curr = tierOrder[leads[i].match_tier] ?? 9;
    assert.ok(prev <= curr, 'leads must be sorted perfect > strong > near');
  }
}

for (const scenario of LIVE_ROLE_CASES) {
  test(`${scenario.id}: [${scenario.category}] live — ${scenario.role}`, { skip: !live, timeout: 180_000 }, async () => {
    process.env.QUIET = 'true';
    const result = await runSerpLeadPipeline(scenario.role, {
      avatarType: scenario.avatarType,
      maxResults: 20,
      role: scenario.role,
      uiLocation: scenario.location,
      syncAvatar12Leads: async () => ({ synced: 0 }),
    });

    assert.ok(
      result.stats.exported >= scenario.minExported,
      `${scenario.id}: expected >= ${scenario.minExported} leads, got ${result.stats.exported}`,
    );
    assert.ok(result.leads.length >= scenario.minExported);
    assertTierTags(result.leads);
    assertTierSort(result.leads);

    if (scenario.minPerfect) {
      assert.ok(
        (result.stats.perfectMatches ?? 0) >= scenario.minPerfect,
        `${scenario.id}: expected >= ${scenario.minPerfect} perfect, got ${result.stats.perfectMatches}`,
      );
    }

    if (scenario.mustNotMatch) {
      const bad = result.leads.filter((l) =>
        scenario.mustNotMatch.test(`${l.title || ''} ${l.snippet || ''}`),
      );
      assert.equal(
        bad.length,
        0,
        `${scenario.id}: off-role exports: ${bad.map((l) => l.name).join(', ')}`,
      );
    }
  });
}

test('LIVE-ROLE-SUMMARY: all four categories covered in live matrix', () => {
  const cats = new Set(LIVE_ROLE_CASES.map((c) => c.category));
  assert.ok(cats.has('insurance'));
  assert.ok(cats.has('sales'));
  assert.ok(cats.has('finance'));
  assert.ok(cats.has('other'));
  assert.equal(LIVE_ROLE_CASES.length, 9);
});
