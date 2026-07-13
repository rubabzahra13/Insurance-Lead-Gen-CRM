export function parseSearchPrompt(input) {
  return input.replace(/^scrape\s+linkedin\s+/i, '').trim();
}

export function normalizeProfileUrl(url) {
  if (!url || !url.includes('linkedin.com/in')) return null;
  try {
    const parsed = new URL(url);
    return `https://www.linkedin.com${parsed.pathname.replace(/\/$/, '')}`;
  } catch {
    return url.split('?')[0].replace(/\/$/, '');
  }
}

export function linkedinSlugFromUrl(url) {
  const normalized = normalizeProfileUrl(url);
  if (!normalized) return null;
  const match = normalized.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function normalizePersonName(name) {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function personIdentityKey(lead) {
  const name = normalizePersonName(lead.name);
  const company = (lead.company ?? '')
    .toLowerCase()
    .split(/[\s,(-]+/)[0]
    .replace(/[^a-z0-9]/g, '');
  return `${name}|${company}`;
}

export function slugMatchesName(slug, name) {
  if (!slug || !name) return 0;

  const slugNorm = slug.toLowerCase().replace(/-/g, '');
  const tokens = normalizePersonName(name)
    .split(' ')
    .filter((token) => token.length > 2);

  if (tokens.length === 0) return 0;

  const matched = tokens.filter((token) => slugNorm.includes(token)).length;
  return matched / tokens.length;
}

export function looksLikeDomain(value) {
  return /^[\w.-]+\.[a-z]{2,}$/i.test((value ?? '').trim());
}

export async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current], current);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return results;
}
