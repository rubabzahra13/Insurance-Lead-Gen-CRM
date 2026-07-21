// Experimental lead engine: SERP-API retrieval + runtime checklist + filters.

import { structureWithOpenAI, openaiAvailable } from './openai-structure.js';
import { parseStructuredLeads } from './structure-leads.js';
import { structureSerpLeads } from './serp-structure.js';
import { filterValidLeads, rankLeads } from './extract-leads.js';
import { dedupeByPerson, findLinkCollisions, findSuspiciousSlugs } from './dedupe.js';
import { annotateLeadConfidence } from './confidence.js';
import { verifyLinkedInUrl } from './verify-url.js';
import { exportAndSyncAvatar12Leads } from './avatar12-export.js';
import { saveRawSearchResults } from './raw-search.js';
import { sanitizeLeadFields } from './lead-fields.js';
import { enrichLeadFields } from './enrich-fields-llm.js';
import { enrichLeadEmails } from './email-serp-enrich.js';
import { linkedinSlugFromUrl, mapWithConcurrency, personIdentityKey } from './utils.js';
import { buildAvatarSearch } from './avatar-prompts.js';
import { buildSearchPlan, applyPlanCodeFilter } from './search-plan.js';
import { scoreLeadsWithLlm, fillMissingLocationsFromPlan } from './lead-llm-filter.js';
import { rankLeadsByMatchTier, isExportableTier } from './match-tiers.js';
import { runSerpLanes as _runLanes, serpResultsToRawItems, serpAvailable } from './serp-search.js';

function progressEmitter(options) {
  const onProgress = options.onProgress;
  return {
    log(message) {
      if (process.env.QUIET !== 'true') console.log(message);
      onProgress?.({ type: 'log', message });
    },
    async step(label, fn) {
      const startedAt = Date.now();
      this.log(`→ ${label}...`);
      onProgress?.({ type: 'step_start', label });
      const result = await fn();
      const seconds = Number(((Date.now() - startedAt) / 1000).toFixed(1));
      this.log(`✓ ${label} (${seconds}s)`);
      onProgress?.({ type: 'step_done', label, seconds });
      return result;
    },
  };
}

async function verifyLeadUrls(leads) {
  if (process.env.VERIFY_LINKS === 'false') {
    return leads.map((lead) => ({
      ...lead,
      urlVerification: lead.link ? { status: 'skipped', reason: 'verify_links_disabled' } : null,
    }));
  }
  const concurrency = Number(process.env.URL_VERIFY_CONCURRENCY ?? 6);
  const maxToVerify = Number(process.env.URL_VERIFY_MAX ?? 20);
  const targets = leads.filter((lead) => lead.link).slice(0, maxToVerify);
  const verified = await mapWithConcurrency(targets, concurrency, async (lead) => {
    const verification = await verifyLinkedInUrl(lead.link, { expectedName: lead.name });
    const finalUrl = verification.finalUrl ?? lead.link;
    return { ...lead, link: finalUrl, linkSlug: linkedinSlugFromUrl(finalUrl), urlVerification: verification };
  });
  const byKey = new Map(verified.map((lead) => [personIdentityKey(lead), lead]));
  return leads.map((lead) => byKey.get(personIdentityKey(lead)) ?? lead);
}

function applyConfidenceScores(leads, avatarType) {
  const collisions = findLinkCollisions(leads);
  const collisionIdentities = new Set(
    collisions.flatMap((group) => group.slice(1).map((lead) => personIdentityKey(lead))),
  );
  const suspicious = findSuspiciousSlugs(leads);
  return leads.map((lead) =>
    annotateLeadConfidence(lead, {
      duplicateLink: collisionIdentities.has(personIdentityKey(lead)),
      suspiciousSlug: suspicious.has(personIdentityKey(lead)),
      avatarType,
    }),
  );
}

function partitionForExport(leads) {
  const minConfidence = Number(process.env.MIN_CONFIDENCE ?? 0.45);
  const accepted = [];
  const rejected = [];
  for (const lead of leads) {
    const tierOk = isExportableTier(lead.match_tier);
    const confOk = (lead.confidence ?? 0) >= minConfidence;
    if (!tierOk || lead.status === 'rejected' || !confOk) rejected.push(lead);
    else accepted.push(lead);
  }
  return { accepted, rejected };
}

