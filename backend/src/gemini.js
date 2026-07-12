import { refineCompanyNames as runCompanyRefine } from './company-refine.js';
import {
  batchLinkResolverPrompt,
  buildGoogleQuery,
  companyRefinementPrompt,
  expandSearchNotesPrompt,
  searchOnlyPrompt,
  singleLinkResolverPrompt,
  structureLeadsPrompt,
} from './prompts.js';
import { normalizeLlmResponse } from './llm-response.js';

export { buildGoogleQuery };

const GEMINI_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models';

const RETRYABLE_STATUSES = new Set([429, 500, 503]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestTimeoutMs() {
  return Number(process.env.GEMINI_REQUEST_TIMEOUT_MS ?? process.env.LLM_REQUEST_TIMEOUT_MS ?? 90_000);
}

function logGeminiProgress(label, startedAt) {
  if (process.env.QUIET === 'true') return;
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  console.log(`  … ${label} (${seconds}s)`);
}

function getApiKey(options) {
  const apiKey = (options.apiKey ?? process.env.GEMINI_API_KEY)?.trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is missing or empty in .env. Save the file and add a key from https://aistudio.google.com',
    );
  }
  return apiKey;
}

export async function callGemini({ prompt, model, useSearch = true, temperature = 0.1, options = {} }) {
  const apiKey = getApiKey(options);
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature },
  };

  if (useSearch) {
    body.tools = [{ google_search: {} }];
  }

  const maxRetries = Number(process.env.GEMINI_MAX_RETRIES ?? process.env.LLM_MAX_RETRIES ?? 4);
  const startedAt = Date.now();
  const heartbeatMs = Number(process.env.LLM_PROGRESS_INTERVAL_MS ?? 10_000);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const heartbeat = setInterval(() => logGeminiProgress(model, startedAt), heartbeatMs);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(requestTimeoutMs()),
      });
    } catch (error) {
      clearInterval(heartbeat);
      const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
      if (!timedOut || attempt === maxRetries - 1) {
        throw new Error(
          timedOut
            ? `Gemini API timed out after ${requestTimeoutMs()}ms (${model})`
            : error.message,
        );
      }
      await sleep(Math.min(8000, 1500 * 2 ** attempt));
      continue;
    }

    clearInterval(heartbeat);

    const data = await response.json();

    if (response.ok) {
      return normalizeLlmResponse(data);
    }

    const message = data?.error?.message ?? response.statusText;
    const quotaExceeded = /quota|rate[- ]limit|resource_exhausted/i.test(message);

    if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxRetries - 1) {
      if (quotaExceeded) {
        const waitMatch = message.match(/retry in ([\d.]+)s/i);
        const waitHint = waitMatch
          ? ` Wait ~${Math.ceil(Number(waitMatch[1]))}s and try again.`
          : ' Wait a minute and try again.';
        throw new Error(
          `Gemini API quota/rate limit hit (free tier is ~20 requests/min for flash models).${waitHint}`,
        );
      }
      throw new Error(`Gemini API error (${response.status}): ${message}`);
    }

    const retryMatch = message.match(/retry in ([\d.]+)s/i);
    const retrySeconds = retryMatch ? Number(retryMatch[1]) : 0;
    const delayMs = retrySeconds
      ? Math.min(60_000, Math.ceil(retrySeconds * 1000) + 500)
      : Math.min(8000, 1500 * 2 ** attempt);
    logGeminiProgress(`rate limited, retrying in ${Math.round(delayMs / 1000)}s`, startedAt);
    await sleep(delayMs);
  }

  throw new Error('Gemini API request failed after retries');
}

export async function researchLeads(searchPrompt, options = {}) {
  const model =
    options.researchModel ?? process.env.GEMINI_RESEARCH_MODEL ?? 'gemini-2.5-flash';

  return callGemini({
    prompt: searchOnlyPrompt(searchPrompt),
    model,
    temperature: 0.1,
    options,
  });
}

export async function expandSearchNotes(rawItems, searchPrompt, options = {}) {
  const model =
    options.researchModel ?? process.env.GEMINI_RESEARCH_MODEL ?? 'gemini-2.5-flash';
  const profiles = rawItems.filter((item) => item.title !== 'model_research_notes');

  return callGemini({
    prompt: expandSearchNotesPrompt(searchPrompt, profiles),
    model,
    temperature: 0.1,
    options,
  });
}

