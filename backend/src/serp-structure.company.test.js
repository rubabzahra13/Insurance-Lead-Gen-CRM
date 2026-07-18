import test from 'node:test';
import assert from 'node:assert/strict';
import { structureSerpLeads } from './serp-structure.js';
import { mergeExtracted, groundExtractedValue } from './enrich-fields-llm.js';
import { cleanCompanyCandidate } from './lead-fields.js';

function leadFor(item, avatarType = 'avatar1') {
  const [lead] = structureSerpLeads([item], {
    avatarType,
    searchPrompt: 'Insurance graduates',
    roleTerms: ['insurance', 'claims', 'adjuster', 'graduate', 'analyst', 'engineer', 'intern'],
    roleSynonyms: [],
  });
  assert.ok(lead, `expected lead for ${item.title}`);
  return lead;
}

test('code path: company only from LinkedIn rich-snippet card', () => {
  const lead = leadFor({
    title: 'Brian Perez - Claims Representative @ Donegal Insurance Group | LinkedIn',
    url: 'https://www.linkedin.com/in/bperez4',
    snippet: 'Claims Representative @ Donegal Insurance Group. York, Pennsylvania, United States.',
    extensions: ['York, Pennsylvania, United States', 'Claims Representative', 'Donegal Insurance Group'],
  });
  assert.equal(lead.company, 'Donegal Insurance Group');
  assert.equal(lead.fieldSource.company, 'linkedin_card');
});

test('code path: cardless snippet leaves company null for AI enrich', () => {
  const lead = leadFor({
    title: 'Antonio Riles - Claims Adjuster | LinkedIn',
    url: 'https://www.linkedin.com/in/teeriles',
    snippet:
      'Casualty Claims Adjuster. Crawford & Company. Feb 2022 - Jan 2023 1 year. [recent graduate — graduation year on profile]',
    extensions: [],
  });
  assert.equal(lead.company, null);
});

test('code path: campus-card org is rejected; company stays null for AI', () => {
  const lead = leadFor({
    title: "Mariam Sarfaraz - Computer Engineer | GIKI'26 | LinkedIn",
    url: 'https://pk.linkedin.com/in/mariam-sarfaraz',
    snippet:
      'Class of 2026. AI Intern. Sybrid Careers. Jun 2025 - Aug 2025 3 months. Islamabad,Pakistan.',
    extensions: [
      'Haripur District, Khyber Pakhtunkhwa, Pakistan',
      'Director Laison(Director of Coordination & Communication)',
      'IET on Campus GIKI',
    ],
  });
  assert.equal(lead.company, null);
});

test('dynamic AI merge: grounds employer from cardless snippet text', () => {
  const target = {
    name: 'Antonio Riles',
    company: null,
    snippet: 'Casualty Claims Adjuster. Crawford & Company. Feb 2022 - Jan 2023 1 year.',
    fieldSource: { company: null },
  };
  const source = target.snippet;
  const merged = mergeExtracted(
    target,
    { id: 0, company: 'Crawford & Company', school: null, location: null, past_experience: null },
    source,
  );
  assert.equal(merged.company, 'Crawford & Company');
  assert.equal(merged.fieldSource.company, 'ai');
});

test('dynamic AI merge: grounds @ employer without keyword lists', () => {
  const source = 'Insurance Analyst Intern @ State Farm Agency. Los Angeles, California, United States.';
  assert.equal(groundExtractedValue('State Farm Agency', source), 'State Farm Agency');
  assert.equal(cleanCompanyCandidate('State Farm Agency'), 'State Farm Agency');

  const merged = mergeExtracted(
    { name: 'Isaac Kang', company: null, snippet: source, fieldSource: {} },
    { company: 'State Farm Agency', school: null, location: 'Los Angeles', past_experience: null },
    source,
  );
  assert.equal(merged.company, 'State Farm Agency');
  assert.equal(merged.fieldSource.company, 'ai');
});

test('dynamic AI merge: rejects hallucinated company not in snippet', () => {
  const source = 'Aspiring software engineer. Class of 2026. Islamabad.';
  const merged = mergeExtracted(
    { name: 'Pat Example', company: null, snippet: source, fieldSource: {} },
    { company: 'Made Up Corp', school: null, location: 'Islamabad', past_experience: null },
    source,
  );
  assert.equal(merged.company, null);
});

test('cleanCompanyCandidate is shape-only (no job-title keyword veto)', () => {
  // Former hardcoded JOB_TITLE_RE would reject many org names that contain
  // words like "Analyst" — dynamic AI + grounding decides instead.
  assert.equal(cleanCompanyCandidate('State Farm Agency'), 'State Farm Agency');
  assert.equal(cleanCompanyCandidate('Crawford & Company'), 'Crawford & Company');
  assert.equal(cleanCompanyCandidate('iBloom Montessori'), 'iBloom Montessori');
  assert.equal(cleanCompanyCandidate('Air University'), null); // school → school field
  assert.equal(cleanCompanyCandidate('Equitable ...'), null); // truncated
});
