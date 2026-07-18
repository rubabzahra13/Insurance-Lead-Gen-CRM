// Second-pass LLM filter: reads each structured lead against the search checklist.
// Hard veto re-applied after LLM — owners/CEOs can never slip through.

import { openaiAvailable } from './openai-structure.js';
import { parseJsonFromText } from './parse-json.js';
import { applyHardVeto } from './plan-filter.js';

const OPENAI_API = 'https://api.openai.com/v1/chat/completions';
const BATCH_SIZE = Number(process.env.LLM_FILTER_BATCH_SIZE ?? 8);

function apiKey() {
  return (process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY)?.trim();
}

function leadSummary(lead, index) {
  return [
    `${index + 1}. ${lead.name}`,
    `   title: ${lead.title || lead.headline || '—'}`,
    `   company: ${lead.company || '—'}`,
    `   location: ${lead.location || '—'}`,
    `   snippet: ${(lead.snippet || lead.fit_evidence || lead.evidence || '—').slice(0, 220)}`,
  ].join('\n');
}

function filterPrompt(plan, leads, batchOffset = 0) {
  const people = leads.map((l, i) => leadSummary(l, batchOffset + i)).join('\n\n');
  const loc = plan.location?.label
    ? plan.location.scope === 'country'
      ? `Location: anywhere in ${plan.location.label}`
      : `Location required: ${plan.location.label}`
    : 'No strict location';
  return [
    'You are a recruiter judge. Decide KEEP or DROP for each person.',
    'Use ONLY the profile text shown — do not invent facts.',
    'Judge the TITLE first. Snippet supports; it must not override a clearly different title.',
    'KEEP when the title matches the role focus (or a close synonym) and location is plausible.',
    'DROP clear mismatches: wrong career, CEO/founder (avatar2), or explicit wrong city.',
    'When unsure but title fits the role, KEEP.',
    '',
    `# Search goal`,
    plan.summary,
    '',
    `# Avatar`,
    plan.avatarType === 'avatar1'
      ? 'Job Seekers — prefer recent grads / entry-level in the requested role. Drop clearly different careers (e.g. finance when user asked software engineer). Do not drop a matching junior title just because “student”/“intern” is missing. Location marked inferred is OK if nothing contradicts the target city.'
      : 'Job Upgraders — employees at small agencies or upskilling talk. Drop CEOs/founders/owners/partners.',
    '',
    `# Checklist`,
    loc,
    `Role focus: ${[...plan.roleTerms, ...(plan.roleSynonyms || [])].join(', ')}`,
    `Preferred signals (helpful, not required): ${plan.includeSignals.slice(0, 8).join(', ')}`,
    `Never keep if title is: ${plan.excludeTitles.join(', ')}`,
    `Drop off-role: ${plan.excludeRoles.join(', ')}`,
    '',
    '# People',
    people,
    '',
    '# Output',
    'JSON array only:',
    '[{"index":1,"keep":true,"reason":"brief"},{"index":2,"keep":false,"reason":"CEO not employee"}]',
    'index is 1-based matching the list above.',
  ].join('\n');
}

async function filterBatch(leads, plan, batchOffset, model) {
  const res = await fetch(OPENAI_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You filter LinkedIn leads against a checklist. Output strict JSON only. Keep plausible role+location matches; drop clear mismatches.',
        },
        { role: 'user', content: filterPrompt(plan, leads, batchOffset) },
      ],
    }),
    signal: AbortSignal.timeout(Number(process.env.OPENAI_TIMEOUT_MS ?? 60_000)),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI filter ${res.status}: ${body.slice(0, 80)}`);
  }

  const data = await res.json();
  const parsed = parseJsonFromText(data?.choices?.[0]?.message?.content ?? '');
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * LLM second pass on leads that survived code filtering.
 * Missing index in response → KEEP (safe default). Hard veto applied after.
 */
export async function filterLeadsWithLlm(leads, plan, { onLog } = {}) {
  if (!openaiAvailable() || !apiKey() || leads.length === 0) {
    return { leads, dropped: [] };
  }

  const model = process.env.OPENAI_FILTER_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  onLog?.(`LLM filter reviewing ${leads.length} candidate(s)...`);

  const kept = [];
  const dropped = [];

  for (let offset = 0; offset < leads.length; offset += BATCH_SIZE) {
    const batch = leads.slice(offset, offset + BATCH_SIZE);
    let decisions = [];
    try {
      decisions = await filterBatch(batch, plan, offset, model);
    } catch (error) {
      onLog?.(`  LLM filter batch skipped (${error.message}) — keeping batch`);
      kept.push(...batch);
      continue;
    }

    const byIndex = new Map();
    for (const d of decisions) {
      const idx = Number(d.index);
      if (!Number.isFinite(idx) || idx < 1) continue;
      byIndex.set(idx, { keep: Boolean(d.keep), reason: String(d.reason ?? '').trim() });
    }

    batch.forEach((lead, i) => {
      const globalIdx = offset + i + 1;
      const decision = byIndex.get(globalIdx);
      // Missing decision → keep (do not drop silently).
      if (decision?.keep === false) {
        dropped.push({ lead, reason: decision.reason || 'LLM filter: did not match checklist' });
      } else {
        kept.push(lead);
      }
    });
  }

  if (dropped.length > 0) {
    onLog?.(`  LLM dropped ${dropped.length}: ${dropped.map((d) => d.lead.name).join(', ')}`);
  }

  const veto = applyHardVeto(kept, plan);
  if (veto.dropped.length > 0) {
    onLog?.(`  hard veto after LLM dropped ${veto.dropped.length}`);
  }

  return { leads: veto.leads, dropped: [...dropped, ...veto.dropped] };
}

/**
 * Fill location only when the profile text supports a plan token.
 * Never invent the search city onto the lead (that caused wrong-location exports).
 * Soft city matching in hard veto still trusts SerpAPI geo when location is null.
 */
export function fillMissingLocationsFromPlan(leads, plan) {
  if (!plan.location?.tokens?.length) return leads;
  return leads.map((lead) => {
    if (lead.location?.trim()) return lead;
    const corpus = [lead.snippet, lead.fit_evidence, lead.evidence, lead.title, lead.company]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const found = [...plan.location.tokens]
      .filter((t) => t.length >= 4 && corpus.includes(t))
      .sort((a, b) => b.length - a.length);
    if (!found.length) return lead;
    const label = found[0].replace(/\b\w/g, (c) => c.toUpperCase());
    return { ...lead, location: label, locationSource: 'snippet' };
  });
}
