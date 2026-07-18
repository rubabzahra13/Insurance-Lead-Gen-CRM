import {
  batchLinkResolverPrompt,
  companyRefinementPrompt,
  expandSearchNotesPrompt,
  searchOnlyPrompt,
  singleLinkResolverPrompt,
  structureLeadsPrompt,
} from './prompts.js';
import { refineCompanyNames as runCompanyRefine } from './company-refine.js';
import { normalizeLlmResponse } from './llm-response.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const RETRYABLE_STATUSES = new Set([429, 500, 529, 503]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestTimeoutMs(useSearch = false) {
  const base = Number(process.env.CLAUDE_REQUEST_TIMEOUT_MS ?? process.env.LLM_REQUEST_TIMEOUT_MS ?? 120_000);
  if (!useSearch) return base;
  return Number(process.env.CLAUDE_SEARCH_TIMEOUT_MS ?? Math.max(base, 240_000));
}

function logProgress(label, startedAt) {
  if (process.env.QUIET === 'true') return;
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  console.log(`  … ${label} (${seconds}s)`);
}

function getApiKey(options) {
  const apiKey = (options.apiKey ?? process.env.ANTHROPIC_API_KEY)?.trim();
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is missing in .env. Add your key from https://console.anthropic.com',
    );
  }
  return apiKey;
}

const DEFAULT_WEB_SEARCH_VERSION = 'web_search_20260209';
const DEFAULT_RESEARCH_MODEL = 'claude-sonnet-4-6';
const DEFAULT_RESOLVER_MODEL = 'claude-haiku-4-5-20251001';

function webSearchVersion() {
  return process.env.CLAUDE_WEB_SEARCH_VERSION ?? DEFAULT_WEB_SEARCH_VERSION;
}

function webSearchTools(useSearch) {
  if (!useSearch) return [];

  const version = webSearchVersion();
  const maxUses = Number(process.env.CLAUDE_WEB_SEARCH_MAX_USES ?? 5);
  const tool = {
    type: version,
    name: 'web_search',
    max_uses: maxUses,
  };

  if (process.env.CLAUDE_SEARCH_LINKEDIN_ONLY !== 'false') {
    tool.allowed_domains = ['linkedin.com'];
  }

  const tools = [tool];

  // Older web_search_20250305 has no dynamic filtering. web_search_20260209 auto-injects
  // code_execution on Anthropic's side — do not add it here (causes a 400 name conflict).

  return tools;
}

export async function callClaude({
  prompt,
  model,
  useSearch = true,
  maxTokens = 8192,
  options = {},
}) {
  const apiKey = getApiKey(options);
  const maxRetries = Number(process.env.CLAUDE_MAX_RETRIES ?? process.env.LLM_MAX_RETRIES ?? 4);
  const startedAt = Date.now();
  const heartbeatMs = Number(process.env.LLM_PROGRESS_INTERVAL_MS ?? 10_000);

  const body = {
    model,
    max_tokens: maxTokens,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
    tools: webSearchTools(useSearch),
  };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const heartbeat = setInterval(() => logProgress(model, startedAt), heartbeatMs);

    let response;
    try {
      response = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(requestTimeoutMs(useSearch)),
      });
    } catch (error) {
      clearInterval(heartbeat);
      const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
      if (!timedOut || attempt === maxRetries - 1) {
        throw new Error(
          timedOut
            ? `Claude API timed out after ${requestTimeoutMs(useSearch)}ms (${model})`
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

    if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxRetries - 1) {
      throw new Error(`Claude API error (${response.status}): ${message}`);
    }

    const retryMatch = message.match(/retry.*?(\d+)/i);
    const delayMs = retryMatch
      ? Math.min(60_000, Number(retryMatch[1]) * 1000 + 500)
      : Math.min(8000, 1500 * 2 ** attempt);
    logProgress(`rate limited, retrying in ${Math.round(delayMs / 1000)}s`, startedAt);
    await sleep(delayMs);
  }

  throw new Error('Claude API request failed after retries');
}

export async function researchLeads(searchPrompt, options = {}) {
  const model =
    options.researchModel ?? process.env.CLAUDE_RESEARCH_MODEL ?? DEFAULT_RESEARCH_MODEL;

  return callClaude({
    prompt: searchOnlyPrompt(searchPrompt, options.searchRecipe ?? null),
    model,
    useSearch: true,
    maxTokens: 8192,
    options,
  });
}

export async function expandSearchNotes(rawItems, searchPrompt, options = {}) {
  const model =
    options.researchModel ?? process.env.CLAUDE_RESEARCH_MODEL ?? DEFAULT_RESEARCH_MODEL;
  const profiles = rawItems.filter((item) => item.title !== 'model_research_notes');

  return callClaude({
    prompt: expandSearchNotesPrompt(searchPrompt, profiles),
    model,
    useSearch: true,
    maxTokens: 8192,
    options,
  });
}

export async function structureLeadsFromRaw(rawItems, searchPrompt, options = {}) {
  const model =
    options.structureModel ??
    process.env.CLAUDE_STRUCTURE_MODEL ??
    process.env.CLAUDE_RESEARCH_MODEL ??
    DEFAULT_RESEARCH_MODEL;
  const maxResults = Number(options.maxResults ?? process.env.MAX_RESULTS ?? 25);

  if (rawItems.length === 0) {
    throw new Error('No search results captured to structure.');
  }

  return callClaude({
    prompt: structureLeadsPrompt(rawItems, searchPrompt, maxResults, options.structureContext ?? null),
    model,
    useSearch: false,
    maxTokens: 8192,
    options,
  });
}

export async function resolveSingleLeadLink(lead, options = {}) {
  const model =
    options.resolverModel ?? process.env.CLAUDE_RESOLVER_MODEL ?? DEFAULT_RESOLVER_MODEL;

  return callClaude({
    prompt: singleLinkResolverPrompt(lead),
    model,
    useSearch: true,
    maxTokens: 2048,
    options,
  });
}

async function callResolver(prompt, options = {}) {
  const primary =
    options.resolverModel ?? process.env.CLAUDE_RESOLVER_MODEL ?? DEFAULT_RESOLVER_MODEL;
  const fallback =
    options.resolverFallbackModel ??
    process.env.CLAUDE_RESOLVER_FALLBACK_MODEL ??
    process.env.CLAUDE_RESEARCH_MODEL ??
    DEFAULT_RESEARCH_MODEL;

  try {
    return await callClaude({ prompt, model: primary, useSearch: true, maxTokens: 4096, options });
  } catch (error) {
    if (!String(error.message).includes('429') || primary === fallback) throw error;
    return callClaude({ prompt, model: fallback, useSearch: true, maxTokens: 4096, options });
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
    options.resolverModel ?? process.env.CLAUDE_RESOLVER_MODEL ?? DEFAULT_RESOLVER_MODEL;

  return runCompanyRefine(
    leads,
    (prompt) => callClaude({ prompt, model, useSearch: false, maxTokens: 4096, options }),
    companyRefinementPrompt,
  );
}
