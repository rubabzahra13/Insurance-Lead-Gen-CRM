import { parseLinkedInTitle } from './company.js';
import { vetLocationEcho } from './location.js';
import { parseJsonFromText, asLeadArray } from './parse-json.js';
import { normalizeLlmResponse } from './llm-response.js';
import {
  linkedinSlugFromUrl,
  looksLikeDomain,
  normalizeProfileUrl,
  normalizePersonName,
} from './utils.js';

const LINKEDIN_URL_RE = /https?:\/\/(?:[a-z]+\.)?linkedin\.com\/in\/[a-zA-Z0-9_%\-]+/gi;

function extractUrlsFromText(text) {
  return [...new Set((text.match(LINKEDIN_URL_RE) ?? []).map(normalizeProfileUrl).filter(Boolean))];
}

// A location that appears in the user's search query is only trusted when the
// search result text independently mentions it; otherwise the model likely echoed the query.
function normalizeLead(raw, searchPrompt, defaults = {}) {
  const link = normalizeProfileUrl(raw?.link ?? raw?.profileLink ?? raw?.url);
  const name = raw?.name?.trim() || defaults.name || null;
  const title = raw?.title?.trim() || defaults.title || null;
  const company = raw?.company?.trim() || defaults.company || null;
  const searchResultTitle = raw?.searchResultTitle?.trim() || defaults.searchResultTitle || null;

  if (!name && !link) return null;

  const rawItems = [
    {
      title: searchResultTitle ?? '',
      snippet: raw?.snippet?.trim() || defaults.snippet || '',
    },
  ];

  const location = vetLocationEcho(
    raw?.location?.trim() || defaults.location || null,
    searchPrompt,
    rawItems,
    `${raw?.snippet ?? ''} ${raw?.evidence ?? ''} ${searchResultTitle ?? ''}`,
  );

  return {
    name,
    title,
    company,
    location,
    link,
    linkSlug: link ? linkedinSlugFromUrl(link) : null,
    linkSource: link ? (defaults.linkSource ?? raw?.linkSource ?? 'research') : null,
    snippet: raw?.snippet?.trim() || defaults.snippet || null,
    evidence: raw?.evidence?.trim() || defaults.evidence || null,
    searchResultTitle: raw?.searchResultTitle?.trim() || defaults.searchResultTitle || null,
    source: raw?.source?.trim() || defaults.source || null,
    searchPrompt,
    scrapedAt: new Date().toISOString(),
  };
}

function mergeLead(existing, incoming) {
  const link = existing.link || incoming.link;
  return {
    ...existing,
    name: existing.name || incoming.name,
    title: existing.title || incoming.title,
    company: existing.company || incoming.company,
    location: existing.location || incoming.location,
    link,
    linkSlug: link ? linkedinSlugFromUrl(link) : null,
    linkSource: existing.linkSource || incoming.linkSource,
    snippet: existing.snippet || incoming.snippet,
    evidence: existing.evidence || incoming.evidence,
    searchResultTitle: existing.searchResultTitle || incoming.searchResultTitle,
    source: existing.source || incoming.source,
  };
}

function leadKey(lead) {
  if (lead.link) return lead.link;
  return `${normalizePersonName(lead.name)}|${(lead.company ?? '').toLowerCase()}`;
}

function addLead(map, lead) {
  if (!lead) return;
  const key = leadKey(lead);
  if (!key) return;

  if (map.has(key)) {
    map.set(key, mergeLead(map.get(key), lead));
  } else {
    map.set(key, lead);
  }
}

function ingestParsedLeads(map, parsed, searchPrompt, linkSource = 'research') {
  for (const raw of asLeadArray(parsed)) {
    addLead(map, normalizeLead(raw, searchPrompt, { linkSource }));
  }
}

