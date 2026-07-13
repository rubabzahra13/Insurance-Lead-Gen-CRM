import { enrichLeadFromRawItem } from './enrich-lead.js';
import { vetLocationEcho } from './location.js';
import { normalizeLlmResponse } from './llm-response.js';
import { asLeadArray, parseJsonFromText } from './parse-json.js';
import { rawSearchCorpus } from './raw-search.js';
import { linkedinSlugFromUrl, normalizeProfileUrl, normalizePersonName } from './utils.js';

function corpusText(items, extraText = '') {
  return `${rawSearchCorpus(items)}\n\n${extraText}`.trim();
}

function linkInCorpus(link, items) {
  if (!link) return true;
  const normalized = normalizeProfileUrl(link);
  if (!normalized) return false;
  const haystack = corpusText(items).toLowerCase();
  return haystack.includes(normalized.toLowerCase());
}

export function parseStructuredLeads(structureResponse, rawItems, searchPrompt) {
  const { text } = normalizeLlmResponse(structureResponse);
  const parsed = asLeadArray(parseJsonFromText(text));
  const leads = [];

  for (const raw of parsed) {
    const name = raw?.name?.trim();
    if (!name) continue;

    const link = normalizeProfileUrl(raw?.link);
    const evidence = raw?.evidence?.trim() || null;

    if (link && !linkInCorpus(link, rawItems)) continue;

    const location = vetLocationEcho(
      raw?.location?.trim() || null,
      searchPrompt,
      rawItems,
      evidence ?? raw?.snippet ?? '',
    );

    leads.push(
      enrichLeadFromRawItem(
        {
          name,
          title: raw?.title?.trim() || null,
          company: raw?.company?.trim() || null,
          location,
          link: link ?? null,
          linkSlug: link ? linkedinSlugFromUrl(link) : null,
          linkSource: link ? 'structured' : null,
          snippet: raw?.snippet?.trim() || null,
          evidence,
          source: 'llm_structured',
          searchPrompt,
          scrapedAt: new Date().toISOString(),
        },
        rawItems,
        searchPrompt,
      ),
    );
  }

  const byName = new Map();
  for (const lead of leads) {
    const key = normalizePersonName(lead.name);
    if (!byName.has(key)) byName.set(key, lead);
  }

  return [...byName.values()];
}
