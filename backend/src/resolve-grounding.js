import { normalizeLlmResponse } from './llm-response.js';
import {
  linkedinSlugFromUrl,
  mapWithConcurrency,
  normalizeProfileUrl,
  slugMatchesName,
} from './utils.js';

// Search grounding chunks carry URLs from the search index. Gemini uses redirect
// URLs; Claude returns direct URLs. Both are resolved to real profile links in code.

export function collectGroundingChunks(responses) {
  const chunks = [];
  for (const response of responses) {
    const { groundingChunks } = normalizeLlmResponse(response);
    for (const chunk of groundingChunks) {
      if (chunk.uri) {
        chunks.push({
          title: chunk.title ?? '',
          uri: chunk.uri,
          directUrl: Boolean(chunk.directUrl),
        });
      }
    }
  }
  return chunks;
}

async function followRedirect(uri, timeoutMs) {
  const response = await fetch(uri, {
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });

  const location = response.headers.get('location');
  if (location) return location;

  // Some redirect endpoints return an HTML page instead of a Location header.
  if ((response.headers.get('content-type') ?? '').includes('text/html')) {
    const body = await response.text();
    const match =
      body.match(/http-equiv=["']refresh["'][^>]*url=([^"'>]+)/i) ??
      body.match(/href=["'](https?:\/\/(?:[a-z]+\.)?linkedin\.com\/in\/[^"']+)["']/i);
    return match?.[1] ?? null;
  }

  return null;
}

export async function resolveGroundingRedirects(responses, options = {}) {
  const concurrency = Number(options.concurrency ?? process.env.GROUNDING_RESOLVE_CONCURRENCY ?? 4);
  const timeoutMs = Number(options.timeoutMs ?? process.env.GROUNDING_RESOLVE_TIMEOUT_MS ?? 6000);

  const chunks = collectGroundingChunks(responses);
  const unique = [...new Map(chunks.map((chunk) => [chunk.uri, chunk])).values()];

  const resolved = await mapWithConcurrency(unique, concurrency, async (chunk) => {
    if (chunk.directUrl) {
      return { ...chunk, realUrl: chunk.uri };
    }

    try {
      const realUrl = await followRedirect(chunk.uri, timeoutMs);
      return { ...chunk, realUrl };
    } catch {
      return { ...chunk, realUrl: null };
    }
  });

  return resolved.filter((chunk) => chunk.realUrl);
}

// Assign real (Google-indexed) LinkedIn profile URLs to leads by name match.
// These override model-written links, which can be hallucinated.
export function applyGroundingProfileLinks(leads, groundingLinks) {
  const profiles = groundingLinks
    .map((chunk) => ({ ...chunk, profileUrl: normalizeProfileUrl(chunk.realUrl) }))
    .filter((chunk) => chunk.profileUrl);

  if (profiles.length === 0) return leads;

  return leads.map((lead) => {
    if (!lead.name) return lead;

    let best = null;
    let bestScore = 0;
    for (const profile of profiles) {
      const score = slugMatchesName(linkedinSlugFromUrl(profile.profileUrl), lead.name);
      if (score > bestScore) {
        best = profile;
        bestScore = score;
      }
    }

    if (!best || bestScore < 0.6) return lead;

    return {
      ...lead,
      link: best.profileUrl,
      linkSlug: linkedinSlugFromUrl(best.profileUrl),
      linkSource: 'grounding',
    };
  });
}
