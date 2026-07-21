/**
 * One-off report: what we sent vs what we got for each live NL role case.
 * Usage: node src/search-match-live-report.mjs
 */
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSearchPlan } from './search-plan.js';
import { runSerpLeadPipeline } from './serp-pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env'), override: true });

const LOC = {
  dallas: { label: 'Dallas, TX, USA', placeId: 'dallas', city: 'Dallas', state: 'TX', country: 'United States' },
  newYork: { label: 'New York, NY, USA', placeId: 'nyc', city: 'New York', state: 'NY', country: 'United States' },
  chicago: { label: 'Chicago, IL, USA', placeId: 'chicago', city: 'Chicago', state: 'IL', country: 'United States' },
  austin: { label: 'Austin, TX, USA', placeId: 'austin', city: 'Austin', state: 'TX', country: 'United States' },
  atlanta: { label: 'Atlanta, GA, USA', placeId: 'atlanta', city: 'Atlanta', state: 'GA', country: 'United States' },
};

const CASES = [
  { id: 'LIVE-INS-001', category: 'insurance', role: 'insurance telesales', avatarType: 'avatar2', locationKey: 'dallas' },
  { id: 'LIVE-INS-002', category: 'insurance', role: 'life insurance agents at independent agencies', avatarType: 'avatar2', locationKey: 'chicago' },
  { id: 'LIVE-SAL-001', category: 'sales', role: 'inside sales representatives for B2B', avatarType: 'avatar2', locationKey: 'atlanta' },
  { id: 'LIVE-SAL-002', category: 'sales', role: 'entry level sales jobs for recent graduates', avatarType: 'avatar1', locationKey: 'dallas' },
  { id: 'LIVE-FIN-001', category: 'finance', role: 'financial advisors building a client book', avatarType: 'avatar2', locationKey: 'newYork' },
  { id: 'LIVE-FIN-002', category: 'finance', role: 'mortgage loan officers at banks', avatarType: 'avatar2', locationKey: 'dallas' },
  { id: 'LIVE-OTH-001', category: 'other', role: 'recent computer science graduates looking for software jobs', avatarType: 'avatar1', locationKey: 'austin' },
  { id: 'LIVE-OTH-002', category: 'other', role: 'nursing graduates seeking hospital jobs', avatarType: 'avatar1', locationKey: 'chicago' },
  { id: 'LIVE-OTH-003', category: 'other', role: 'marketing coordinators at startups', avatarType: 'avatar1', locationKey: 'austin' },
];

const logs = [];

async function runCase(scenario) {
  const location = LOC[scenario.locationKey];
  const sent = {
    query: scenario.role,
    location: location.label,
    avatarType: scenario.avatarType,
    fullPrompt: `${scenario.role} in ${location.label}`,
  };

  const planLogs = [];
  const plan = await buildSearchPlan(scenario.role, scenario.avatarType, {
    uiLocation: location,
    role: scenario.role,
    onLog: (msg) => planLogs.push(msg),
  });

  const sentPlan = {
    summary: plan.summary,
    roleTerms: plan.roleTerms,
    roleSynonyms: plan.roleSynonyms.slice(0, 10),
    relatedTitles: (plan.relatedTitles || []).slice(0, 10),
    searchLanes: plan.lanes.map((l) => l.query).slice(0, 6),
    totalLanes: plan.lanes.length,
  };

  process.env.QUIET = 'true';
  const pipelineLogs = [];
  const result = await runSerpLeadPipeline(scenario.role, {
    avatarType: scenario.avatarType,
    maxResults: 12,
    role: scenario.role,
    uiLocation: location,
    syncAvatar12Leads: async () => ({ synced: 0 }),
    onProgress: ({ type, message }) => {
      if (type === 'log') pipelineLogs.push(message);
    },
  });

  const got = {
    stats: result.stats,
    leads: (result.leads || []).slice(0, 8).map((l) => ({
      name: l.name,
      title: l.title,
      company: l.company,
      location: l.location,
      match_tier: l.match_tier,
      match_label: l.match_label,
      match_reason: (l.match_reason || '').slice(0, 120),
      confidence: l.confidence,
    })),
    pipelineNotes: pipelineLogs.filter((m) =>
      /No LinkedIn|dropped|tiers:|code filter|search:/i.test(m),
    ).slice(0, 8),
  };

  return { id: scenario.id, category: scenario.category, sent, sentPlan, planLogs, got };
}

for (const scenario of CASES) {
  process.stderr.write(`Running ${scenario.id}...\n`);
  try {
    const report = await runCase(scenario);
    logs.push(report);
  } catch (error) {
    logs.push({
      id: scenario.id,
      category: scenario.category,
      error: error.message,
    });
  }
}

console.log(JSON.stringify(logs, null, 2));
