// Dynamic field extraction for company / school / location / past_experience.
//
// Company (and related fields) are decided by the model from the retrieved
// snippet — not by industry keyword lists or layout regex. The model only
// COPIES short spans that appear in the text (extractor, never oracle).
// Code sanitize is shape-only: reject Experience dumps / truncated names.

import { sanitizeLeadFields, looksLikeExperienceDump, cleanCompanyCandidate } from './lead-fields.js';

const OPENAI_API = 'https://api.openai.com/v1/chat/completions';
const BATCH_SIZE = 20;

function apiKey() {
  return (process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY)?.trim();
}

export function fieldEnrichmentAvailable() {
  return Boolean(apiKey());
}

function sourceTextFor(lead) {
  return [lead.title, lead.headline, lead.snippet, lead.evidence, lead.fit_evidence]
    .filter(Boolean)
    .join(' · ')
    .replace(/\s+/g, ' ')
    .slice(0, 700);
}

/** Reject hallucinated values — every kept span must appear in the source text. */
export function groundExtractedValue(value, sourceText, { minLen = 2 } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length < minLen) return null;
  const hay = String(sourceText ?? '').toLowerCase();
  if (!hay) return null;
  if (hay.includes(raw.toLowerCase())) return raw;

  const compact = raw.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const hayCompact = hay.replace(/[^\p{L}\p{N}]+/gu, '');
  if (compact.length >= 4 && hayCompact.includes(compact)) return raw;
  return null;
}

function buildPrompt(batch) {
  return [
    'Extract CRM fields from each person\'s LinkedIn/Google snippet text.',
    'Rules are dynamic: adapt to whatever career, country, and snippet layout you see.',
    'Copy short spans only. Never invent. Prefer null over a messy guess.',
    '',
    '## company',
    'The employer or internship host ORGANIZATION name only (short proper name).',
    'Read the snippet and decide what the org is — do not assume an industry.',
    'Common shapes (not exhaustive):',
    '  - "Role at Org" / "Role @ Org"',
    '  - "Role. Org. Mon YYYY"',
    '  - "Role. Org. City, Region, Country. N followers"',
    '  - LinkedIn Experience lines naming an employer',
    'Reject: job titles alone, whole Experience dumps, dates/tenure, student-only school lines.',
    'If they only list a school (student / Class of / Education) → company: null, fill school.',
    '',
    '## school / location / past_experience',
    '- school: short school/institute name or acronym',
    '- location: short place',
    '- past_experience: ONE short phrase max ~80 chars (e.g. "Intern at Org")',
    '',
    '## Examples (illustrative — apply the same judgment to any industry)',
    'Text: "Intern at Equitable Advisors. Class of 2025. Dallas."',
    '→ {"company":"Equitable Advisors","school":null,"location":"Dallas","past_experience":"Intern at Equitable Advisors"}',
    '',
    'Text: "Software Engineering student at Air University. Class of 2026. Islamabad."',
    '→ {"company":null,"school":"Air University","location":"Islamabad","past_experience":null}',
    '',
    'Text: "Casualty Claims Adjuster. Crawford & Company. Feb 2022 - Jan 2023."',
    '→ {"company":"Crawford & Company","school":null,"location":null,"past_experience":"Claims Adjuster at Crawford & Company"}',
    '',
    'Text: "Insurance Analyst Intern @ State Farm Agency. Los Angeles."',
    '→ {"company":"State Farm Agency","school":null,"location":"Los Angeles","past_experience":"Intern at State Farm Agency"}',
    '',
    'Text: "AI Intern. Sybrid Careers. Jun 2025 - Aug 2025. Islamabad."',
    '→ {"company":"Sybrid Careers","school":null,"location":"Islamabad","past_experience":"AI Intern at Sybrid Careers"}',
    '',
    '## Output',
    'One JSON object per id. Fields: company, school, location, past_experience.',
    '',
    ...batch.map((row) => `[${row.id}] ${row.text}`),
    '',
    'Return JSON array only:',
    '[{"id":1,"company":null,"school":null,"location":null,"past_experience":null}]',
  ].join('\n');
}

