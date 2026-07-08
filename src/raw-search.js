import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveOutputDir } from './output-dir.js';
import { normalizeLlmResponse } from './llm-response.js';

function pickDescription(...values) {
  const cleaned = values.map((v) => v?.trim()).filter(Boolean);
  if (cleaned.length === 0) return '';
  return cleaned.sort((a, b) => b.length - a.length)[0];
}

export function collectRawFromResponse(response) {
  const { text, groundingChunks } = normalizeLlmResponse(response);
  const byUrl = new Map();

  for (const chunk of groundingChunks) {
    const url = chunk.uri ?? '';
    const key = url || `title:${chunk.title}`;
    const snippet = chunk.citedText?.trim() ?? '';
    const existing = byUrl.get(key);

    if (existing) {
      existing.snippet = pickDescription(existing.snippet, snippet);
      if (chunk.title && (!existing.title || existing.title === 'model_summary')) {
        existing.title = chunk.title;
      }
      continue;
    }

    byUrl.set(key, {
      title: chunk.title ?? '',
      url,
      snippet,
    });
  }

  const items = [...byUrl.values()].map((item, index) => ({
    id: index + 1,
    title: item.title,
    url: item.url,
    snippet: item.snippet,
  }));

  if (text?.trim()) {
    items.push({
      id: items.length + 1,
      title: 'model_research_notes',
      url: '',
      snippet: text.trim(),
    });
  }

  if (items.length === 0) {
    items.push({
      id: 1,
      title: 'model_summary',
      url: '',
      snippet: text?.trim() ?? '',
    });
  }

  return items;
}

export function consolidateRawItems(items) {
  const profiles = items.filter((item) => item.title !== 'model_research_notes');
  const notes = items
    .filter((item) => item.title === 'model_research_notes')
    .sort((a, b) => (b.snippet?.length ?? 0) - (a.snippet?.length ?? 0));
  const merged = [...profiles];
  if (notes[0]?.snippet?.trim()) {
    merged.push({
      title: 'model_research_notes',
      url: '',
      snippet: notes[0].snippet,
    });
  }
  return merged.map((item, index) => ({ ...item, id: index + 1 }));
}

export function researchNotesLength(rawItems) {
  return rawItems.find((item) => item.title === 'model_research_notes')?.snippet?.trim().length ?? 0;
}

export function collectRawFromResponses(responses) {
  const merged = [];
  const seen = new Set();

  for (const response of responses) {
    for (const item of collectRawFromResponse(response)) {
      const key = `${item.url}|${item.title}|${item.snippet?.slice(0, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...item, id: merged.length + 1 });
    }
  }

  return consolidateRawItems(merged);
}

export function rawSearchCorpus(items) {
  return items
    .map((item) => {
      if (item.title === 'model_research_notes') {
        return `[${item.id}] research_notes:\n${item.snippet}`;
      }
      return `[${item.id}] title: ${item.title}\nurl: ${item.url}\ndescription: ${item.snippet}`;
    })
    .join('\n\n');
}

export function saveRawSearchResults(items, searchPrompt) {
  if (process.env.SAVE_RAW_SEARCH === 'false') return null;

  try {
    const dir = resolveOutputDir();
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeQuery = searchPrompt.replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
    const filePath = join(dir, `raw-search-${safeQuery}-${stamp}.json`);

    writeFileSync(
      filePath,
      JSON.stringify({ searchPrompt, capturedAt: new Date().toISOString(), items }, null, 2),
    );

    return filePath;
  } catch (error) {
    if (process.env.QUIET !== 'true') {
      console.warn(`Could not save raw search results: ${error.message}`);
    }
    return null;
  }
}