async function retrieveSerpItems(plan, progress, lanes = plan.lanes) {
  const geo = plan.location
    ? { gl: plan.location.gl, serpLocation: plan.location.serpLocation }
    : null;

  if (plan.location?.label) {
    progress.log(
      `  location filter: ${plan.location.label}` +
        (plan.location.scope === 'country' ? ' (any city in country)' : ' (city strict)') +
        (plan.location.usaSmallCityRecall ? ' + USA metro/state recall' : '') +
        (plan.location.gl ? ` gl=${plan.location.gl}` : ''),
    );
  }

  const results = await _runLanes(lanes, {
    geo,
    onLane: ({ query, count }) => progress.log(`  search: ${count} results`),
  });

  return serpResultsToRawItems(results);
}

export async function runSerpLeadPipeline(userQuery, options = {}) {
  if (!serpAvailable()) {
    throw new Error('SERP engine requires SERPAPI_KEY or SERPER_API_KEY in .env');
  }

  const avatarType = options.avatarType ?? process.env.AVATAR_TYPE ?? 'avatar2';
  const maxResults = Number(options.maxResults ?? process.env.MAX_RESULTS ?? 25);
  const progress = progressEmitter(options);

  const plan = await progress.step('Building search checklist', () =>
    buildSearchPlan(userQuery, avatarType, {
      onLog: (msg) => progress.log(msg),
      uiLocation: options.uiLocation || null,
      role: options.role || userQuery,
    }),
  );

  const { searchPrompt } = buildAvatarSearch(avatarType, userQuery);
  const structureContext = plan.structureContext;

  progress.log(
    `Engine: SERP API · intent: ${plan.source} · lanes: ${plan.lanesSource} (${plan.lanes.length})`,
  );
  options.onProgress?.({
    type: 'meta',
    provider: 'serpapi',
    searchPrompt,
    maxResults,
    plan: plan.summary,
    lanesSource: plan.lanesSource,
  });

  let rawItems = await progress.step('Profile search (parallel lanes)', () =>
    retrieveSerpItems(plan, progress),
  );

  let profileCount = rawItems.filter((i) => i.title !== 'model_research_notes').length;
  if (profileCount === 0 && plan.fallbackLanes?.length) {
    progress.log('Primary search empty — retrying with simplified recall lanes...');
    rawItems = await retrieveSerpItems(plan, progress, plan.fallbackLanes);
    profileCount = rawItems.filter((i) => i.title !== 'model_research_notes').length;
  }

  if (profileCount === 0) {
    progress.log('No LinkedIn results from Google for this query.');
    const empty = { leads: [], rejected: [], stats: { researched: 0, exported: 0 } };
    options.onProgress?.({ type: 'complete', result: empty });
    return empty;
  }

  const rawPath = saveRawSearchResults(rawItems, searchPrompt);
  options.onProgress?.({ type: 'raw_saved', path: rawPath, count: rawItems.length });

  const structureCap = Math.max(maxResults * 2, 30);

  let leads = await progress.step('Reading & structuring results', async () => {
    // Always run code structuring so a sparse LLM response (often 1 lead) cannot
    // starve the rest of the SERP results. Merge + dedupe afterward.
    const codeLeads = dedupeByPerson(
      filterValidLeads(
        structureSerpLeads(rawItems, {
          avatarType,
          searchPrompt,
          roleTerms: plan.roleTerms,
          roleSynonyms: plan.roleSynonyms,
        }),
      ),
    );

    const attempts = [];
    if (openaiAvailable()) {
      attempts.push([
        'OpenAI',
        () => structureWithOpenAI(rawItems, searchPrompt, { maxResults: structureCap, structureContext }),
      ]);
    }

    let llmLeads = [];
    for (const [name, fn] of attempts) {
      try {
        const response = await fn();
        const parsed = dedupeByPerson(
          filterValidLeads(parseStructuredLeads(response, rawItems, searchPrompt)),
        );
        if (parsed.length === 0) throw new Error('no usable leads');
        progress.log(`Structured with ${name} (${parsed.length}) + code (${codeLeads.length})`);
        llmLeads = parsed;
        break;
      } catch (error) {
        progress.log(`${name} structuring unavailable (${error.message})`);
      }
    }

    if (llmLeads.length === 0) {
      progress.log(`Using code-based structuring (${codeLeads.length})`);
      return codeLeads;
    }

    // Prefer richer LLM fields when the same person appears in both.
    return dedupeByPerson([...llmLeads, ...codeLeads]);
  });

  // Single gate for company/location, applied to BOTH structurers' output. Each
  // one used to carry its own field rules, so a fix on one path (e.g. rejecting
  // a job title as a company) silently left the other path broken.
  leads = leads.map(sanitizeLeadFields);

  // Fill the blanks the structurers left. The LLM structurer only returns the
  // people it judges a match (~10 of 28), so the rest arrive with empty fields;
  // this reads company/school/location for every lead from the text we already
  // retrieved, which also handles non-English and acronym school names.
  leads = await progress.step('AI-reading company, school & experience', () =>
    enrichLeadFields(leads, { onLog: (msg) => progress.log(msg) }),
  );

  // Infer city from the search plan before hard veto — SERP snippets often omit it.
  leads = fillMissingLocationsFromPlan(leads, plan);

  const codePass = applyPlanCodeFilter(leads, plan);
  if (codePass.dropped.length > 0) {
    progress.log(`  code filter dropped ${codePass.dropped.length} lead(s)`);
  }
  leads = fillMissingLocationsFromPlan(codePass.leads, plan);

  const llmPass = await progress.step('AI match scoring', () =>
    scoreLeadsWithLlm(leads, plan, { onLog: (msg) => progress.log(msg) }),
  );
  leads = fillMissingLocationsFromPlan(llmPass.leads, plan);

  options.onProgress?.({ type: 'leads_preview', leads: rankLeadsByMatchTier(leads).slice(0, maxResults), stage: 'filtered' });

  leads = await progress.step('Verifying profiles & scoring', async () => {
    const verified = await verifyLeadUrls(leads);
    return applyConfidenceScores(verified, avatarType);
  });

  const ranked = rankLeadsByMatchTier(rankLeads(leads));
  const { accepted, rejected } = partitionForExport(ranked);
  let exportLeads = accepted.slice(0, maxResults);

  // Public email pass (snippet first, then 1 Google query per blank lead).
  exportLeads = await progress.step('Finding public emails (SerpAPI)', () =>
    enrichLeadEmails(exportLeads, { onLog: (msg) => progress.log(msg) }),
  );

  const result = {
    leads: exportLeads,
    rejected,
    rawPath,
    stats: {
      researched: leads.length,
      exported: exportLeads.length,
      withLinks: exportLeads.filter((lead) => lead.link).length,
      verifiedLinks: exportLeads.filter((lead) => lead.urlVerification?.status === 'verified').length,
      withEmails: exportLeads.filter((lead) => (lead.contact_email || '').trim()).length,
      avgConfidence:
        exportLeads.length > 0
          ? Number((exportLeads.reduce((s, l) => s + l.confidence, 0) / exportLeads.length).toFixed(2))
          : 0,
      perfectMatches: exportLeads.filter((l) => l.match_tier === 'perfect').length,
      strongMatches: exportLeads.filter((l) => l.match_tier === 'strong').length,
      nearMatches: exportLeads.filter((l) => l.match_tier === 'near').length,
    },
  };

  options.onProgress?.({ type: 'leads_ready', leads: exportLeads, stage: 'export' });

  // Sync to Outreach Drafts BEFORE telling the UI the job is done, so navigating
  // to drafts after completion always sees the new leads.
  await exportAndSyncAvatar12Leads(exportLeads, {
    avatarType,
    syncFn: options.syncAvatar12Leads,
    onSyncError: (error) => progress.log(`Draft sync skipped: ${error.message}`),
  });

  options.onProgress?.({ type: 'complete', result });

  return result;
}
