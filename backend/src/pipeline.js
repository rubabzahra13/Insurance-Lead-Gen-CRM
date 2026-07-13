import {
  activeProvider,
  expandSearchNotes,
  researchLeads,
  resolveLeadLinksInBatches,
  resolveLeadLinksIndividually,
  structureLeadsFromRaw,
} from './llm.js';
import { applyResolvedLinks, filterValidLeads, rankLeads } from './extract-leads.js';
import {
  clearLinksForReResolution,
  dedupeByPerson,
  findLinkCollisions,
  findSuspiciousSlugs,
} from './dedupe.js';
import { annotateLeadConfidence } from './confidence.js';
import { applyGroundingProfileLinks, resolveGroundingRedirects } from './resolve-grounding.js';
import {
  collectRawFromResponses,
  researchNotesLength,
  saveRawSearchResults,
} from './raw-search.js';
import { exportAndSyncAvatar12Leads } from './avatar12-export.js';
import { parseStructuredLeads } from './structure-leads.js';
import { verifyLinkedInUrl } from './verify-url.js';
import { linkedinSlugFromUrl, mapWithConcurrency, personIdentityKey } from './utils.js';

function createTrace() {
  const steps = [];

  return {
    add(name, detail) {
      steps.push({ name, ...detail });
    },
    toJSON() {
      return steps;
    },
  };
}

function createProgressEmitter(options) {
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
      urlVerification: lead.link
        ? { status: 'skipped', reason: 'verify_links_disabled' }
        : null,
    }));
  }

  const concurrency = Number(process.env.URL_VERIFY_CONCURRENCY ?? 6);
  const maxToVerify = Number(process.env.URL_VERIFY_MAX ?? 12);
  const targets = leads.filter((lead) => lead.link).slice(0, maxToVerify);
  const targetSet = new Set(targets);

  const verified = await mapWithConcurrency(targets, concurrency, async (lead) => {
    if (!lead.link) return lead;

    const verification = await verifyLinkedInUrl(lead.link, { expectedName: lead.name });
    const finalUrl = verification.finalUrl ?? lead.link;

    return {
      ...lead,
      link: finalUrl,
      linkSlug: linkedinSlugFromUrl(finalUrl),
      urlVerification: verification,
    };
  });

  const verifiedByKey = new Map(verified.map((lead) => [personIdentityKey(lead), lead]));

  return leads.map((lead) => {
    const updated = verifiedByKey.get(personIdentityKey(lead));
    if (updated) return updated;
    if (!lead.link || !targetSet.has(lead)) return lead;
    return {
      ...lead,
      urlVerification: { status: 'skipped', reason: 'verify_limit_reached' },
    };
  });
}

function applyConfidenceScores(leads) {
  const collisions = findLinkCollisions(leads);
  const collisionIdentities = new Set(
    collisions.flatMap((group) => group.slice(1).map((lead) => personIdentityKey(lead))),
  );
  const suspiciousIdentities = findSuspiciousSlugs(leads);

  return leads.map((lead) =>
    annotateLeadConfidence(lead, {
      duplicateLink: collisionIdentities.has(personIdentityKey(lead)),
      suspiciousSlug: suspiciousIdentities.has(personIdentityKey(lead)),
    }),
  );
}

function partitionForExport(leads) {
  const minConfidence = Number(process.env.MIN_CONFIDENCE ?? 0.55);
  const accepted = [];
  const rejected = [];

  for (const lead of leads) {
    if (lead.status === 'rejected' || lead.confidence < minConfidence) {
      rejected.push(lead);
    } else {
      accepted.push(lead);
    }
  }

  return { accepted, rejected };
}

