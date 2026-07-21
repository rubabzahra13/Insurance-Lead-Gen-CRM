// AI match scoring: assigns Perfect / Strong / Near / Drop tiers at runtime from the search plan.

import { openaiAvailable } from './openai-structure.js';
import { parseJsonFromText, asLeadArray } from './parse-json.js';
import { applyHardVeto } from './plan-filter.js';
import {
  annotateLeadMatchTier,
  matchTierLabel,
  normalizeMatchTier,
} from './match-tiers.js';

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

function scorePrompt(plan, leads, batchOffset = 0) {
  const people = leads.map((l, i) => leadSummary(l, batchOffset + i)).join('\n\n');
  const loc = plan.location?.label
    ? plan.location.scope === 'country'
      ? `Location: anywhere in ${plan.location.label}`
      : `Location required: ${plan.location.label}`
    : 'No strict location';

  const perfectTitles = [...(plan.roleTerms || []), ...(plan.roleSynonyms || [])].join(', ');
  const relatedTitles = (plan.relatedTitles || []).join(', ') || '(none — use career-adjacent judgment)';

  return [
    'You are a specialized LinkedIn lead-finding expert scoring candidates for a recruiter.',
    'Output strict JSON only. Use ONLY the profile text shown — do not invent facts.',
    'Judge the TITLE first; snippet supports but must not override a clearly different career.',
    '',
    `# Search goal`,
    plan.summary,
    '',
    `# Avatar`,
    plan.avatarType === 'avatar1'
      ? 'Job Seekers — entry-level / recent grads / students / interns in the requested role.'
      : 'Job Upgraders — employees open to better opportunities. Drop CEOs/founders/owners/partners.',
    '',
    `# Match tiers (assign exactly one per person)`,
    '- perfect: title is a DIRECT match — same career the recruiter asked for. Includes exact matches to',
    '  role_terms or role_synonyms, common abbreviations (RN, LO, FA, CSR), and industry-equivalent titles',
    '  (e.g. "Insurance Producer" = perfect for insurance agent; "Licensed Insurance Agent" = perfect for telesales).',
    '- strong: very close variant — same career family, minor wording difference (Sales Agent vs Sales Representative).',
    `- near: ONLY titles in related_titles (${relatedTitles}) — adjacent role, NOT a direct synonym.`,
    '- drop: wrong career entirely, CEO/founder (avatar2), or explicit wrong city/country.',
    '',
    `# Checklist`,
    loc,
    `Direct-hit titles (perfect/strong): ${perfectTitles}`,
    `Adjacent titles (near only): ${relatedTitles}`,
    `Preferred signals: ${(plan.includeSignals || []).slice(0, 8).join(', ') || '—'}`,
    `Never keep if title is: ${(plan.excludeTitles || []).join(', ') || '—'}`,
    `Drop off-role careers: ${(plan.excludeRoles || []).join(', ') || '—'}`,
    '',
    'Prefer perfect over strong when the title clearly matches what the recruiter asked for.',
    'Do NOT downgrade a direct synonym to near — if it is in the direct-hit list above, use perfect or strong.',
    'When unsure between near and drop but the person is in a related industry, choose near.',
    '',
    '# People',
    people,
    '',
    '# Output',
    'JSON array only:',
    '[{"index":1,"tier":"perfect","reason":"Insurance agent title matches"},{"index":2,"tier":"near","reason":"CSR at BPO — adjacent to telesales"}]',
    'tier must be: perfect | strong | near | drop',
    'index is 1-based matching the list above.',
  ].join('\n');
}