export async function structureLeadsFromRaw(rawItems, searchPrompt, options = {}) {
  const model =
    options.structureModel ??
    process.env.GEMINI_STRUCTURE_MODEL ??
    process.env.GEMINI_RESEARCH_MODEL ??
    'gemini-2.5-flash';
  const maxResults = Number(options.maxResults ?? process.env.MAX_RESULTS ?? 25);

  if (rawItems.length === 0) {
    throw new Error('No search results captured to structure.');
  }

  return callGemini({
    prompt: structureLeadsPrompt(rawItems, searchPrompt, maxResults),
    model,
    useSearch: false,
    temperature: 0,
    options,
  });
}

export async function resolveSingleLeadLink(lead, options = {}) {
  const model =
    options.resolverModel ?? process.env.GEMINI_RESOLVER_MODEL ?? 'gemini-2.5-flash-lite';

  return callGemini({
    prompt: singleLinkResolverPrompt(lead),
    model,
    temperature: 0,
    options,
  });
}

async function callResolver(prompt, options = {}) {
  const primary =
    options.resolverModel ?? process.env.GEMINI_RESOLVER_MODEL ?? 'gemini-2.5-flash-lite';
  const fallback =
    options.resolverFallbackModel ??
    process.env.GEMINI_RESOLVER_FALLBACK_MODEL ??
    process.env.GEMINI_RESEARCH_MODEL ??
    'gemini-2.5-flash';

  try {
    return await callGemini({ prompt, model: primary, temperature: 0, options });
  } catch (error) {
    if (!String(error.message).includes('429') || primary === fallback) throw error;
    return callGemini({ prompt, model: fallback, temperature: 0, options });
  }
}

export async function resolveLeadLinksInBatches(leads, options = {}) {
  const { sleep: wait } = await import('./utils.js');
  const batchSize = Number(process.env.LINK_RESOLVE_BATCH_SIZE ?? 5);
  const delayMs = Number(process.env.LINK_RESOLVE_DELAY_MS ?? 0);
  const maxBatches = Number(process.env.LINK_RESOLVE_MAX_BATCHES ?? 1);
  const maxTargets = Number(
    options.maxResolveTargets ??
      process.env.LINK_RESOLVE_MAX_TARGETS ??
      process.env.MAX_RESULTS ??
      8,
  );

  const targets = leads.filter((lead) => !lead.link).slice(0, maxTargets);
  if (targets.length === 0) return [];

  const results = [];
  const batches = [];
  for (let i = 0; i < targets.length; i += batchSize) {
    batches.push(targets.slice(i, i + batchSize));
  }

  for (const [index, batch] of batches.slice(0, maxBatches).entries()) {
    const response = await callResolver(batchLinkResolverPrompt(batch), options);
    results.push({ leads: batch, response });

    if (index < Math.min(batches.length, maxBatches) - 1) {
      await wait(delayMs);
    }
  }

  return results;
}

export async function resolveLeadLinksIndividually(leads, options = {}) {
  const { mapWithConcurrency, sleep: wait } = await import('./utils.js');
  const concurrency = Number(process.env.LINK_RESOLVE_CONCURRENCY ?? 1);
  const delayMs = Number(process.env.LINK_RESOLVE_DELAY_MS ?? 2500);

  const targets = leads.filter((lead) => !lead.link);
  if (targets.length === 0) return [];

  return mapWithConcurrency(targets, concurrency, async (lead) => {
    const response = await resolveSingleLeadLink(lead, options);
    await wait(delayMs);
    return { lead, response };
  });
}

export async function resolveLeadLinks(leads, options = {}) {
  return resolveLeadLinksInBatches(leads, options);
}

export async function searchLinkedInLeads(searchPrompt, options = {}) {
  return researchLeads(searchPrompt, options);
}

export async function refineCompanyNames(leads, options = {}) {
  const model =
    options.resolverModel ?? process.env.GEMINI_RESOLVER_MODEL ?? 'gemini-2.5-flash-lite';

  return runCompanyRefine(
    leads,
    (prompt) => callGemini({ prompt, model, useSearch: false, temperature: 0, options }),
    companyRefinementPrompt,
  );
}
