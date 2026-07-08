// Light guardrail: reject locations that look copied from the search query, not the results.

export function vetLocationEcho(location, searchPrompt, rawItems, evidence = '') {
  if (!location?.trim()) return null;

  const trimmed = location.trim();
  const city = trimmed.split(',')[0].trim().toLowerCase();
  if (!city || city.length < 3) return trimmed;

  const queryLower = (searchPrompt ?? '').toLowerCase();
  if (!queryLower.includes(city)) return trimmed;

  const corpus = rawItems
    .map((item) => `${item.title ?? ''} ${item.snippet ?? ''}`)
    .join(' ')
    .toLowerCase();
  const support = `${corpus} ${evidence ?? ''}`.toLowerCase();

  // Accept if city or any significant token from the location appears in results
  if (support.includes(city)) return trimmed;
  const tokens = city.split(/\s+/).filter((t) => t.length >= 4);
  if (tokens.some((token) => support.includes(token))) return trimmed;

  return null;
}