async function callOpenAI(prompt, signalMs) {
  const res = await fetch(OPENAI_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You extract short CRM field values from LinkedIn snippet text. '
            + 'Decide company dynamically from the text for any career or country. '
            + 'company must be a short organization name only — never an Experience dump, '
            + 'never dates, never job titles alone. Prefer null over garbage. Output JSON only.',
        },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(signalMs),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

function groundPastExperience(value, sourceText) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 80 || looksLikeExperienceDump(raw)) return null;

  const direct = groundExtractedValue(raw, sourceText, { minLen: 4 });
  if (direct) return direct;

  const meaningful = raw
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w.length >= 4);
  if (meaningful.length < 2) return null;
  const hay = String(sourceText ?? '').toLowerCase();
  const hits = meaningful.filter((w) => hay.includes(w));
  if (hits.length >= Math.ceil(meaningful.length * 0.6)) return raw.slice(0, 80);
  return null;
}

function usableCompany(existing) {
  if (!existing) return null;
  if (looksLikeExperienceDump(existing)) return null;
  return cleanCompanyCandidate(existing);
}

export function mergeExtracted(target, row, sourceText) {
  const existingCompany = usableCompany(target.company);
  const groundedCompany = cleanCompanyCandidate(groundExtractedValue(row.company, sourceText));

  const company = existingCompany || groundedCompany || null;
  const school = target.school
    || groundExtractedValue(row.school, sourceText)
    || null;
  const location = target.location
    || groundExtractedValue(row.location, sourceText)
    || null;
  const pastExperience = (!target.past_experience || looksLikeExperienceDump(target.past_experience))
    ? groundPastExperience(row.past_experience, sourceText)
    : target.past_experience;

  const fieldSource = {
    ...(target.fieldSource || {}),
    company: existingCompany
      ? (target.fieldSource?.company || 'linkedin_card')
      : groundedCompany
        ? 'ai'
        : (target.fieldSource?.company || null),
  };

  return sanitizeLeadFields({
    ...target,
    company,
    school,
    location,
    past_experience: pastExperience,
    fieldSource,
  });
}

function needsEnrichment(lead) {
  return (
    !usableCompany(lead.company)
    || !lead.school
    || !lead.location
    || !lead.past_experience
    || looksLikeExperienceDump(lead.past_experience)
  );
}

/**
 * Fill / repair company/school/location/past_experience from retrieved text via AI.
 * This is the dynamic company path for cardless snippets. Never throws.
 */
export async function enrichLeadFields(leads, { onLog } = {}) {
  if (!fieldEnrichmentAvailable() || !Array.isArray(leads) || leads.length === 0) return leads;

  // Clear dumps before extract so we don't keep treating them as "already filled".
  const prepared = leads.map((lead) => {
    if (!looksLikeExperienceDump(lead.company) && !looksLikeExperienceDump(lead.past_experience)) {
      return lead;
    }
    return {
      ...lead,
      company: usableCompany(lead.company),
      past_experience: looksLikeExperienceDump(lead.past_experience) ? null : lead.past_experience,
    };
  });

  const pending = prepared
    .map((lead, index) => ({ index, lead, text: sourceTextFor(lead) }))
    .filter(({ text }) => text.length > 20)
    .filter(({ lead }) => needsEnrichment(lead));

  if (pending.length === 0) return prepared;

  const missingCompany = pending.filter(({ lead }) => !usableCompany(lead.company)).length;
  onLog?.(
    `  AI field extract: ${pending.length} lead(s) need fields`
    + (missingCompany ? ` (${missingCompany} missing company)` : ''),
  );

  const out = [...prepared];
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS ?? 60_000);

  for (let start = 0; start < pending.length; start += BATCH_SIZE) {
    const slice = pending.slice(start, start + BATCH_SIZE);
    const batch = slice.map(({ index, text }) => ({ id: index, text }));

    try {
      const rows = await callOpenAI(buildPrompt(batch), timeoutMs);
      for (const row of Array.isArray(rows) ? rows : []) {
        const target = out[row?.id];
        if (!target) continue;
        out[row.id] = mergeExtracted(target, row, sourceTextFor(target));
      }
    } catch (error) {
      onLog?.(`  field enrichment skipped for ${slice.length} lead(s): ${error.message}`);
    }
  }

  const filled = out.filter((lead) => lead.company || lead.school || lead.location || lead.past_experience).length;
  const withCompany = out.filter((lead) => lead.company).length;
  onLog?.(
    `  fields enriched: ${filled}/${out.length} lead(s) have company/school/location/experience`
    + ` (${withCompany} with company)`,
  );
  return out;
}
