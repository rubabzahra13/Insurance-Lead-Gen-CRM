// Fast Google retrieval via SerpApi (serpapi.com) or Serper (serper.dev).
// Replaces Claude's slow built-in web search for the experimental engine:
// we fetch all avatar search lanes in parallel (~1s each) and hand the raw
// snippets to the existing structuring stage. Same pipeline downstream.

import { toSerpApiLocation } from './location-resolver.js';

function serpConfig() {
  const serpapiKey = (process.env.SERPAPI_KEY ?? process.env.SERP_API)?.trim();
  const serperKey = process.env.SERPER_API_KEY?.trim();
  if (serpapiKey) return { provider: 'serpapi', key: serpapiKey };
  if (serperKey) return { provider: 'serper', key: serperKey };
  return null;
}

export function serpAvailable() {
  return serpConfig() !== null;
}

function timeoutMs() {
  return Number(process.env.SERP_TIMEOUT_MS ?? 15_000);
}

/** Flatten a SerpApi rich_snippet into its extension strings (top + bottom). */
function richSnippetExtensions(richSnippet) {
  const groups = [richSnippet?.top, richSnippet?.bottom];
  const values = groups.flatMap((group) => group?.extensions ?? []);
  return values.filter((value) => typeof value === 'string' && value.trim()).map((v) => v.trim());
}

// One Google query -> array of { title, link, snippet, extensions }.
// `geo` is optional: { gl, serpLocation } from extractQueryLocation.
export async function runOneSearch(query, num, geo = null) {
  const config = serpConfig();
  if (!config) throw new Error('No SERPAPI_KEY or SERPER_API_KEY set in .env');

  const gl = geo?.gl || null;
  const location = toSerpApiLocation(geo?.serpLocation || geo?.location || null);

  if (config.provider === 'serpapi') {
    let url =
      `https://serpapi.com/search.json?engine=google` +
      `&q=${encodeURIComponent(query)}&num=${num}&api_key=${config.key}`;
    if (gl) url += `&gl=${encodeURIComponent(gl)}`;
    if (location) url += `&location=${encodeURIComponent(location)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs()) });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`SerpApi error ${res.status}: ${body.slice(0, 160)}`);
    }
    const data = await res.json();
    if (data.error) throw new Error(`SerpApi: ${data.error}`);
    return (data.organic_results ?? []).map((r) => ({
      title: r.title ?? '',
      link: r.link ?? '',
      snippet: r.snippet ?? '',
      // Google surfaces LinkedIn's own profile card as rich-snippet extensions
      // ("Mount Dora, Florida, United States", "Server", "Seasons 52 Restaurant").
      // These are authoritative, so keep them instead of re-deriving the same
      // fields from the truncated snippet prose.
      extensions: richSnippetExtensions(r.rich_snippet),
    }));
  }

  // serper.dev
  const body = { q: query, num };
  if (gl) body.gl = gl;
  if (location) body.location = location;
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': config.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs()),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Serper error ${res.status}: ${errBody.slice(0, 160)}`);
  }
  const data = await res.json();
  return (data.organic ?? []).map((r) => ({
    title: r.title ?? '',
    link: r.link ?? '',
    snippet: r.snippet ?? '',
  }));
}

// Run several lanes in parallel. Each lane: { query, num, note } where `note`
// is attached to every result as lane context (e.g. company-size evidence for
// avatar 2's hop-2 people). Returns a flat list of results with lane info.
export async function runSerpLanes(lanes, { onLane, geo } = {}) {
  const settled = await Promise.allSettled(
    lanes.map(async (lane) => {
      const results = await runOneSearch(lane.query, lane.num ?? 20, geo);
      onLane?.({ query: lane.query, count: results.length });
      return results.map((r) => ({ ...r, laneNote: lane.note ?? null }));
    }),
  );

  const out = [];
  for (const entry of settled) {
    if (entry.status === 'fulfilled') out.push(...entry.value);
  }
  return out;
}

// Convert SerpApi results into the pipeline's rawItems shape:
// { id, title, url, snippet } plus a consolidated model_research_notes item so
// the structuring prompt has the grey snippet text it expects.
export function serpResultsToRawItems(results) {
  const byLink = new Map();
  for (const r of results) {
    if (!r.link) continue;
    const existing = byLink.get(r.link);
    // Fold the lane note into the snippet so fit-evidence survives structuring.
    const snippet = r.laneNote ? `${r.snippet} [${r.laneNote}]` : r.snippet;
    if (existing) {
      if (snippet.length > existing.snippet.length) existing.snippet = snippet;
      // A lane that returned the profile card wins over one that did not.
      if (!existing.extensions?.length && r.extensions?.length) existing.extensions = r.extensions;
      continue;
    }
    byLink.set(r.link, { title: r.title, url: r.link, snippet, extensions: r.extensions ?? [] });
  }

  const items = [...byLink.values()].map((item, index) => ({
    id: index + 1,
    title: item.title,
    url: item.url,
    snippet: item.snippet,
    extensions: item.extensions ?? [],
  }));

  const notes = items
    .map((item) => `- ${item.title} — ${item.snippet} (${item.url})`)
    .join('\n');

  items.push({
    id: items.length + 1,
    title: 'model_research_notes',
    url: '',
    snippet: `Google results (via SERP API):\n${notes}`,
  });

  return items;
}