export async function runLeadPipeline(searchPrompt, options = {}) {
  const maxResults = Number(options.maxResults ?? process.env.MAX_RESULTS ?? 25);
  const trace = createTrace();
  const progress = createProgressEmitter(options);

  progress.log(`LLM provider: ${activeProvider()}`);
  options.onProgress?.({ type: 'meta', provider: activeProvider(), searchPrompt, maxResults });
  progress.log('Pipeline: search → store raw → LLM structure → verify → export\n');

  trace.add('search', { status: 'running' });
  let researchResponse = await progress.step('Web search', () =>
    researchLeads(searchPrompt, options),
  );

  let rawItems = collectRawFromResponses([researchResponse]);
  const minNotes = Number(process.env.RESEARCH_NOTES_MIN_CHARS ?? 400);

  if (researchNotesLength(rawItems) < minNotes) {
    progress.log('Research notes sparse — running follow-up to capture profile descriptions...');
    trace.add('search-expand', { status: 'running' });
    const expandResponse = await progress.step('Expanding search details', () =>
      expandSearchNotes(rawItems, searchPrompt, options),
    );
    rawItems = collectRawFromResponses([researchResponse, expandResponse]);
    trace.add('search-expand', {
      status: 'done',
      notesLength: researchNotesLength(rawItems),
    });
  }

  const rawPath = saveRawSearchResults(rawItems, searchPrompt);
  if (rawPath) progress.log(`Raw search results saved: ${rawPath}`);
  options.onProgress?.({ type: 'raw_saved', path: rawPath, count: rawItems.length });

  trace.add('search', { status: 'done', rawResults: rawItems.length });

  trace.add('structure', { status: 'running' });
  const structureResponse = await progress.step('LLM reading & structuring results', () =>
    structureLeadsFromRaw(rawItems, searchPrompt, { ...options, maxResults }),
  );

  let leads = dedupeByPerson(
    filterValidLeads(parseStructuredLeads(structureResponse, rawItems, searchPrompt)),
  );
  trace.add('structure', {
    status: 'done',
    candidates: leads.length,
    withLinks: leads.filter((lead) => lead.link).length,
  });

  options.onProgress?.({
    type: 'leads_preview',
    leads: leads.slice(0, maxResults),
    stage: 'structured',
  });

  const groundingResponses = [researchResponse];

  const missingLinks = leads.filter((lead) => !lead.link);
  const maxResolveTargets = Number(
    options.maxResolveTargets ?? process.env.LINK_RESOLVE_MAX_TARGETS ?? maxResults,
  );
  const resolveTargets = missingLinks.slice(0, maxResolveTargets);

  if (resolveTargets.length > 0) {
    trace.add('resolve', { status: 'running', targets: resolveTargets.length });
    const resolverResults = await progress.step(
      `Link resolver (${resolveTargets.length} missing links)`,
      () => resolveLeadLinksInBatches(leads, { ...options, maxResolveTargets }),
    );
    groundingResponses.push(...resolverResults.map((entry) => entry.response));
    rawItems = collectRawFromResponses(groundingResponses);
    leads = dedupeByPerson(applyResolvedLinks(leads, resolverResults));
    trace.add('resolve', {
      status: 'done',
      resolved: leads.filter((lead) => lead.link).length,
    });
  }

  const groundingLinks = await progress.step('Confirming links against search index', () =>
    resolveGroundingRedirects(groundingResponses, options),
  );
  leads = dedupeByPerson(applyGroundingProfileLinks(leads, groundingLinks));
  trace.add('ground-links', {
    status: 'done',
    indexedUrls: groundingLinks.length,
    confirmedLeads: leads.filter((lead) => lead.linkSource === 'grounding').length,
  });

  let suspiciousIdentities = findSuspiciousSlugs(leads);
  let collisions = findLinkCollisions(leads);
  const maxReResolve = Number(process.env.MAX_RERESOLVE_LEADS ?? 0);

  if (maxReResolve > 0 && (suspiciousIdentities.size > 0 || collisions.length > 0)) {
    const identitiesToFix = new Set([
      ...suspiciousIdentities,
      ...collisions.flatMap((group) => group.slice(1).map((lead) => personIdentityKey(lead))),
    ]);

    leads = clearLinksForReResolution(leads, identitiesToFix);
    const reResolveTargets = leads.filter(
      (lead) => identitiesToFix.has(personIdentityKey(lead)) && !lead.link,
    );

    if (reResolveTargets.length > 0) {
      const secondPass = await progress.step(
        `Re-resolve (${Math.min(reResolveTargets.length, maxReResolve)} leads)`,
        () => resolveLeadLinksIndividually(reResolveTargets.slice(0, maxReResolve), options),
      );
      leads = dedupeByPerson(applyResolvedLinks(leads, secondPass));
    }
  }

  trace.add('verify', { status: 'running' });
  leads = await progress.step('Scoring confidence', async () => {
    const verified = await verifyLeadUrls(leads);
    return applyConfidenceScores(verified);
  });
  trace.add('verify', {
    status: 'done',
    verified: leads.filter((lead) => lead.urlVerification?.status === 'verified').length,
    inconclusive: leads.filter((lead) => lead.urlVerification?.status === 'inconclusive').length,
    invalid: leads.filter((lead) => lead.urlVerification?.status === 'invalid').length,
  });

  const ranked = rankLeads(leads);
  const { accepted, rejected } = partitionForExport(ranked);
  const exportLeads = accepted.slice(0, maxResults);

  trace.add('export', {
    status: 'done',
    accepted: exportLeads.length,
    rejected: rejected.length,
    minConfidence: Number(process.env.MIN_CONFIDENCE ?? 0.55),
  });

  const result = {
    leads: exportLeads,
    rejected,
    trace: trace.toJSON(),
    rawPath,
    stats: {
      researched: leads.length,
      exported: exportLeads.length,
      withLinks: exportLeads.filter((lead) => lead.link).length,
      verifiedLinks: exportLeads.filter((lead) => lead.urlVerification?.status === 'verified').length,
      avgConfidence:
        exportLeads.length > 0
          ? Number(
              (
                exportLeads.reduce((sum, lead) => sum + lead.confidence, 0) / exportLeads.length
              ).toFixed(2),
            )
          : 0,
    },
  };

  options.onProgress?.({ type: 'leads_ready', leads: exportLeads, stage: 'export' });
  options.onProgress?.({ type: 'complete', result });

  await exportAndSyncAvatar12Leads(exportLeads, {
    avatarType: options.avatarType ?? process.env.AVATAR_TYPE ?? 'avatar2',
    syncFn: options.syncAvatar12Leads,
    onSyncError: (error) => progress.log(`Avatar 1/2 draft sync skipped: ${error.message}`),
  });

  return result;
}