function ingestLlmResponse(map, response, searchPrompt, linkSource = 'research') {
  const { text, groundingChunks } = normalizeLlmResponse(response);
  if (!text && groundingChunks.length === 0) return;

  ingestParsedLeads(map, parseJsonFromText(text), searchPrompt, linkSource);

  for (const url of extractUrlsFromText(text)) {
    addLead(map, normalizeLead({ link: url }, searchPrompt, { linkSource }));
  }

  for (const chunk of groundingChunks) {
    const title = chunk.title ?? '';
    const uri = chunk.uri ?? '';
    const citedText = chunk.citedText ?? '';
    const parsedTitle = parseLinkedInTitle(title);
    const urls = extractUrlsFromText(`${title} ${uri} ${citedText}`);

    addLead(
      map,
      normalizeLead(
        {
          name: parsedTitle.name,
          title: parsedTitle.title,
          company: parsedTitle.company,
          link: urls[0] ?? null,
          snippet: citedText || null,
          searchResultTitle: title || null,
          source: title || uri,
        },
        searchPrompt,
        { linkSource: urls[0] ? 'research' : null },
      ),
    );
  }
}

export function extractLeadsFromResponses(responses, searchPrompt, linkSource = 'research') {
  const map = new Map();
  const list = Array.isArray(responses) ? responses : [responses];

  for (const response of list) {
    if (!response) continue;
    ingestLlmResponse(map, response, searchPrompt, linkSource);
  }

  return Array.from(map.values()).filter((lead) => lead.name || lead.link);
}

function collectLinksFromResolverResponse(response, batchLeads, linkByName) {
  const { text, groundingChunks } = normalizeLlmResponse(response);
  const parsed = parseJsonFromText(text);
  const items = asLeadArray(parsed);

  for (const item of items) {
    const link = normalizeProfileUrl(item?.link);
    const name = normalizePersonName(item?.name);
    if (name && link) linkByName.set(name, link);
  }

  for (const lead of batchLeads) {
    for (const url of extractUrlsFromText(text)) {
      const name = normalizePersonName(lead.name);
      if (name && !linkByName.has(name)) linkByName.set(name, url);
    }
  }

  for (const chunk of groundingChunks) {
    const title = chunk.title ?? '';
    const uri = chunk.uri ?? '';
    const citedText = chunk.citedText ?? '';
    const urls = extractUrlsFromText(`${title} ${uri} ${citedText}`);
    if (urls.length === 0) continue;

    const parsedTitle = parseLinkedInTitle(title);
    const name = normalizePersonName(parsedTitle.name);
    if (name) {
      linkByName.set(name, urls[0]);
      continue;
    }

    for (const lead of batchLeads) {
      const leadName = normalizePersonName(lead.name);
      const haystack = `${title} ${uri} ${citedText}`.toLowerCase();
      if (leadName && haystack.includes(leadName.split(' ')[0])) {
        linkByName.set(leadName, urls[0]);
      }
    }
  }
}

export function applyResolvedLinks(leads, resolverResults) {
  const linkByName = new Map();

  for (const entry of resolverResults ?? []) {
    const response = entry.response ?? entry;
    const batchLeads = entry.leads ?? (entry.lead ? [entry.lead] : leads);
    collectLinksFromResolverResponse(response, batchLeads, linkByName);
  }

  return leads.map((lead) => {
    const resolved = linkByName.get(normalizePersonName(lead.name));
    if (!resolved) return lead;

    return {
      ...lead,
      link: lead.link ?? resolved,
      linkSlug: linkedinSlugFromUrl(lead.link ?? resolved),
      linkSource: lead.link ? lead.linkSource : 'resolver',
    };
  });
}

export function rankLeads(leads) {
  return [...leads].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
}

export function isValidLead(lead) {
  const name = lead.name?.trim();
  if (!name || looksLikeDomain(name)) return false;
  return Boolean(lead.title || lead.company || lead.link || lead.snippet);
}

export function filterValidLeads(leads) {
  return leads.filter(isValidLead);
}

export function extractLeads(geminiResponse, searchPrompt) {
  return extractLeadsFromResponses([geminiResponse], searchPrompt);
}

// Backwards-compatible alias.
export function mergeResolvedLinks(leads, resolverResults) {
  const normalized = (resolverResults ?? []).map((entry) =>
    entry?.response ? entry : { lead: null, response: entry },
  );
  return applyResolvedLinks(leads, normalized);
}
