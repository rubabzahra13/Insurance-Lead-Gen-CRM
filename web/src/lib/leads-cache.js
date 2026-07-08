import { buildBootstrapParams, buildLeadsQueryParams } from './leads-query.js';

const SESSION_PREFIX = 'leadscout:leads:';
const SESSION_TTL_MS = 5 * 60 * 1000;

const bootstrapCache = new Map();
const leadsCache = new Map();

export function buildCacheKey({ view, filters, page, limit }) {
  const offset = (page - 1) * limit;
  return JSON.stringify(
    buildBootstrapParams({ view, filters, limit, offset }),
  );
}

export function buildLeadsOnlyCacheKey({ view, filters, page, limit }) {
  const offset = (page - 1) * limit;
  return JSON.stringify(
    buildLeadsQueryParams({ view, filters, limit, offset }),
  );
}

function readSession(key) {
  try {
    const raw = sessionStorage.getItem(`${SESSION_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || Date.now() - parsed.at > SESSION_TTL_MS) {
      sessionStorage.removeItem(`${SESSION_PREFIX}${key}`);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function writeSession(key, data) {
  try {
    sessionStorage.setItem(`${SESSION_PREFIX}${key}`, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* quota */
  }
}

export function getBootstrapCache(key) {
  return bootstrapCache.get(key) ?? readSession(key);
}

export function setBootstrapCache(key, data) {
  bootstrapCache.set(key, data);
  writeSession(key, data);
}

export function getLeadsCache(key) {
  return leadsCache.get(key) ?? readSession(key);
}

export function setLeadsCache(key, data) {
  leadsCache.set(key, data);
  writeSession(key, data);
}

export function invalidateLeadsCache() {
  bootstrapCache.clear();
  leadsCache.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(SESSION_PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}
