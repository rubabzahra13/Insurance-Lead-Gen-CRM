const CACHE_TTL_MS = 90_000;
const MAX_ENTRIES = 64;
const cache = new Map();

export function getCached(key, ttlMs = CACHE_TTL_MS) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttlMs) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

export function setCached(key, data, tags = []) {
  cache.set(key, { data, at: Date.now(), tags });
  if (cache.size > MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
    if (oldest) cache.delete(oldest);
  }
}

export function invalidateCache(prefix) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function invalidateTags(...tags) {
  const tagSet = new Set(tags);
  for (const [key, entry] of cache.entries()) {
    if (entry.tags?.some((tag) => tagSet.has(tag))) {
      cache.delete(key);
    }
  }
}
