/**
 * Client-side API response cache (in-memory + sessionStorage).
 * Mirrors the old LeadScout leads-cache pattern so tab switches
 * can render immediately without a full loading flash.
 */

const SESSION_PREFIX = 'insurelead:api:';
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** Stable cache keys used across dashboard pages. */
export const API_CACHE_KEYS = {
  avatar12Leads: 'avatar12:leads',
  avatar3Leads: 'avatar3:leads',
  funnel: 'dashboard:funnel',
};

export function avatar3LeadDetailKey(leadId) {
  return `avatar3:lead:${leadId}`;
}

export function avatar3SearchKey(query) {
  // v2: search results include photo_name for result-card images
  return `avatar3:search:v2:${String(query || '').trim().toLowerCase()}`;
}

const memory = new Map();

function readSession(key) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(`${SESSION_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || Date.now() - parsed.at > (parsed.ttl ?? DEFAULT_TTL_MS)) {
      sessionStorage.removeItem(`${SESSION_PREFIX}${key}`);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function writeSession(key, data, ttlMs = DEFAULT_TTL_MS) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      `${SESSION_PREFIX}${key}`,
      JSON.stringify({ at: Date.now(), ttl: ttlMs, data })
    );
  } catch {
    /* quota / private mode */
  }
}

export function getApiCache(key) {
  if (memory.has(key)) return memory.get(key);
  const fromSession = readSession(key);
  if (fromSession != null) {
    memory.set(key, fromSession);
  }
  return fromSession;
}

export function setApiCache(key, data, ttlMs = DEFAULT_TTL_MS) {
  memory.set(key, data);
  writeSession(key, data, ttlMs);
  return data;
}

export function invalidateApiCache(keys) {
  const list = keys == null
    ? Object.values(API_CACHE_KEYS)
    : Array.isArray(keys)
      ? keys
      : [keys];

  for (const key of list) {
    memory.delete(key);
    if (typeof window === 'undefined') continue;
    try {
      sessionStorage.removeItem(`${SESSION_PREFIX}${key}`);
    } catch {
      /* ignore */
    }
  }
}

export function clearAllApiCache() {
  memory.clear();
  if (typeof window === 'undefined') return;
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(SESSION_PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Fetch JSON with optional cache. Returns cached data immediately when available
 * unless `force` is true. Always revalidates in the network path and refreshes cache.
 */
export async function fetchCachedJson(url, { cacheKey, force = false, ttlMs = DEFAULT_TTL_MS } = {}) {
  if (!force && cacheKey) {
    const hit = getApiCache(cacheKey);
    if (hit != null) {
      return { data: hit, fromCache: true };
    }
  }

  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  if (cacheKey) setApiCache(cacheKey, data, ttlMs);
  return { data, fromCache: false };
}
