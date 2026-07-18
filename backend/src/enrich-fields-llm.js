// Dynamic field extraction for company / school / location / past_experience.
//
// Why AI (not layout regex): Google/LinkedIn snippets rearrange employer and
// internship text in many shapes. The model only COPIES short spans from the
// retrieved text (extractor, never oracle). Code sanitize rejects Experience
// dumps so a bad extraction cannot pollute the CRM.

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
    'Copy short spans only. Never invent. Prefer null over a messy guess.',
    '',
    '## What "company" means',
    'company = ONLY the employer / internship host ORGANIZATION NAME.',
    'It must be a short proper name (about 2–6 words), e.g.:',
    '  ✓ "Goldman Sachs"',
    '  ✓ "Equitable Advisors"',
    '  ✓ "Systems Limited"',
    '  ✓ "Microsoft"',
    '  ✓ "Jazz"',
    '',
    'company is NEVER a whole Experience block. These are WRONG:',
    '  ✗ "COMSATS University Islamabad Graphic. Lecturer/Software Developer. COMSATS University Islamabad. Sep 2010 - Present 15 years 11 months. Islamabad…"',
    '  ✗ "Software Engineering student at Air University, Islamabad | Class of 2025"',
    '  ✗ "Lecturer/Software Developer"',
    '  ✗ anything with dates, "Present", "years", "months", or multiple sentences',
    '',
    'If they only list a school (student / Class of / Education) → company: null, fill school.',
    'If they work AS staff at a university, still put the short school name in school;',
    '  put company: null unless a clear separate employer name appears (do not paste the Experience dump).',
    '',
    '## Other fields',
    '- school: short school/institute name or acronym ("COMSATS University Islamabad", "LUMS", "FAST", "NUST").',
    '- location: short place ("Islamabad, Pakistan").',
    '- past_experience: ONE short phrase max ~80 chars, e.g. "Sales Intern at Goldman Sachs".',
    '  Never paste dates, tenure, or multi-sentence Experience text into past_experience.',
    '',
    '## Examples',
    'Text: "Intern at Equitable Advisors. Class of 2025. Dallas."',
    '→ {"company":"Equitable Advisors","school":null,"location":"Dallas","past_experience":"Intern at Equitable Advisors"}',
    '',
    'Text: "Software Engineering student at Air University. Class of 2026. Islamabad."',
    '→ {"company":null,"school":"Air University","location":"Islamabad","past_experience":null}',
    '',
    'Text: "Experience Sales Intern · Goldman Sachs · May 2024. New York."',
    '→ {"company":"Goldman Sachs","school":null,"location":"New York","past_experience":"Sales Intern at Goldman Sachs"}',
    '',
    'Text: "Lecturer/Software Developer. COMSATS University Islamabad. Sep 2010 - Present 15 years. Islamabad."',
    '→ {"company":null,"school":"COMSATS University Islamabad","location":"Islamabad","past_experience":null}',
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

function mergeExtracted(target, row, sourceText) {
  const existingCompany = usableCompany(target.company);

  const company = existingCompany
    || cleanCompanyCandidate(groundExtractedValue(row.company, sourceText))
    || null;
  const school = target.school
    || groundExtractedValue(row.school, sourceText)
    || null;
  const location = target.location
    || groundExtractedValue(row.location, sourceText)
    || null;
  const pastExperience = (!target.past_experience || looksLikeExperienceDump(target.past_experience))
    ? groundPastExperience(row.past_experience, sourceText)
    : target.past_experience;

  return sanitizeLeadFields({
    ...target,
    company,
    school,
    location,
    past_experience: pastExperience,
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
 * Replaces Experience-dump "company" values. Never throws.
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
    .filter(({ lead, text }) => text.length > 20)
    .filter(({ lead }) => needsEnrichment(lead));

  if (pending.length === 0) return prepared;

  onLog?.(`  AI field extract: ${pending.length} lead(s) need company/school/location/experience`);

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
  onLog?.(`  fields enriched: ${filled}/${out.length} lead(s) now have company, school, location or experience`);
  return out;
}
