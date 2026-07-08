import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  bulkLeadsAction,
  bulkLeadsByFilter,
  createSavedView,
  deleteLead,
  deleteSavedView,
  fetchDashboard,
  fetchDesk,
  fetchLeadFacets,
  fetchLeads,
  resolveDuplicate,
  updateLead,
} from '../lib/api.js';
import { buildDeskParams, buildFacetQueryParams, buildLeadsQueryParams, pageRange } from '../lib/leads-query.js';
import {
  applyDeskSnapshot,
  buildDeskCacheKey,
  buildFacetsCacheKey,
  buildLeadsListCacheKey,
  DESK_FRESH_MS,
  getDeskCache,
  getDeskCacheEntry,
  getFacetsCacheEntry,
  getLeadsListCacheEntry,
  invalidateAfterSearch,
  invalidateDeskCache,
  invalidateLeadsListCacheKey,
  isCacheFresh,
  setDeskCache,
  setFacetsCache,
  setLeadsListCache,
} from '../lib/desk-cache.js';
import { mergeDeskLeads } from '../lib/lead-filters.js';
import { filterPipelineLeadsForDesk } from '../lib/pipeline-leads.js';
import { isPersistedLead, normalizeLead, normalizeLeadId, sameLeadId } from '../lib/lead-utils.js';
import { isLeadsRoute, viewFromPath } from '../lib/desk-routes.js';
import { defaultSortForView, sortFromValue, sortToValue } from '../lib/lead-sort.js';
import ConfirmDialog from '../components/desk/ConfirmDialog.jsx';

const PAGE_SIZE = 50;

const DeskContext = createContext(null);

function listKey(view, filters, sort) {
  return JSON.stringify({ view, filters, sort });
}

function initialDeskState(view, filters, sort) {
  const cached = getDeskCache(
    buildDeskCacheKey({ view, filters, sort, page: 1, limit: PAGE_SIZE }),
  );
  if (!cached) {
    return {
      dashboard: null,
      facets: { companies: [], locations: [], tags: [] },
      savedViews: [],
      leadsData: { leads: [], total: 0 },
      duplicates: [],
    };
  }
  const applied = applyDeskSnapshot(cached, view);
  return {
    dashboard: applied.dashboard,
    facets: applied.facets,
    savedViews: applied.savedViews,
    leadsData: applied.leadsData ?? { leads: [], total: 0 },
    duplicates: applied.duplicates ?? [],
  };
}