async function scoreBatch(leads, plan, batchOffset, model, fetchFn = fetch) {
  const res = await fetchFn(OPENAI_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You are a specialized LinkedIn lead-finding expert. Score leads into match tiers: perfect, strong, near, or drop. ' +
            'Direct title matches and industry equivalents = perfect/strong — never near. ' +
            'related_titles define near matches only. Output strict JSON.',
        },
        { role: 'user', content: scorePrompt(plan, leads, batchOffset) },
      ],
    }),
    signal: AbortSignal.timeout(Number(process.env.OPENAI_TIMEOUT_MS ?? 60_000)),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI scorer ${res.status}: ${body.slice(0, 80)}`);
  }

  const data = await res.json();
  const parsed = asLeadArray(parseJsonFromText(data?.choices?.[0]?.message?.content ?? ''));
  return parsed;
}

/**
 * AI assigns match tier per lead. Non-drop tiers are kept and tagged for UI ranking.
 * Missing index → near (safe default). Hard veto re-applied after.
 */
export async function scoreLeadsWithLlm(leads, plan, { onLog, fetchFn = fetch } = {}) {
  if (!openaiAvailable() || !apiKey() || leads.length === 0) {
    return {
      leads: leads.map((lead) => annotateLeadMatchTier(lead, 'near', 'AI scorer unavailable')),
      dropped: [],
    };
  }

  const model = process.env.OPENAI_FILTER_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  onLog?.(`AI match scoring ${leads.length} candidate(s)...`);

  const scored = [];
  const dropped = [];

  for (let offset = 0; offset < leads.length; offset += BATCH_SIZE) {
    const batch = leads.slice(offset, offset + BATCH_SIZE);
    let decisions = [];
    try {
      decisions = await scoreBatch(batch, plan, offset, model, fetchFn);
    } catch (error) {
      onLog?.(`  AI scorer batch skipped (${error.message}) — tagging batch as near`);
      scored.push(...batch.map((lead) => annotateLeadMatchTier(lead, 'near', 'Scorer unavailable')));
      continue;
    }

    const byIndex = new Map();
    for (const d of decisions) {
      const idx = Number(d.index);
      if (!Number.isFinite(idx) || idx < 1) continue;
      const tier = normalizeMatchTier(d.tier ?? d.match_tier);
      byIndex.set(idx, { tier, reason: String(d.reason ?? '').trim() });
    }

    batch.forEach((lead, i) => {
      const globalIdx = offset + i + 1;
      const decision = byIndex.get(globalIdx);
      const tier = decision?.tier ?? 'near';
      const reason = decision?.reason || '';

      if (tier === 'drop') {
        dropped.push({ lead, reason: reason || 'AI match scorer: did not fit search' });
      } else {
        scored.push(annotateLeadMatchTier(lead, tier, reason));
      }
    });
  }

  const tierCounts = { perfect: 0, strong: 0, near: 0 };
  for (const lead of scored) {
    const t = normalizeMatchTier(lead.match_tier);
    if (tierCounts[t] !== undefined) tierCounts[t] += 1;
  }
  onLog?.(
    `  tiers: ${tierCounts.perfect} perfect, ${tierCounts.strong} strong, ${tierCounts.near} near, ${dropped.length} dropped`,
  );

  if (dropped.length > 0) {
    onLog?.(`  dropped: ${dropped.slice(0, 6).map((d) => d.lead.name).join(', ')}${dropped.length > 6 ? '…' : ''}`);
  }

  const veto = applyHardVeto(scored, plan);
  if (veto.dropped.length > 0) {
    onLog?.(`  hard veto after scoring dropped ${veto.dropped.length}`);
  }

  return {
    leads: veto.leads,
    dropped: [...dropped, ...veto.dropped],
  };
}

/** @deprecated Use scoreLeadsWithLlm */
export async function filterLeadsWithLlm(leads, plan, options = {}) {
  return scoreLeadsWithLlm(leads, plan, options);
}

/**
 * Fill blank lead.location from the search plan.
 */
export function fillMissingLocationsFromPlan(leads, plan) {
  const queryLabel = String(plan?.location?.label || '').trim();
  if (!plan?.location?.tokens?.length && !queryLabel) return leads;

  return leads.map((lead) => {
    if (lead.location?.trim()) return lead;

    const corpus = [lead.snippet, lead.fit_evidence, lead.evidence, lead.title, lead.company]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const found = [...(plan.location?.tokens || [])]
      .filter((t) => t.length >= 4 && corpus.includes(t))
      .sort((a, b) => b.length - a.length);

    if (found.length) {
      const label = found[0].replace(/\b\w/g, (c) => c.toUpperCase());
      return { ...lead, location: label, locationSource: 'snippet' };
    }

    if (queryLabel) {
      return { ...lead, location: queryLabel, locationSource: 'query' };
    }

    return lead;
  });
}

export { matchTierLabel, normalizeMatchTier };
