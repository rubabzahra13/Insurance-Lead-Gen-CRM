import { buildBootstrapParams, buildLeadsQueryParams } from './leads-query.js';
import { normalizeLead } from './lead-utils.js';

export { buildBootstrapParams as buildDeskParams };

const SESSION_PREFIX = 'leadscout:desk:';
const LEADS_PREFIX = 'leadscout:leads:';
const SESSION_TTL_MS = 5 * 60 * 1000;
export const DESK_FRESH_MS = 60_000;

const deskCache = new Map();
const leadsCache = new Map();

export function buildDeskCacheKey({ view, filters, sort, page, limit }) {
  const offset = (page - 1) * limit;
  return JSON.stringify(buildBootstrapParams({ view, filters, sort, limit, offset }));
}

export function buildLeadsListCacheKey({ view, filters, sort, page, limit }) {
  const offset = (page - 1) * limit;
  return JSON.stringify(buildLeadsQueryParams({ view, filters, sort, limit, offset }));
}

export function buildFacetsCacheKey({ view, filters }) {
  return JSON.stringify(buildLeadsQueryParams({ view, filters, limit: 1, offset: 0 }));
}

const facetsCache = new Map();

function readSession(prefix, key) {
  try {
    const raw = sessionStorage.getItem(`${prefix}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || Date.now() - parsed.at > SESSION_TTL_MS) {
      sessionStorage.removeItem(`${prefix}${key}`);
      return null;
    }
    return { data: parsed.data, at: parsed.at };
  } catch {
    return null;
  }
}

function writeSession(prefix, key, data) {
  try {
    sessionStorage.setItem(prefix + key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* quota */
  }
}

function getEntry(store, prefix, key) {
  const mem = store.get(key);
  if (mem) return mem;
  return readSession(prefix, key);
}

export function isCacheFresh(entry, maxAgeMs = DESK_FRESH_MS) {
  return Boolean(entry && Date.now() - entry.at < maxAgeMs);
}

export function getDeskCacheEntry(key) {
  return getEntry(deskCache, SESSION_PREFIX, key);
}

export function getDeskCache(key) {
  return getDeskCacheEntry(key)?.data ?? null;
}

export function setDeskCache(key, data) {
  const entry = { data, at: Date.now() };
  deskCache.set(key, entry);
  writeSession(SESSION_PREFIX, key, data);
}

export function getLeadsListCacheEntry(key) {
  return getEntry(leadsCache, LEADS_PREFIX, key);
}

export function getLeadsListCache(key) {
  return getLeadsListCacheEntry(key)?.data ?? null;
}

function leadsListKeyHasRunFilter(key) {
  try {
    const parsed = JSON.parse(key);
    return Boolean(parsed?.runId);
  } catch {
    return key.includes('"runId"');
  }
}

/** Avoid pinning empty run-filtered lists while a search is still importing. */
export function setLeadsListCache(key, data) {
  if (leadsListKeyHasRunFilter(key) && (data?.total ?? 0) === 0 && (data?.leads?.length ?? 0) === 0) {
    removeCacheEntry(leadsCache, LEADS_PREFIX, key);
    return;
  }
  const entry = { data, at: Date.now() };
  leadsCache.set(key, entry);
  writeSession(LEADS_PREFIX, key, data);
}

export function getFacetsCacheEntry(key) {
  return getEntry(facetsCache, SESSION_PREFIX + 'facets:', key);
}

export function getFacetsCache(key) {
  return getFacetsCacheEntry(key)?.data ?? null;
}

export function setFacetsCache(key, data) {
  const entry = { data, at: Date.now() };
  facetsCache.set(key, entry);
  writeSession(SESSION_PREFIX + 'facets:', key, data);
}

function removeCacheEntry(store, prefix, key) {
  store.delete(key);
  try {
    sessionStorage.removeItem(`${prefix}${key}`);
  } catch {
    /* ignore */
  }
}

/** Drop full desk snapshots (shell + leads bundled). Keeps per-run prefetched lead lists. */
export function invalidateDeskSnapshots() {
  deskCache.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(SESSION_PREFIX) && !k.startsWith(`${SESSION_PREFIX}facets:`)) {
        sessionStorage.removeItem(k);
      }
    }
  } catch {
    /* ignore */
  }
}

export function invalidateLeadsListCacheKey(key) {
  removeCacheEntry(leadsCache, LEADS_PREFIX, key);
}

export function invalidateFacetsCacheKey(key) {
  removeCacheEntry(facetsCache, SESSION_PREFIX + 'facets:', key);
}

/**
 * After a search finishes, invalidate only list/shell entries that may be stale.
 * Prefetched lead lists for other recent searches stay cached.
 */
export function invalidateAfterSearch({ view, filters, sort, runId, page = 1, limit = 50 }) {
  invalidateDeskSnapshots();

  const emptyFilters = { q: '', company: '', location: '', title: '', tag: '', runId: '' };
  const activeSort = sort ?? { field: 'updated_at', order: 'desc' };
  const leadKeys = new Set([
    buildLeadsListCacheKey({ view, filters, sort: activeSort, page, limit }),
    buildLeadsListCacheKey({
      view,
      filters: { ...filters, runId: runId ?? filters.runId },
      sort: activeSort,
      page,
      limit,
    }),
    buildLeadsListCacheKey({ view: 'all', filters: emptyFilters, sort: activeSort, page, limit }),
    buildLeadsListCacheKey({ view: 'new', filters: emptyFilters, sort: activeSort, page, limit }),
  ]);

  if (runId) {
    leadKeys.add(
      buildLeadsListCacheKey({
        view: 'all',
        filters: { ...emptyFilters, runId },
        sort: activeSort,
        page,
        limit,
      }),
    );
  }

  for (const key of leadKeys) invalidateLeadsListCacheKey(key);

  const facetKeys = new Set([
    buildFacetsCacheKey({ view, filters }),
    buildFacetsCacheKey({ view, filters: { ...filters, runId: runId ?? filters.runId } }),
    buildFacetsCacheKey({ view: 'all', filters: emptyFilters }),
  ]);
  for (const key of facetKeys) invalidateFacetsCacheKey(key);
}

export function invalidateDeskCache() {
  deskCache.clear();
  leadsCache.clear();
  facetsCache.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(SESSION_PREFIX) || k?.startsWith(LEADS_PREFIX)) {
        sessionStorage.removeItem(k);
      }
    }
  } catch {
    /* ignore */
  }
}

export function applyDeskSnapshot(snapshot, view) {
  return {
    dashboard: { stats: snapshot.stats, recentRuns: snapshot.recentRuns ?? [] },
    facets: snapshot.facets ?? { companies: [], locations: [], titles: [], tags: [] },
    savedViews: snapshot.savedViews ?? [],
    leadsData:
      view === 'review'
        ? null
        : {
            leads: (snapshot.leads ?? []).map(normalizeLead),
            total: snapshot.leadsTotal ?? 0,
          },
    duplicates: view === 'review' ? (snapshot.duplicates ?? []) : null,
  };
}