export function DeskProvider({ children }) {
  const { pathname } = useLocation();
  const view = viewFromPath(pathname) ?? 'all';
  const onLeadsPage = isLeadsRoute(pathname);

  const [filters, setFilters] = useState({
    q: '',
    company: '',
    location: '',
    title: '',
    tag: '',
    runId: '',
  });
  const [sort, setSort] = useState(() => defaultSortForView(view));
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);

  const boot = initialDeskState(view, filters, sort);
  const [leadsData, setLeadsData] = useState(boot.leadsData);
  const [facets, setFacets] = useState(boot.facets);
  const [savedViews, setSavedViews] = useState(boot.savedViews);
  const [dashboard, setDashboard] = useState(boot.dashboard);
  const [duplicates, setDuplicates] = useState(boot.duplicates);
  const [selectedLead, setSelectedLead] = useState(null);
  const [selectedReview, setSelectedReview] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectionScope, setSelectionScope] = useState('none');
  const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(!boot.dashboard);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [highlightRun, setHighlightRun] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);

  const filterSnapshotRef = useRef(listKey(view, filters, sort));
  const hasShownDataRef = useRef(Boolean(boot.dashboard));
  const inFlightShellRef = useRef(null);
  const forcedRunRefreshRef = useRef(null);
  const prevViewRef = useRef(view);
  const reviewInspectorDismissedRef = useRef(false);

  const prefetchRecentSearchLeads = useCallback((recentRuns) => {
    const emptyFilters = { q: '', company: '', location: '', title: '', tag: '', runId: '' };
    for (const run of recentRuns.slice(0, 10)) {
      if (!run?.id || run.status === 'running') continue;
      const leadsKey = buildLeadsListCacheKey({
        view: 'all',
        filters: { ...emptyFilters, runId: run.id },
        sort: defaultSortForView('all'),
        page: 1,
        limit: PAGE_SIZE,
      });
      if (getLeadsListCacheEntry(leadsKey)) continue;

      fetchLeads(
        buildLeadsQueryParams({
          view: 'all',
          filters: { ...emptyFilters, runId: run.id },
          sort: defaultSortForView('all'),
          limit: PAGE_SIZE,
          offset: 0,
        }),
      )
        .then((data) => setLeadsListCache(leadsKey, { leads: data.leads, total: data.total }))
        .catch(() => {});
    }
  }, []);

  const loadDeskShell = useCallback(
    async ({ force = false } = {}) => {
      if (!force && inFlightShellRef.current) {
        try {
          await inFlightShellRef.current;
        } catch {
          /* ignore */
        }
        return;
      }

      const request = fetchDashboard({ bust: force });
      inFlightShellRef.current = request;

      try {
        const dash = await request;
        if (inFlightShellRef.current !== request) return;
        setDashboard({ stats: dash.stats, recentRuns: dash.recentRuns ?? [] });
        prefetchRecentSearchLeads(dash.recentRuns ?? []);
      } catch (err) {
        console.error(err);
      } finally {
        if (inFlightShellRef.current === request) {
          inFlightShellRef.current = null;
        }
      }
    },
    [prefetchRecentSearchLeads],
  );

  const warmRunLeadsList = useCallback(
    async (runFilters) => {
      if (!runFilters?.runId) return null;

      const leadsKey = buildLeadsListCacheKey({
        view: 'all',
        filters: runFilters,
        sort,
        page: 1,
        limit: PAGE_SIZE,
      });
      invalidateLeadsListCacheKey(leadsKey);

      try {
        const data = await fetchLeads(
          buildLeadsQueryParams({
            view: 'all',
            filters: runFilters,
            sort,
            limit: PAGE_SIZE,
            offset: 0,
          }),
          { retries: 2 },
        );
        setLeadsListCache(leadsKey, {
          leads: (data.leads ?? []).map(normalizeLead),
          total: data.total,
        });
        setLeadsData({
          leads: (data.leads ?? []).map(normalizeLead),
          total: data.total,
        });
        return data;
      } catch (err) {
        console.error(err);
        return null;
      }
    },
    [sort],
  );

  const handleSortChange = useCallback((value) => {
    setSort(sortFromValue(value));
    setPage(1);
    setSelectedLead(null);
    setSelectedIds(new Set());
    setSelectionScope('none');
  }, []);

  const applySnapshot = useCallback(
    (snapshot) => {
      const applied = applyDeskSnapshot(snapshot, view);
      setDashboard(applied.dashboard);
      if (applied.facets) {
        setFacets(applied.facets);
        setFacetsCache(buildFacetsCacheKey({ view, filters }), applied.facets);
      }
      setSavedViews(applied.savedViews);
      if (view === 'review') {
        setDuplicates(applied.duplicates ?? []);
      } else if (applied.leadsData) {
        setLeadsData(applied.leadsData);
      }
    },
    [view, filters],
  );

  const refreshDesk = useCallback(
    async ({ pageOverride, silent = false, force = false, filtersOverride } = {}) => {
      const activeFilters = filtersOverride ?? filters;
      const effectivePage = pageOverride ?? page;
      const effectiveOffset = (effectivePage - 1) * PAGE_SIZE;
      const shellReady = Boolean(dashboard?.stats);

      if (!silent) setLoadError(null);

      // Review queue uses the full desk payload (duplicates).
      if (view === 'review') {
        const cacheKey = buildDeskCacheKey({
          view,
          filters: activeFilters,
          sort,
          page: effectivePage,
          limit: PAGE_SIZE,
        });
        const cachedEntry = getDeskCacheEntry(cacheKey);

        if (cachedEntry && !force) {
          applySnapshot(cachedEntry.data);
          setLoading(false);
          hasShownDataRef.current = true;
          if (isCacheFresh(cachedEntry, DESK_FRESH_MS)) return;
          if (!silent) setRefreshing(true);
        } else if (!silent) {
          if (!hasShownDataRef.current) setLoading(true);
          else setRefreshing(true);
        }

        try {
          const data = await fetchDesk(
            buildDeskParams({
              view,
              filters: activeFilters,
              sort,
              limit: PAGE_SIZE,
              offset: effectiveOffset,
            }),
            { retries: 2 },
          );
          setDeskCache(cacheKey, data);
          applySnapshot(data);
          await loadDeskShell({ force: force || Boolean(cachedEntry) });
          hasShownDataRef.current = true;
        } catch (err) {
          if (!cachedEntry && !silent) setLoadError(err.message ?? 'Failed to load reviews');
        } finally {
          setLoading(false);
          setRefreshing(false);
        }
        return;
      }

      // Shell already loaded: fetch lead list + filter facets in parallel.
      if (shellReady) {
        const leadsKey = buildLeadsListCacheKey({
          view,
          filters: activeFilters,
          sort,
          page: effectivePage,
          limit: PAGE_SIZE,
        });
        const facetKey = buildFacetsCacheKey({ view, filters: activeFilters });
        const leadsCached = force ? null : getLeadsListCacheEntry(leadsKey);
        const facetsCached = force ? null : getFacetsCacheEntry(facetKey);
        const leadsFresh = !force && isCacheFresh(leadsCached, DESK_FRESH_MS);
        const facetsFresh = !force && isCacheFresh(facetsCached, DESK_FRESH_MS);

        if (leadsCached) {
          setLeadsData({
            leads: (leadsCached.data.leads ?? []).map(normalizeLead),
            total: leadsCached.data.total ?? 0,
          });
          setLoading(false);
          setLeadsLoading(false);
          hasShownDataRef.current = true;
        }
        if (facetsCached) {
          setFacets(facetsCached.data);
        }

        if (leadsFresh && facetsFresh) return;

        if (!silent) {
          if (!leadsCached && !hasShownDataRef.current) {
            setLoading(true);
            setLeadsLoading(true);
          } else {
            setRefreshing(true);
          }
        }

        try {
          const shouldRefreshShell = force || !leadsFresh || !facetsFresh;
          const leadsPromise = leadsFresh
            ? Promise.resolve(leadsCached.data)
            : fetchLeads(
                buildLeadsQueryParams({
                  view,
                  filters: activeFilters,
                  sort,
                  limit: PAGE_SIZE,
                  offset: effectiveOffset,
                }),
                { retries: 2 },
              );
          const facetsPromise = facetsFresh
            ? Promise.resolve(facetsCached.data)
            : fetchLeadFacets(buildFacetQueryParams({ view, filters: activeFilters }));
          const shellPromise = shouldRefreshShell
            ? loadDeskShell({ force: true })
            : Promise.resolve();

          const [leadsResult, facetsResult] = await Promise.all([
            leadsPromise,
            facetsPromise,
            shellPromise,
          ]);

          if (!leadsFresh) {
            const payload = {
              leads: (leadsResult.leads ?? []).map(normalizeLead),
              total: leadsResult.total,
            };
            setLeadsListCache(leadsKey, payload);
            setLeadsData(payload);
            setSelectedLead(null);
            setSelectedIds(new Set());
            setSelectionScope('none');
            hasShownDataRef.current = true;
          }
          if (!facetsFresh) {
            setFacetsCache(facetKey, facetsResult);
            setFacets(facetsResult);
          }
        } catch (err) {
          if (!leadsCached && !silent) {
            setLoadError(err.message ?? 'Failed to load leads');
          }
        } finally {
          setLoading(false);
          setLeadsLoading(false);
          setRefreshing(false);
        }
        return;
      }

      // First visit: full desk snapshot (shell + leads + facets).
      const cacheKey = buildDeskCacheKey({
        view,
        filters: activeFilters,
        sort,
        page: effectivePage,
        limit: PAGE_SIZE,
      });
      const cachedEntry = force ? null : getDeskCacheEntry(cacheKey);

      if (cachedEntry) {
        applySnapshot(cachedEntry.data);
        setLoading(false);
        setLeadsLoading(false);
        hasShownDataRef.current = true;
        prefetchRecentSearchLeads(cachedEntry.data.recentRuns ?? []);
        if (isCacheFresh(cachedEntry, DESK_FRESH_MS)) return;
        if (!silent) setRefreshing(true);
      } else if (!silent) {
        if (!hasShownDataRef.current) {
          setLoading(true);
          setLeadsLoading(true);
        } else {
          setRefreshing(true);
        }
      }

      try {
        const data = await fetchDesk(
          buildDeskParams({
            view,
            filters: activeFilters,
            sort,
            limit: PAGE_SIZE,
            offset: effectiveOffset,
          }),
          { retries: 2 },
        );
        setDeskCache(cacheKey, data);
        applySnapshot(data);
        await loadDeskShell({ force: force || Boolean(cachedEntry) });
        prefetchRecentSearchLeads(data.recentRuns ?? []);
        setSelectedLead(null);
        setSelectedIds(new Set());
        setSelectionScope('none');
        hasShownDataRef.current = true;
      } catch (err) {
        if (!cachedEntry && !silent) {
          setLoadError(err.message ?? 'Failed to load desk');
        }
      } finally {
        setLoading(false);
        setLeadsLoading(false);
        setRefreshing(false);
      }
    },
    [view, filters, sort, page, dashboard?.stats, applySnapshot, prefetchRecentSearchLeads, loadDeskShell],
  );

  const reloadDesk = useCallback(
    async (pageOverride) => {
      invalidateDeskCache();
      await refreshDesk({ pageOverride, silent: false });
    },
    [refreshDesk],
  );

  useEffect(() => {
    if (onLeadsPage) return;
    if (dashboard) return;
    loadDeskShell().catch(console.error);
  }, [onLeadsPage, dashboard, loadDeskShell]);

  useEffect(() => {
    setSort(defaultSortForView(view));
    setPage(1);
  }, [view]);

  useEffect(() => {
    if (!onLeadsPage) {
      setLoading(false);
      return;
    }

    const currentKey = listKey(view, filters, sort);
    const filtersChanged = filterSnapshotRef.current !== currentKey;

    if (filtersChanged && page !== 1) {
      filterSnapshotRef.current = currentKey;
      setPage(1);
      setSelectedLead(null);
      setSelectedReview(null);
      setSelectedIds(new Set());
      setSelectionScope('none');
      return;
    }

    filterSnapshotRef.current = currentKey;
    refreshDesk({ pageOverride: filtersChanged || page === 1 ? 1 : page, silent: false }).catch(console.error);
  }, [onLeadsPage, view, filters, sort, page, refreshDesk]);

  useEffect(() => {
    if (!onLeadsPage || view !== 'all' || !filters.runId) return;
    if (leadsData.total > 0 || leadsData.leads.length > 0) return;
    if (loading || refreshing) return;
    if (forcedRunRefreshRef.current === filters.runId) return;

    forcedRunRefreshRef.current = filters.runId;
    refreshDesk({ pageOverride: 1, force: true, silent: true }).catch(console.error);
  }, [
    onLeadsPage,
    view,
    filters.runId,
    leadsData.total,
    leadsData.leads.length,
    loading,
    refreshing,
    refreshDesk,
  ]);

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.q === searchInput ? f : { ...f, q: searchInput }));
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (view === 'review' && prevViewRef.current !== 'review') {
      reviewInspectorDismissedRef.current = false;
    }
    if (view !== 'review') {
      reviewInspectorDismissedRef.current = false;
    }
    prevViewRef.current = view;
  }, [view]);

  useEffect(() => {
    if (view !== 'review' || duplicates.length === 0) return;
    if (reviewInspectorDismissedRef.current) return;
    if (!selectedReview) {
      setSelectedReview(duplicates[0]);
      return;
    }
    if (!duplicates.some((d) => d.id === selectedReview.id)) {
      setSelectedReview(duplicates[0]);
    }
  }, [view, duplicates, selectedReview]);

  const closeReviewInspector = useCallback(() => {
    reviewInspectorDismissedRef.current = true;
    setSelectedReview(null);
  }, []);

  const selectReview = useCallback((review) => {
    reviewInspectorDismissedRef.current = false;
    setSelectedReview(review);
  }, []);

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    setPage(1);
    setSelectedLead(null);
    setSelectedReview(null);
    setSelectedIds(new Set());
    setSelectionScope('none');
    if (view !== 'all') {
      setFilters((f) => (f.runId ? { ...f, runId: '' } : f));
    }
  }, [pathname, view]);

  const hasActiveFilters = Boolean(
    filters.q ||
      filters.company ||
      filters.location ||
      filters.title ||
      filters.tag ||
      (view === 'all' && filters.runId),
  );

  const activeRunLabel = useMemo(() => {
    if (!filters.runId) return '';
    const run = dashboard?.recentRuns?.find((r) => r.id === filters.runId);
    return run?.searchPrompt ?? highlightRun?.searchPrompt ?? 'Selected search';
  }, [filters.runId, dashboard?.recentRuns, highlightRun?.searchPrompt]);

  const pendingCount = dashboard?.stats?.pendingDuplicates ?? duplicates.length;

  const navStats = useMemo(() => {
    const base = dashboard?.stats ?? {};
    return {
      totalLeads: base.totalLeads ?? 0,
      newThisWeek: base.newThisWeek ?? 0,
      starredCount: base.starredCount ?? 0,
      pendingDuplicates: Math.max(base.pendingDuplicates ?? 0, duplicates.length),
    };
  }, [dashboard?.stats, duplicates.length]);

  const askConfirm = useCallback((options) => {
    return new Promise((resolve) => {
      setConfirmDialog({ ...options, resolve });
    });
  }, []);

  const closeConfirm = useCallback((confirmed) => {
    setConfirmDialog((current) => {
      current?.resolve?.(confirmed);
      return null;
    });
  }, []);

  const syncLeadsCache = useCallback(
    (data) => {
      const key = buildLeadsListCacheKey({ view, filters, sort, page, limit: PAGE_SIZE });
      setLeadsListCache(key, data);
    },
    [view, filters, sort, page],
  );

  const applyStarChange = useCallback(
    (ids, starred, { updateStats = true } = {}) => {
      const idSet = new Set(ids.map(normalizeLeadId).filter(Boolean));
      let delta = 0;

      setLeadsData((prev) => {
        for (const lead of prev.leads) {
          const leadId = normalizeLeadId(lead.id);
          if (leadId && idSet.has(leadId) && Boolean(lead.starred) !== starred) {
            delta += starred ? 1 : -1;
          }
        }

        let next;
        if (view === 'starred' && !starred) {
          const remaining = prev.leads.filter((l) => !idSet.has(normalizeLeadId(l.id)));
          next = {
            leads: remaining,
            total: Math.max(0, prev.total - (prev.leads.length - remaining.length)),
          };
        } else {
          next = {
            ...prev,
            leads: prev.leads.map((l) =>
              idSet.has(normalizeLeadId(l.id)) ? { ...l, starred } : l,
            ),
          };
        }

        syncLeadsCache(next);
        return next;
      });

      if (updateStats && delta !== 0) {
        setDashboard((d) =>
          d
            ? {
                ...d,
                stats: {
                  ...d.stats,
                  starredCount: Math.max(0, (d.stats?.starredCount ?? 0) + delta),
                },
              }
            : d,
        );
      }

      setSelectedLead((lead) =>
        lead && idSet.has(normalizeLeadId(lead.id)) ? { ...lead, starred } : lead,
      );
    },
    [view, syncLeadsCache],
  );

  const executeBulk = useCallback(
    async (action, exportParams) => {
      const isStarAction = action === 'star' || action === 'unstar';
      const starred = action === 'star';

      if (selectionScope === 'all') {
        if (isStarAction) {
          const pageIds = leadsData.leads.filter((l) => isPersistedLead(l)).map((l) => l.id);

          if (view === 'starred' && !starred) {
            const empty = { leads: [], total: 0 };
            setLeadsData(empty);
            syncLeadsCache(empty);
          } else {
            applyStarChange(pageIds, starred, { updateStats: false });
          }

          setSelectedIds(new Set());
          setSelectionScope('none');
          setSelectedLead(null);

          const result = await bulkLeadsByFilter(exportParams, action);
          if (result.affected) {
            setDashboard((d) =>
              d
                ? {
                    ...d,
                    stats: {
                      ...d.stats,
                      starredCount: Math.max(
                        0,
                        (d.stats?.starredCount ?? 0) +
                          (starred ? result.affected : -result.affected),
                      ),
                    },
                  }
                : d,
            );
          }
          return result;
        }

        await bulkLeadsByFilter(exportParams, action);
        invalidateDeskCache();
        setSelectedIds(new Set());
        setSelectionScope('none');
        setSelectedLead(null);
        await reloadDesk();
        return;
      }

      const ids = [...selectedIds].filter((id) => isPersistedLead({ id }));

      if (isStarAction) {
        applyStarChange(ids, starred);
        setSelectedIds(new Set());
        setSelectionScope('none');
        setSelectedLead(null);
        try {
          return await bulkLeadsAction(ids, action);
        } catch (err) {
          applyStarChange(ids, !starred);
          throw err;
        }
      }

      await bulkLeadsAction(ids, action);
      invalidateDeskCache();
      setSelectedIds(new Set());
      setSelectionScope('none');
      setSelectedLead(null);
      await reloadDesk();
    },
    [
      selectionScope,
      selectedIds,
      leadsData.leads,
      reloadDesk,
      applyStarChange,
      syncLeadsCache,
      view,
    ],
  );

  const mergeIncomingLeads = useCallback(
    (incomingLeads, runId, searchPrompt) => {
      if (!incomingLeads?.length || view === 'review') return;
      const activeFilters = runId ? { ...filters, runId } : filters;
      const filtered = filterPipelineLeadsForDesk(incomingLeads, {
        view,
        filters: activeFilters,
        runId,
        searchPrompt,
      });
      if (!filtered.length || page !== 1) return;

      let netNew = 0;
      let nextPayload = null;

      setLeadsData((prev) => {
        const prevKeys = new Set(prev.leads.map((l) => l.id ?? l.link ?? l.name));
        netNew = filtered.filter((l) => !prevKeys.has(l.id ?? l.link ?? l.name)).length;
        const merged = mergeDeskLeads(prev.leads, filtered, { prepend: true });
        nextPayload = {
          leads: merged.slice(0, PAGE_SIZE),
          total: Math.max(prev.total + netNew, merged.length),
        };
        return nextPayload;
      });

      if (nextPayload) {
        setLeadsListCache(
          buildLeadsListCacheKey({ view, filters: activeFilters, sort, page: 1, limit: PAGE_SIZE }),
          nextPayload,
        );
      }

      if (netNew > 0) {
        setDashboard((d) =>
          d
            ? {
                ...d,
                stats: {
                  ...d.stats,
                  totalLeads: (d.stats?.totalLeads ?? 0) + netNew,
                  newThisWeek: (d.stats?.newThisWeek ?? 0) + netNew,
                },
              }
            : d,
        );
      }
    },
    [view, filters, page],
  );

  const handleSearchComplete = useCallback(
    async (result, kb, searchPrompt, runId) => {
      const nextFilters = runId ? { ...filters, runId } : filters;

      if (result?.leads?.length) {
        mergeIncomingLeads(result.leads, runId, searchPrompt);
      }

      if (kb || runId) {
        if (kb) {
          setHighlightRun({
            runId,
            searchPrompt: searchPrompt ?? 'Latest search',
            leadsAdded: kb.leadsAdded,
            duplicatesFound: kb.duplicatesFound,
          });
        }
        if (runId) setFilters(nextFilters);
      }

      if (runId && kb) {
        setDashboard((d) => {
          const stats = d?.stats ?? {};
          const recentRuns = [...(d?.recentRuns ?? [])];
          const idx = recentRuns.findIndex((r) => r.id === runId);
          const prevAdded = idx >= 0 ? (recentRuns[idx]?.leadsAdded ?? 0) : 0;
          const prevDupes = idx >= 0 ? (recentRuns[idx]?.duplicatesFound ?? 0) : 0;
          const runPatch = {
            id: runId,
            searchPrompt: searchPrompt ?? 'Latest search',
            query: searchPrompt ?? 'Latest search',
            status: 'done',
            leadsAdded: kb.leadsAdded ?? 0,
            duplicatesFound: kb.duplicatesFound ?? 0,
            startedAt: idx >= 0 ? recentRuns[idx]?.startedAt : new Date().toISOString(),
          };

          if (idx >= 0) recentRuns[idx] = { ...recentRuns[idx], ...runPatch };
          else recentRuns.unshift(runPatch);

          const deltaLeads = (kb.leadsAdded ?? 0) - prevAdded;
          const deltaDupes = (kb.duplicatesFound ?? 0) - prevDupes;

          return {
            stats: {
              ...stats,
              totalLeads: Math.max(0, (stats.totalLeads ?? 0) + deltaLeads),
              newThisWeek: Math.max(0, (stats.newThisWeek ?? 0) + deltaLeads),
              totalRuns: idx < 0 ? (stats.totalRuns ?? 0) + 1 : (stats.totalRuns ?? 0),
              pendingDuplicates: Math.max(0, (stats.pendingDuplicates ?? 0) + deltaDupes),
            },
            recentRuns: recentRuns.slice(0, 8),
          };
        });
      }

      setPage(1);

      if (runId) {
        invalidateAfterSearch({ view, filters: nextFilters, sort, runId, page: 1, limit: PAGE_SIZE });

        await warmRunLeadsList(nextFilters);
        await loadDeskShell({ force: true });

        if (onLeadsPage) {
          await refreshDesk({
            pageOverride: 1,
            silent: true,
            force: true,
            filtersOverride: nextFilters,
          });
        }
      } else {
        await loadDeskShell({ force: true });
      }
    },
    [mergeIncomingLeads, refreshDesk, loadDeskShell, warmRunLeadsList, onLeadsPage, view, filters],
  );

  const value = {
    view,
    onLeadsPage,
    filters,
    searchInput,
    setSearchInput,
    page,
    setPage,
    sort,
    sortValue: sortToValue(sort),
    handleSortChange,
    leadsData,
    facets,
    savedViews,
    dashboard,
    duplicates,
    selectedLead,
    setSelectedLead,
    selectedReview,
    setSelectedReview,
    selectReview,
    closeReviewInspector,
    selectedIds,
    selectionScope,
    searchOpen,
    setSearchOpen,
    loading,
    refreshing,
    loadError,
    resolving,
    hasActiveFilters,
    activeRunLabel,
    pendingCount,
    navStats,
    PAGE_SIZE,
    reloadDesk,
    handleRunSelect: (runId) => setFilters((f) => ({ ...f, runId })),
    handleClearFilters: () => {
      setSearchInput('');
      setFilters({ q: '', company: '', location: '', title: '', tag: '', runId: '' });
    },
    handleFilterChange: (key, val) => setFilters((f) => ({ ...f, [key]: val })),
    handleUpdate: async (id, patch) => {
      if (!isPersistedLead({ id })) {
        setLoadError('Lead is still being saved. Try again in a moment.');
        return;
      }

      if (patch.starred !== undefined) {
        const starred = Boolean(patch.starred);
        applyStarChange([id], starred);
        try {
          setLoadError(null);
          await updateLead(id, { starred });
        } catch (err) {
          applyStarChange([id], !starred);
          setLoadError(err.message ?? 'Failed to update lead');
        }
        return;
      }

      try {
        setLoadError(null);
        const updated = await updateLead(id, patch);
        invalidateDeskCache();
        const normalized = normalizeLead(updated);
        setLeadsData((prev) => ({
          ...prev,
          leads: prev.leads.map((l) => (sameLeadId(l.id, id) ? normalized : l)),
        }));
        if (sameLeadId(selectedLead?.id, id)) setSelectedLead(normalized);
      } catch (err) {
        setLoadError(err.message ?? 'Failed to update lead');
      }
    },
    handleDelete: async (id) => {
      const ok = await askConfirm({
        title: 'Delete this lead?',
        message: 'This lead will be permanently removed from your knowledge base.',
        confirmLabel: 'Delete lead',
        variant: 'danger',
      });
      if (!ok) return;

      try {
        setLoadError(null);
        await deleteLead(id);
        setSelectedLead(null);
        setSelectedIds(new Set());
        invalidateDeskCache();
        await reloadDesk();
      } catch (err) {
        setLoadError(err.message ?? 'Failed to delete lead');
      }
    },
    handleSaveView: async () => {
      const name = window.prompt('Name this view');
      if (!name?.trim()) return;
      await createSavedView(name.trim(), { ...filters, view });
      invalidateDeskCache();
      await refreshDesk({ silent: true });
    },
    handleApplySavedView: (sv) => {
      const f = sv.filterJson ?? {};
      setSearchInput(f.q ?? '');
      setFilters({
        q: f.q ?? '',
        company: f.company ?? '',
        location: f.location ?? '',
        title: f.title ?? '',
        tag: f.tag ?? '',
        runId: f.runId ?? '',
      });
    },
    handleDeleteSavedView: async (id) => {
      await deleteSavedView(id);
      invalidateDeskCache();
      await refreshDesk({ silent: true });
    },
    handleResolve: async (action) => {
      if (!selectedReview) return;
      setResolving(true);
      try {
        await resolveDuplicate(selectedReview.id, action);
        const remaining = duplicates.filter((r) => r.id !== selectedReview.id);
        setDuplicates(remaining);
        setSelectedReview(remaining[0] ?? null);
        invalidateDeskCache();
        await refreshDesk({ silent: true });
        await loadDeskShell({ force: true });
      } finally {
        setResolving(false);
      }
    },
    mergeIncomingLeads,
    handleSearchComplete,
    handleToggleSelect: (id) => {
      const normalized = normalizeLeadId(id);
      if (!normalized) return;
      setSelectionScope('none');
      setSelectedIds((prev) => {
        const next = new Set([...prev].map(normalizeLeadId).filter(Boolean));
        if (next.has(normalized)) next.delete(normalized);
        else next.add(normalized);
        return next;
      });
    },
    handleToggleSelectAll: (checked) => {
      if (!checked) {
        setSelectedIds(new Set());
        setSelectionScope('none');
        return;
      }
      setSelectedIds(
        new Set(
          leadsData.leads.filter(isPersistedLead).map((l) => normalizeLeadId(l.id)).filter(Boolean),
        ),
      );
      setSelectionScope('page');
    },
    handleSelectAllMatching: () => setSelectionScope('all'),
    handleClearSelection: () => {
      setSelectedIds(new Set());
      setSelectionScope('none');
    },
    handleBulk: async (action, exportParams) => {
      const count =
        selectionScope === 'all' ? leadsData.total : [...selectedIds].filter((id) => isPersistedLead({ id })).length;

      if (!count) {
        setLoadError('Select saved leads to run bulk actions.');
        return;
      }

      if (action === 'delete') {
        const ok = await askConfirm({
          title: count === 1 ? 'Delete 1 lead?' : `Delete ${count.toLocaleString()} leads?`,
          message:
            selectionScope === 'all'
              ? 'All leads matching your current filters will be permanently deleted.'
              : 'Selected leads will be permanently removed from your knowledge base.',
          confirmLabel: count === 1 ? 'Delete lead' : `Delete ${count.toLocaleString()} leads`,
          variant: 'danger',
        });
        if (!ok) return;
      }

      try {
        setLoadError(null);
        await executeBulk(action, exportParams);
      } catch (err) {
        setLoadError(err.message ?? 'Bulk action failed');
      }
    },
    pageRange,
  };

  return (
    <DeskContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        variant={confirmDialog?.variant ?? 'danger'}
        loading={false}
        onConfirm={() => closeConfirm(true)}
        onCancel={() => closeConfirm(false)}
      />
    </DeskContext.Provider>
  );
}

export function useDesk() {
  const ctx = useContext(DeskContext);
  if (!ctx) throw new Error('useDesk must be used within DeskProvider');
  return ctx;
}
