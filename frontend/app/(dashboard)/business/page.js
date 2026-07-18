'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LEAD_PATH } from '../../../lib/avatar-labels';
import { COLORS, BUSINESS_STAGES } from '../../../lib/colors';
import {
  API_CACHE_KEYS,
  avatar3LeadDetailKey,
  avatar3SearchKey,
  fetchCachedJson,
  getApiCache,
  invalidateApiCache,
  setApiCache,
} from '../../../lib/api-cache';
import { getApiBaseUrl } from '../../../lib/apiBaseUrl';
import { 
  Search, Plus, MapPin, Star, Globe, Mail, Phone, User,
  Loader2, AlertTriangle, CheckCircle2, 
  KanbanSquare, Sliders, X, Building2,
  ArrowRight, Table2, ChevronLeft, ChevronRight,
  Check, AlertCircle, Trash2
} from 'lucide-react';
import MenuSelect from '../../../components/MenuSelect';
import DotScrollArea from '../../../components/DotScrollArea';

const BUSINESS_WORKSPACE_SECTIONS = [
  { id: 'source', label: 'Find New Leads', icon: Search },
  { id: 'pipeline', label: 'Pipeline Board', icon: KanbanSquare },
  { id: 'table', label: 'Table View', icon: Table2 },
];

const BUSINESS_TABLE_PAGE_SIZE = 10;

const BUSINESS_SEARCH_HINTS = [
  'Roofing contractors in Dallas',
  'Dental practices in Austin',
  'Auto repair shops in Houston',
];

const STAGES = BUSINESS_STAGES;
const STAGE_OPTIONS = STAGES.map((s) => ({ value: s.id, label: s.label }));

function websiteHost(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Website';
  }
}

function placePhotoUrl(apiBaseUrl, photoName) {
  if (!photoName) return null;
  return `${apiBaseUrl}/api/avatar3/place-photo?name=${encodeURIComponent(photoName)}&max_width_px=480`;
}

function placeIdPhotoUrl(apiBaseUrl, placeId) {
  const id = String(placeId || '').trim();
  if (!id || id.startsWith('dev-mock-place')) return null;
  return `${apiBaseUrl}/api/avatar3/places/${encodeURIComponent(id)}/photo`;
}

function searchResultImageUrl(apiBaseUrl, business) {
  return placePhotoUrl(apiBaseUrl, business?.photo_name)
    || placeIdPhotoUrl(apiBaseUrl, business?.google_place_id);
}

function leadImageUrl(apiBaseUrl, leadId) {
  return `${apiBaseUrl}/api/avatar3/leads/${leadId}/image`;
}

/** Merge Places search fields with any saved pipeline lead for the same place. */
function resolveBusinessContacts(business, leads = []) {
  const saved = (leads || []).find(
    (lead) => lead?.google_place_id && lead.google_place_id === business?.google_place_id,
  );
  return {
    owner_name: business?.owner_name || saved?.owner_name || null,
    manager_name: business?.manager_name || saved?.manager_name || null,
    phone: business?.phone || saved?.phone || null,
    website: business?.website || saved?.website || null,
    contact_email: business?.contact_email || business?.email || saved?.contact_email || null,
    contact_linkedin: business?.contact_linkedin || saved?.contact_linkedin || null,
  };
}

function mapsUrl(address) {
  if (!address) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function formatActivityWhen(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function humanizeOpenStatus(status) {
  const raw = String(status || '').trim();
  if (!raw) return null;
  const key = raw.toUpperCase();
  if (key === 'OPERATIONAL') return 'Open';
  if (key === 'CLOSED_TEMPORARILY') return 'Temporarily closed';
  if (key === 'CLOSED_PERMANENTLY') return 'Permanently closed';
  return raw.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function buildLeadActivity(lead) {
  const items = [];
  for (const note of lead?.notes || []) {
    items.push({
      id: `note-${note.id}`,
      at: note.created_at,
      kind: 'Note',
      body: note.content,
    });
  }
  for (const event of lead?.events || []) {
    if (event.event_type === 'follow_up_generated') continue;
    items.push({
      id: `event-${event.id}`,
      at: event.created_at,
      kind: event.event_type === 'stage_change' ? 'Stage change' : 'Update',
      body: event.description,
    });
  }
  return items
    .filter((item) => item.body)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function BusinessWorkspaceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const apiBaseUrl = getApiBaseUrl();

  // Route states
  const urlQuery = searchParams.get('q') || '';
  const urlView = searchParams.get('view');
  const initialLeadId = searchParams.get('leadId') || null;

  // Pipeline leads state — hydrate from cache so pipeline/table tabs skip loading flash
  const [leads, setLeads] = useState([]);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsError, setLeadsError] = useState(false);
  const [selectedQueryFilter, setSelectedQueryFilter] = useState('');
  const [leadsHydrated, setLeadsHydrated] = useState(false);

  // Search/sourcing states
  const [searchQuery, setSearchQuery] = useState(urlQuery);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchValidationError, setSearchValidationError] = useState('');
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [addingLeads, setAddingLeads] = useState({});
  const [addingAll, setAddingAll] = useState(false);
  const [previewResult, setPreviewResult] = useState(null);

  // Detail slide-over states (Step 3.7)
  const [selectedLeadId, setSelectedLeadId] = useState(initialLeadId);
  const [leadDetails, setLeadDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  // Toast notification
  const [toast, setToast] = useState(null); // { message: string, type: 'success' | 'error' }
  const [workspaceSection, setWorkspaceSection] = useState(
    urlView === 'source' || urlQuery ? 'source' : urlView === 'table' ? 'table' : 'pipeline'
  );
  const [deletingLeadId, setDeletingLeadId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { id, name } | null
  const [searchConfirm, setSearchConfirm] = useState(null); // 'add-all' | 'clear-search' | null
  const [tablePage, setTablePage] = useState(1);
  const [dragOverStage, setDragOverStage] = useState(null);
  const skipCardClickRef = useRef(false);
  const pendingStagesRef = useRef(new Map());
  const leadsFetchIdRef = useRef(0);

  const filteredLeads = useMemo(
    () => leads.filter((l) => !selectedQueryFilter || l.source_query === selectedQueryFilter),
    [leads, selectedQueryFilter]
  );

  const tablePageCount = Math.max(1, Math.ceil(filteredLeads.length / BUSINESS_TABLE_PAGE_SIZE));
  const safeTablePage = Math.min(tablePage, tablePageCount);
  const tablePageStart = filteredLeads.length === 0
    ? 0
    : (safeTablePage - 1) * BUSINESS_TABLE_PAGE_SIZE + 1;
  const tablePageEnd = Math.min(safeTablePage * BUSINESS_TABLE_PAGE_SIZE, filteredLeads.length);
  const pagedTableLeads = useMemo(
    () => filteredLeads.slice(
      (safeTablePage - 1) * BUSINESS_TABLE_PAGE_SIZE,
      safeTablePage * BUSINESS_TABLE_PAGE_SIZE,
    ),
    [filteredLeads, safeTablePage],
  );

  useEffect(() => {
    setTablePage(1);
  }, [selectedQueryFilter]);

  useEffect(() => {
    if (tablePage > tablePageCount) setTablePage(tablePageCount);
  }, [tablePage, tablePageCount]);

  const renderQueryFilter = (idSuffix = '') => (
    <div className="business-filter-inline">
      <label className="business-filter-label" htmlFor={`business-query-filter${idSuffix}`}>Query</label>
      <select
        id={`business-query-filter${idSuffix}`}
        className="business-filter-select"
        value={selectedQueryFilter}
        onChange={(e) => setSelectedQueryFilter(e.target.value)}
      >
        <option value="">All queries</option>
        {Array.from(new Set(leads.map((lead) => lead.source_query).filter(Boolean))).map((q) => (
          <option key={q} value={q}>{q}</option>
        ))}
      </select>
      {selectedQueryFilter && (
        <button type="button" className="business-filter-clear" onClick={() => setSelectedQueryFilter('')}>
          Clear
        </button>
      )}
    </div>
  );

  const renderKanbanBoard = () => (
    <div className="pipeline-board" role="region" aria-label="Pipeline board">
      {STAGES.map((stage) => {
        const stageLeads = filteredLeads.filter((l) => l.pipeline_stage === stage.id);
        const isDropTarget = dragOverStage === stage.id;
        return (
          <section
            key={stage.id}
            className={`pipeline-list${isDropTarget ? ' pipeline-list--drop-target' : ''}`}
            onDragEnter={(e) => handleColumnDragEnter(e, stage.id)}
            onDragOver={(e) => handleColumnDragOver(e, stage.id)}
            onDragLeave={(e) => handleColumnDragLeave(e, stage.id)}
            onDrop={(e) => handleDrop(e, stage.id)}
            style={{ '--list-accent': stage.color }}
            aria-label={`${stage.label}, ${stageLeads.length} leads`}
          >
            <header className="pipeline-list__header">
              <h3 className="pipeline-list__title">{stage.label}</h3>
              <span className="pipeline-list__count">{stageLeads.length}</span>
            </header>

            <div className="pipeline-list__cards">
              {stageLeads.length === 0 ? (
                <p className="pipeline-list__empty">Drop leads here</p>
              ) : (
                stageLeads.map((lead) => (
                  <article
                    key={lead.id}
                    className={`pipeline-card${selectedLeadId === lead.id ? ' pipeline-card--active' : ''}`}
                    style={{ '--card-accent': stage.color }}
                    draggable
                    onDragStart={(e) => handleCardDragStart(e, lead.id, lead.pipeline_stage)}
                    onDragEnd={handleCardDragEnd}
                    onClick={() => {
                      if (skipCardClickRef.current) {
                        skipCardClickRef.current = false;
                        return;
                      }
                      handleSelectLead(lead.id);
                    }}
                  >
                    <div className="pipeline-card__media">
                      {lead.has_image ? (
                        <img
                          src={`${apiBaseUrl}/api/avatar3/leads/${lead.id}/image`}
                          alt=""
                          className="pipeline-card__image"
                          draggable={false}
                          onDragStart={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            const placeholder = e.currentTarget.nextElementSibling;
                            if (placeholder) placeholder.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <div
                        className="pipeline-card__image-placeholder"
                        style={{ display: lead.has_image ? 'none' : 'flex' }}
                        aria-hidden="true"
                      >
                        <Building2 size={22} />
                      </div>
                    </div>

                    <div className="pipeline-card__body">
                      <div className="pipeline-card__title-row">
                        <h4 className="pipeline-card__title">{lead.business_name}</h4>
                        {lead.website && (
                          <a
                            href={lead.website}
                            target="_blank"
                            rel="noreferrer"
                            draggable={false}
                            onClick={(e) => e.stopPropagation()}
                            onDragStart={(e) => e.preventDefault()}
                            className="pipeline-card__badge pipeline-card__badge--link pipeline-card__title-link"
                            aria-label="Open website"
                            title="Open website"
                          >
                            <Globe size={12} />
                          </a>
                        )}
                      </div>
                      {lead.source_query && (
                        <p className="pipeline-card__subtitle">{lead.source_query}</p>
                      )}
                    </div>

                    {(lead.rating || lead.address) && (
                      <div className="pipeline-card__badges">
                        {lead.rating && (
                          <span className="pipeline-card__badge" title="Rating">
                            <Star size={12} style={{ fill: COLORS.warning, color: COLORS.warning }} />
                            {lead.rating}
                          </span>
                        )}
                        {lead.address && (
                          <span className="pipeline-card__badge pipeline-card__badge--muted" title={lead.address}>
                            <MapPin size={12} />
                            <span className="pipeline-card__badge-text">{lead.address}</span>
                          </span>
                        )}
                      </div>
                    )}

                    <footer className="pipeline-card__footer">
                      <MenuSelect
                        className="pipeline-card__stage"
                        value={lead.pipeline_stage}
                        options={STAGE_OPTIONS}
                        onChange={(next) => handleStageUpdate(lead.id, lead.pipeline_stage, next)}
                        ariaLabel={`Move ${lead.business_name} to another stage`}
                      />
                      <button
                        type="button"
                        className="pipeline-card__remove"
                        disabled={deletingLeadId === lead.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          requestDeleteLead(lead.id, lead.business_name);
                        }}
                        aria-label={`Remove ${lead.business_name}`}
                        title="Remove lead"
                      >
                        {deletingLeadId === lead.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    </footer>
                  </article>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );

  const renderLeadsLoading = () => (
    <div className="business-tab-state">
      <Loader2 className="animate-spin" size={32} style={{ color: COLORS.textMuted }} />
      <span>Loading leads…</span>
    </div>
  );

  const renderLeadsError = () => (
    <div className="business-tab-state">
      <AlertTriangle size={36} style={{ color: COLORS.error }} />
      <h4>Failed to load leads</h4>
      <button type="button" onClick={() => fetchPipelineLeads({ force: true })} className="chip-fallback-btn">Retry</button>
    </div>
  );

  const renderEmptyPipeline = () => (
    <div className="business-tab-state">
      <Sliders size={44} style={{ color: 'var(--text-muted)', opacity: 0.6 }} />
      <h4>Your pipeline is empty</h4>
      <p>Search by region or category to add your first business prospects.</p>
      <button type="button" className="btn-primary" onClick={() => { handleSelectLead(null); setWorkspaceSection('source'); }}>
        Find New Leads
      </button>
    </div>
  );

  // Show Toast helper
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Fetch pipeline leads on mount
  const syncLeadsCache = (nextLeads) => {
    setApiCache(API_CACHE_KEYS.avatar3Leads, { items: nextLeads });
  };

  const mergePendingStages = (items) => {
    const pending = pendingStagesRef.current;
    if (!pending.size) return items || [];
    return (items || []).map((lead) => {
      const override = pending.get(String(lead.id));
      if (!override || override === lead.pipeline_stage) return lead;
      return { ...lead, pipeline_stage: override };
    });
  };

  const applyPipelineLeads = (items) => {
    const merged = mergePendingStages(items);
    syncLeadsCache(merged);
    setLeads(merged);
    return merged;
  };

  const fetchPipelineLeads = async ({ force = false } = {}) => {
    if (!force) {
      const cached = getApiCache(API_CACHE_KEYS.avatar3Leads);
      if (cached) {
        setLeads(mergePendingStages(cached.items || []));
        setLeadsLoading(false);
        void fetchPipelineLeads({ force: true });
        return;
      }
    }
    if (!force) setLeadsLoading(true);
    setLeadsError(false);
    const requestId = ++leadsFetchIdRef.current;
    try {
      // Avoid fetchCachedJson here: it writes cache before we can discard a stale response
      // that would clobber an optimistic stage move.
      const res = await fetch(`${apiBaseUrl}/api/avatar3/leads`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      if (requestId !== leadsFetchIdRef.current) return;
      applyPipelineLeads(data.items || []);
    } catch (err) {
      console.error(err);
      if (requestId === leadsFetchIdRef.current) setLeadsError(true);
    } finally {
      if (requestId === leadsFetchIdRef.current) setLeadsLoading(false);
    }
  };

  const syncLeadDetailCache = (leadId, detail) => {
    if (!leadId || !detail) return;
    setApiCache(avatar3LeadDetailKey(leadId), detail);
  };

  const executeSearch = async (queryStr, { force = false } = {}) => {
    if (!queryStr.trim()) return;
    const cacheKey = avatar3SearchKey(queryStr);

    if (!force) {
      const cached = getApiCache(cacheKey);
      const cachedPreview = cached?.preview;
      const cacheHasPhotos = Array.isArray(cachedPreview)
        && cachedPreview.some((item) => item?.photo_name || item?.google_place_id);
      // Ignore pre-photo search cache so result cards can load images.
      if (cached && cacheHasPhotos && cachedPreview.some((item) => 'photo_name' in (item || {}))) {
        setSearchResults(cachedPreview || []);
        setSearchLoading(false);
        setSearchError(false);
        setShowSearchPanel(true);
        void executeSearch(queryStr, { force: true });
        return;
      }
    }

    if (!force) setSearchLoading(true);
    setSearchError(false);
    setShowSearchPanel(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/avatar3/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryStr })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = typeof data.detail === 'string' ? data.detail : 'Search request failed';
        throw new Error(detail);
      }
      setSearchResults(data.preview || []);
      setApiCache(cacheKey, { preview: data.preview || [] });
    } catch (err) {
      console.error(err);
      setSearchError(true);
      showToast(err.message || 'Failed to retrieve search results.', 'error');
    } finally {
      setSearchLoading(false);
    }
  };

  // Hydrate leads from cache on first mount, then keep fresh in background
  useEffect(() => {
    const cached = getApiCache(API_CACHE_KEYS.avatar3Leads);
    if (cached) {
      setLeads(cached.items || []);
      setLeadsLoading(false);
    }
    setLeadsHydrated(true);
  }, []);

  // Fetch pipeline leads once hydrated (and when URL query changes for sourcing)
  useEffect(() => {
    if (!leadsHydrated) return;
    fetchPipelineLeads();
    if (urlQuery) {
      executeSearch(urlQuery);
    }
  }, [leadsHydrated, urlQuery]);

  // Load details for selected lead (cached per lead id)
  const fetchLeadDetails = async (id, { force = false } = {}) => {
    if (!id) return;
    const cacheKey = avatar3LeadDetailKey(id);

    if (!force) {
      const cached = getApiCache(cacheKey);
      if (cached) {
        setLeadDetails(cached);
        setDetailsLoading(false);
        setDetailsError(false);
        void fetchLeadDetails(id, { force: true });
        return;
      }
    }

    if (!force) setDetailsLoading(true);
    setDetailsError(false);
    try {
      const { data } = await fetchCachedJson(`${apiBaseUrl}/api/avatar3/leads/${id}`, {
        cacheKey,
        force: true,
      });
      setLeadDetails(data);
    } catch (err) {
      console.error(err);
      setDetailsError(true);
    } finally {
      setDetailsLoading(false);
    }
  };

  // Sync selected lead details fetch
  useEffect(() => {
    if (selectedLeadId) {
      fetchLeadDetails(selectedLeadId);
    } else {
      setLeadDetails(null);
    }
  }, [selectedLeadId]);

  // Update selection state
  const handleSelectLead = (leadId) => {
    setSelectedLeadId(leadId);
    const params = new URLSearchParams(searchParams.toString());
    if (leadId) {
      params.set('leadId', leadId);
    } else {
      params.delete('leadId');
    }
    router.push(`?${params.toString()}`);
  };

  const requestDeleteLead = (leadId, businessName) => {
    if (!leadId || deletingLeadId) return;
    setDeleteConfirm({
      id: leadId,
      name: businessName || 'this lead',
    });
  };

  const handleDeleteLead = async () => {
    if (!deleteConfirm?.id || deletingLeadId) return;

    const leadId = deleteConfirm.id;
    const label = deleteConfirm.name;

    setDeletingLeadId(leadId);
    try {
      const res = await fetch(`${apiBaseUrl}/api/avatar3/leads/${leadId}`, { method: 'DELETE' });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || 'Failed to remove lead');
      }

      setLeads((prev) => {
        const next = prev.filter((l) => l.id !== leadId);
        syncLeadsCache(next);
        return next;
      });
      invalidateApiCache([avatar3LeadDetailKey(leadId)]);

      if (selectedLeadId === leadId) {
        handleSelectLead(null);
        setLeadDetails(null);
      }

      setDeleteConfirm(null);
      showToast(`Removed "${label}" from the pipeline.`);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to remove lead.', 'error');
    } finally {
      setDeletingLeadId(null);
    }
  };

  // Sourcing import: Add a searched business lead straight into the board
  const handleAddLead = async (business, { quiet = false } = {}) => {
    const placeId = business.google_place_id || 'unknown';
    setAddingLeads(prev => ({
      ...prev,
      [placeId]: 'loading'
    }));

    try {
      const res = await fetch(`${apiBaseUrl}/api/avatar3/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_name: business.business_name,
          address: business.address,
          website: business.website,
          google_place_id: business.google_place_id,
          rating: business.rating ? String(business.rating) : null,
          open_status: business.open_status,
          phone: business.phone,
          source_query: searchQuery || null
        })
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(errorBody.detail || 'Failed to create pipeline lead');
      }

      const leadData = await res.json();

      if (leadData.duplicate) {
        if (!quiet) showToast(`"${leadData.business_name}" is already in the pipeline.`, 'success');
        setLeads(prev => {
          if (prev.some(l => l.google_place_id === leadData.google_place_id)) {
            return prev;
          }
          const next = [leadData, ...prev];
          syncLeadsCache(next);
          return next;
        });
      } else {
        if (!quiet) showToast(`Added "${leadData.business_name}" to pipeline!`, 'success');
        setLeads(prev => {
          const next = [leadData, ...prev];
          syncLeadsCache(next);
          return next;
        });
      }

      setAddingLeads(prev => {
        const next = { ...prev };
        delete next[placeId];
        return next;
      });
      return leadData;
    } catch (err) {
      console.error(err);
      const errMsg = err.message || 'Failed to add lead to pipeline.';
      if (!quiet) showToast(errMsg, 'error');
      setAddingLeads(prev => ({
        ...prev,
        [placeId]: { status: 'error', message: errMsg }
      }));
      return null;
    }
  };

  const pendingSearchAdds = useMemo(
    () => searchResults.filter(
      (business) => !leads.some((l) => l.google_place_id && l.google_place_id === business.google_place_id),
    ),
    [searchResults, leads],
  );

  const clearSearchResults = () => {
    setShowSearchPanel(false);
    setSearchResults([]);
    setSearchError(false);
    setPreviewResult(null);
    setSearchConfirm(null);
  };

  const handleAddAllLeads = async () => {
    const pending = pendingSearchAdds;
    if (pending.length === 0) {
      showToast('All visible results are already in the pipeline.');
      setSearchConfirm(null);
      return;
    }
    setSearchConfirm(null);
    setAddingAll(true);
    let added = 0;
    try {
      for (const business of pending) {
        const result = await handleAddLead(business, { quiet: true });
        if (result) added += 1;
      }
      showToast(`Added ${added} of ${pending.length} businesses to the pipeline.`);
    } finally {
      setAddingAll(false);
    }
  };

  // Native HTML5 Drag and Drop handlers
  const isCardDragHandleTarget = (target) => {
    if (!(target instanceof Element)) return true;
    return !target.closest('a, button, select, input, textarea, label, .pipeline-card__footer');
  };

  const handleCardDragStart = (e, leadId, fromStage) => {
    if (!isCardDragHandleTarget(e.target)) {
      e.preventDefault();
      return;
    }

    skipCardClickRef.current = true;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', leadId);
    e.dataTransfer.setData('fromStage', fromStage);
    e.currentTarget.classList.add('pipeline-card--dragging');
  };

  const handleCardDragEnd = (e) => {
    e.currentTarget.classList.remove('pipeline-card--dragging');
    setDragOverStage(null);
    // Keep skip flag until the synthetic click after drag, then clear leftover
    window.setTimeout(() => {
      skipCardClickRef.current = false;
    }, 150);
  };

  const handleColumnDragEnter = (e, stageId) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('text/plain')) {
      setDragOverStage(stageId);
    }
  };

  const handleColumnDragOver = (e, stageId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverStage !== stageId) {
      setDragOverStage(stageId);
    }
  };

  const handleColumnDragLeave = (e, stageId) => {
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    setDragOverStage((current) => (current === stageId ? null : current));
  };

  const handleStageUpdate = async (leadId, fromStage, toStage, { silent = false } = {}) => {
    if (!leadId || fromStage === toStage) return;
    const leadKey = String(leadId);

    // Invalidate in-flight list refreshes so they can't overwrite this move
    leadsFetchIdRef.current += 1;
    pendingStagesRef.current.set(leadKey, toStage);

    setLeads((prev) => {
      const next = prev.map((l) => (
        String(l.id) === leadKey ? { ...l, pipeline_stage: toStage } : l
      ));
      syncLeadsCache(next);
      return next;
    });

    try {
      const patchRes = await fetch(`${apiBaseUrl}/api/avatar3/leads/${leadId}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_stage: toStage })
      });

      if (!patchRes.ok) throw new Error('Stage change was rejected by server');

      const updatedLead = await patchRes.json();
      if (pendingStagesRef.current.get(leadKey) === toStage) {
        pendingStagesRef.current.delete(leadKey);
      }

      setLeads((prev) => {
        const next = prev.map((l) => {
          if (String(l.id) !== leadKey) return l;
          const override = pendingStagesRef.current.get(leadKey);
          return override
            ? { ...updatedLead, pipeline_stage: override }
            : { ...l, ...updatedLead };
        });
        syncLeadsCache(next);
        return next;
      });

      if (selectedLeadId && String(selectedLeadId) === leadKey) {
        setLeadDetails((prev) => {
          if (!prev) return null;
          const override = pendingStagesRef.current.get(leadKey);
          const next = {
            ...prev,
            ...updatedLead,
            pipeline_stage: override || updatedLead.pipeline_stage || toStage,
          };
          syncLeadDetailCache(leadId, next);
          return next;
        });
      }

      if (!silent) showToast('Lead stage updated successfully.');
    } catch (err) {
      console.error(err);
      if (pendingStagesRef.current.get(leadKey) === toStage) {
        pendingStagesRef.current.delete(leadKey);
      }
      setLeads((prev) => {
        const next = prev.map((l) => (
          String(l.id) === leadKey ? { ...l, pipeline_stage: fromStage } : l
        ));
        syncLeadsCache(next);
        return next;
      });
      showToast('Failed to update lead stage. Reverted changes.', 'error');
    }
  };

  const handleDrop = (e, toStage) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverStage(null);
    const leadId = e.dataTransfer.getData('text/plain');
    const fromStage = e.dataTransfer.getData('fromStage');
    skipCardClickRef.current = true;
    handleStageUpdate(leadId, fromStage, toStage, { silent: true });
  };

  // Add Note — backend now returns full lead detail in one response (no extra GET needed)
  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!newNoteContent.trim() || !selectedLeadId) return;

    const savedText = newNoteContent; // preserve in case of error
    setNoteSaving(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/avatar3/leads/${selectedLeadId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newNoteContent, author: 'Peter' })
      });

      if (!res.ok) throw new Error('Failed to save note');

      // Backend now returns the full updated lead (stage, plans, events) in one shot
      const updatedLead = await res.json();
      setLeadDetails(updatedLead);
      syncLeadDetailCache(selectedLeadId, updatedLead);
      setNewNoteContent('');

      // Sync board column if reclassification agent moved the stage
      setLeads(prev => {
        const next = prev.map(l =>
          l.id === selectedLeadId
            ? { ...l, pipeline_stage: updatedLead.pipeline_stage }
            : l
        );
        syncLeadsCache(next);
        return next;
      });

      const latestPlan = updatedLead.follow_up_plans?.slice(-1)[0];
      const stageChanged = updatedLead.pipeline_stage !== leadDetails?.pipeline_stage;
      if (stageChanged) {
        showToast(`AI moved stage → ${updatedLead.pipeline_stage.replace(/_/g, ' ')}`, 'success');
      } else if (latestPlan) {
        showToast('Follow-up plan generated!', 'success');
      } else {
        showToast('Note saved.', 'success');
      }
    } catch (err) {
      console.error(err);
      setNewNoteContent(savedText); // restore text so user doesn't lose it
      showToast('Failed to save note. Check connection.', 'error');
    } finally {
      setNoteSaving(false);
    }
  };

  return (
    <div
      className={`workspace-page workspace-page--business${
        workspaceSection === 'pipeline' || workspaceSection === 'table' ? ' workspace-page--board-view' : ''
      }`}
      id="business-workspace-root"
    >
      {toast && (
        <div className={`workspace-toast workspace-toast--${toast.type}`}>
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{toast.message}</span>
        </div>
      )}

      {deleteConfirm && (
        <div
          className="compose-confirm-backdrop"
          role="presentation"
          onClick={() => {
            if (!deletingLeadId) setDeleteConfirm(null);
          }}
        >
          <div
            className="compose-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-confirm-title"
            aria-describedby="delete-confirm-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-confirm-title">Remove this lead?</h3>
            <p id="delete-confirm-desc">
              Remove &ldquo;{deleteConfirm.name}&rdquo; from the pipeline? This permanently deletes
              the lead and its notes. This cannot be undone.
            </p>
            <div className="compose-confirm-modal__actions">
              <button
                type="button"
                className="chip-fallback-btn"
                disabled={Boolean(deletingLeadId)}
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary compose-confirm-modal__danger"
                disabled={Boolean(deletingLeadId)}
                onClick={handleDeleteLead}
              >
                {deletingLeadId ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Removing…
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
                    Yes, remove
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {searchConfirm === 'add-all' && (
        <div
          className="compose-confirm-backdrop"
          role="presentation"
          onClick={() => { if (!addingAll) setSearchConfirm(null); }}
        >
          <div
            className="compose-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-all-confirm-title"
            aria-describedby="add-all-confirm-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="add-all-confirm-title">Add all to pipeline?</h3>
            <p id="add-all-confirm-desc">
              {pendingSearchAdds.length === 0
                ? 'Every business in these results is already saved on your pipeline. Nothing new will be added.'
                : (
                  <>
                    This will save <strong>{pendingSearchAdds.length}</strong> of{' '}
                    <strong>{searchResults.length}</strong> results to the New stage
                    {searchQuery || urlQuery ? (
                      <> for &ldquo;{searchQuery || urlQuery}&rdquo;</>
                    ) : null}
                    . Businesses already on your board are left unchanged, so you will not get duplicates.
                  </>
                )}
            </p>
            <div className="compose-confirm-modal__actions">
              <button
                type="button"
                className="chip-fallback-btn"
                disabled={addingAll}
                onClick={() => setSearchConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={addingAll || pendingSearchAdds.length === 0}
                onClick={handleAddAllLeads}
              >
                {addingAll ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Adding…
                  </>
                ) : (
                  <>
                    <Plus size={14} />
                    Add {pendingSearchAdds.length || 0} to pipeline
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {searchConfirm === 'clear-search' && (
        <div
          className="compose-confirm-backdrop"
          role="presentation"
          onClick={() => setSearchConfirm(null)}
        >
          <div
            className="compose-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-search-confirm-title"
            aria-describedby="clear-search-confirm-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="clear-search-confirm-title">Search again?</h3>
            <p id="clear-search-confirm-desc">
              These web search results are temporary. Leaving this page clears any businesses you have not added to the pipeline.
              {pendingSearchAdds.length > 0
                ? ` ${pendingSearchAdds.length} result${pendingSearchAdds.length === 1 ? '' : 's'} still not added will be lost.`
                : ' All visible results are already saved on the board.'}
              {' '}You can run the same search later if needed.
            </p>
            <div className="compose-confirm-modal__actions">
              <button
                type="button"
                className="chip-fallback-btn"
                onClick={() => setSearchConfirm(null)}
              >
                Keep results
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={clearSearchResults}
              >
                Clear and search again
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="individual-page-header">
        <nav className="individual-workspace-nav" aria-label="Business leads workflow">
          {BUSINESS_WORKSPACE_SECTIONS.map((section) => {
            const SectionIcon = section.icon;
            const isActive = workspaceSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                className={`individual-workspace-nav__tab${isActive ? ' individual-workspace-nav__tab--active' : ''}`}
                onClick={() => {
                  if (section.id === 'source' && selectedLeadId) {
                    handleSelectLead(null);
                  }
                  setWorkspaceSection(section.id);
                }}
              >
                <SectionIcon size={16} />
                <span>{section.label}</span>
              </button>
            );
          })}
        </nav>
      </header>

      {/* Keep all three tabs mounted so switching Pipeline ↔ Table ↔ Source is instant */}
      <div
        className="individual-section individual-section--source"
        hidden={workspaceSection !== 'source'}
        aria-hidden={workspaceSection !== 'source'}
      >
          {!showSearchPanel ? (
            <section className="individual-search-hub" aria-label="Find new businesses">
              <div className="individual-search-hub__inner">
                <div className="individual-search-hub__copy">
                  <p className="individual-search-hub__eyebrow">New business search</p>
                  <h2 className="individual-search-hub__title">
                    What businesses are you targeting?
                  </h2>
                  <p className="individual-search-hub__desc">
                    Search by region or category to find {LEAD_PATH.business.label.toLowerCase()}.
                  </p>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const query = searchQuery.trim();
                    if (!query) {
                      setSearchValidationError('Enter a region or business category (e.g. "Roofing contractors in Dallas").');
                      return;
                    }
                    setSearchValidationError('');
                    executeSearch(query);
                  }}
                  className="individual-search-hub__form"
                >
                  <div className={`individual-search-hub__bar${searchValidationError ? ' individual-search-hub__bar--invalid' : ''}`}>
                    <Search className="individual-search-hub__icon" size={22} aria-hidden="true" />
                    <input
                      type="text"
                      className="individual-search-hub__input"
                      placeholder="e.g. Roofing contractors in Dallas"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        if (e.target.value.trim()) setSearchValidationError('');
                      }}
                      aria-label="Business search query"
                    />
                    <button type="submit" className="individual-search-hub__submit">
                      Source leads
                      <ArrowRight size={18} />
                    </button>
                  </div>
                  {searchValidationError && (
                    <div className="individual-search-hub__error">
                      <AlertTriangle size={14} />
                      <span>{searchValidationError}</span>
                    </div>
                  )}
                </form>

                <div className="individual-search-hub__hints" aria-label="Example searches">
                  <span className="individual-search-hub__hints-label">Try</span>
                  {BUSINESS_SEARCH_HINTS.map((hint) => (
                    <button
                      key={hint}
                      type="button"
                      className="individual-search-hub__hint"
                      onClick={() => {
                        setSearchQuery(hint);
                        setSearchValidationError('');
                        executeSearch(hint);
                      }}
                    >
                      {hint}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          ) : (
            <div className="business-search-active">
              <div className="business-search-active__header">
                <h3 className="business-search-active__title">
                  Results for &ldquo;{searchQuery || urlQuery}&rdquo;
                </h3>
                <div className="business-search-active__actions">
                  {!searchLoading && !searchError && searchResults.length > 0 && (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={addingAll}
                      onClick={() => setSearchConfirm('add-all')}
                    >
                      {addingAll ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          Adding…
                        </>
                      ) : (
                        <>
                          <Plus size={14} />
                          Add all to pipeline
                        </>
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    className="business-search-active__back"
                    onClick={() => setSearchConfirm('clear-search')}
                  >
                    <X size={14} />
                    Search again
                  </button>
                </div>
              </div>

              {!searchLoading && !searchError && searchResults.length > 0 && (
                <p className="business-search-active__notice">
                  Results stay here until you leave or search again. Add businesses to the pipeline to keep them on your board.
                </p>
              )}

              {searchLoading ? (
                <div className="business-tab-state business-tab-state--inline">
                  <Loader2 className="animate-spin" size={20} style={{ color: COLORS.textMuted }} />
                  <span>Searching regional listings…</span>
                </div>
              ) : searchError ? (
                <p className="business-tab-state__error">Failed to fetch results. Check backend logs.</p>
              ) : searchResults.length === 0 ? (
                <p className="business-tab-state__muted">No businesses found for this query.</p>
              ) : (
                <div className="business-search-results-grid">
                  {searchResults.map((business, idx) => {
                    const placeId = business.google_place_id || 'unknown';
                    const isAdded = leads.some(l => l.google_place_id === business.google_place_id);
                    const isAdding = addingLeads[placeId] === 'loading';
                    const addError = addingLeads[placeId]?.status === 'error' ? addingLeads[placeId].message : null;
                    const imageSrc = searchResultImageUrl(apiBaseUrl, business);
                    const contacts = resolveBusinessContacts(business, leads);

                    return (
                      <div
                        key={business.google_place_id || idx}
                        className="glass-card business-search-card"
                        role="button"
                        tabIndex={0}
                        onClick={() => setPreviewResult(business)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setPreviewResult(business);
                          }
                        }}
                      >
                        <div className="business-search-card__media" aria-hidden="true">
                          {imageSrc ? (
                            <img
                              src={imageSrc}
                              alt=""
                              className="business-search-card__image"
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                const placeholder = e.currentTarget.nextElementSibling;
                                if (placeholder) placeholder.style.display = 'flex';
                              }}
                            />
                          ) : null}
                          <div
                            className="business-search-card__image-placeholder"
                            style={{ display: imageSrc ? 'none' : 'flex' }}
                          >
                            <Building2 size={22} />
                          </div>
                        </div>
                        <div>
                          <h5 className="business-search-card__title">{business.business_name}</h5>
                          <div className="business-search-card__meta">
                            <Star size={10} style={{ color: COLORS.warning, fill: COLORS.warning }} />
                            <span>{business.rating || 'No rating'}</span>
                            <span>·</span>
                            <span>{humanizeOpenStatus(business.open_status) || 'Unknown'}</span>
                          </div>
                          <p className="business-search-card__address">
                            <MapPin size={10} />
                            {business.address || 'No address'}
                          </p>
                          {contacts.owner_name && (
                            <p className="business-search-card__contact business-search-card__contact--text">
                              <User size={10} />
                              <span>Owner: {contacts.owner_name}</span>
                            </p>
                          )}
                          {!contacts.owner_name && contacts.manager_name && (
                            <p className="business-search-card__contact business-search-card__contact--text">
                              <User size={10} />
                              <span>Manager: {contacts.manager_name}</span>
                            </p>
                          )}
                          {contacts.phone && (
                            <a
                              href={`tel:${contacts.phone}`}
                              className="business-search-card__contact"
                              onClick={(e) => e.stopPropagation()}
                              title={contacts.phone}
                            >
                              <Phone size={10} />
                              <span>{contacts.phone}</span>
                            </a>
                          )}
                          {contacts.website && (
                            <a
                              href={contacts.website}
                              target="_blank"
                              rel="noreferrer"
                              className="business-search-card__contact"
                              onClick={(e) => e.stopPropagation()}
                              title={contacts.website}
                            >
                              <Globe size={10} />
                              <span>{websiteHost(contacts.website)}</span>
                            </a>
                          )}
                          {contacts.contact_email && (
                            <a
                              href={`mailto:${contacts.contact_email}`}
                              className="business-search-card__contact"
                              onClick={(e) => e.stopPropagation()}
                              title={contacts.contact_email}
                            >
                              <Mail size={10} />
                              <span>{contacts.contact_email}</span>
                            </a>
                          )}
                          {addError && (
                            <div className="business-search-card__error-inline">
                              <AlertCircle size={10} />
                              <span>{addError}</span>
                            </div>
                          )}
                        </div>
                        <div className="business-search-card__actions">
                          <button
                            type="button"
                            className="business-search-card__view"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewResult(business);
                            }}
                          >
                            View details
                          </button>
                          {isAdded ? (
                            <div className="business-search-card__added">
                              <Check size={12} />
                              Added
                            </div>
                          ) : isAdding ? (
                            <button
                              type="button"
                              disabled
                              className="business-search-card__adding"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Loader2 className="animate-spin" size={12} />
                              Adding...
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddLead(business);
                              }}
                              className="business-search-card__add"
                            >
                              <Plus size={12} />
                              Add to pipeline
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {previewResult && (
                <div className="business-result-preview" role="dialog" aria-modal="true" aria-label="Business details">
                  <div
                    className="business-result-preview__backdrop"
                    onClick={() => setPreviewResult(null)}
                  />
                  <div className="business-result-preview__panel">
                    {(() => {
                      const contacts = resolveBusinessContacts(previewResult, leads);
                      return (
                        <>
                    <div className="business-result-preview__head">
                      <h4 className="business-result-preview__name">{previewResult.business_name}</h4>
                      <button
                        type="button"
                        className="biz-detail__icon-btn"
                        onClick={() => setPreviewResult(null)}
                        aria-label="Close details"
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <dl className="business-result-preview__facts">
                      {previewResult.rating != null && previewResult.rating !== '' && (
                        <div className="business-result-preview__fact">
                          <dt>Rating</dt>
                          <dd>
                            <Star size={12} style={{ fill: COLORS.warning, color: COLORS.warning, verticalAlign: '-1px' }} />
                            {' '}{previewResult.rating}
                          </dd>
                        </div>
                      )}
                      {humanizeOpenStatus(previewResult.open_status) && (
                        <div className="business-result-preview__fact">
                          <dt>Status</dt>
                          <dd>{humanizeOpenStatus(previewResult.open_status)}</dd>
                        </div>
                      )}
                      {previewResult.address && (
                        <div className="business-result-preview__fact">
                          <dt>Address</dt>
                          <dd>
                            <a
                              href={mapsUrl(previewResult.address)}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {previewResult.address}
                            </a>
                          </dd>
                        </div>
                      )}
                      {contacts.owner_name && (
                        <div className="business-result-preview__fact">
                          <dt>Owner</dt>
                          <dd>{contacts.owner_name}</dd>
                        </div>
                      )}
                      {contacts.manager_name && (
                        <div className="business-result-preview__fact">
                          <dt>Manager</dt>
                          <dd>{contacts.manager_name}</dd>
                        </div>
                      )}
                      {contacts.phone && (
                        <div className="business-result-preview__fact">
                          <dt>Phone</dt>
                          <dd><a href={`tel:${contacts.phone}`}>{contacts.phone}</a></dd>
                        </div>
                      )}
                      {contacts.website && (
                        <div className="business-result-preview__fact">
                          <dt>Website</dt>
                          <dd>
                            <a href={contacts.website} target="_blank" rel="noreferrer">
                              {websiteHost(contacts.website)}
                            </a>
                          </dd>
                        </div>
                      )}
                      {contacts.contact_email && (
                        <div className="business-result-preview__fact">
                          <dt>Email</dt>
                          <dd>
                            <a href={`mailto:${contacts.contact_email}`}>
                              {contacts.contact_email}
                            </a>
                          </dd>
                        </div>
                      )}
                      {contacts.contact_linkedin && (
                        <div className="business-result-preview__fact">
                          <dt>LinkedIn</dt>
                          <dd>
                            <a href={contacts.contact_linkedin} target="_blank" rel="noreferrer">
                              Profile
                            </a>
                          </dd>
                        </div>
                      )}
                    </dl>
                    <div className="business-result-preview__footer">
                      {leads.some((l) => l.google_place_id === previewResult.google_place_id) ? (
                        <span className="business-search-card__added">
                          <Check size={12} />
                          Already in pipeline
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={addingLeads[previewResult.google_place_id || 'unknown'] === 'loading'}
                          onClick={async () => {
                            const result = await handleAddLead(previewResult);
                            if (result) setPreviewResult(null);
                          }}
                        >
                          {addingLeads[previewResult.google_place_id || 'unknown'] === 'loading' ? 'Adding…' : 'Add to pipeline'}
                        </button>
                      )}
                    </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}
      </div>

      <div
        className="business-section business-section--pipeline"
        hidden={workspaceSection !== 'pipeline'}
        aria-hidden={workspaceSection !== 'pipeline'}
      >
          {leadsLoading ? renderLeadsLoading() : leadsError ? renderLeadsError() : leads.length === 0 ? renderEmptyPipeline() : (
            <div className="business-board-section">
              <div className="business-tab-toolbar">
                <div className="business-tab-toolbar__intro">
                  <span className="business-tab-toolbar__count">{filteredLeads.length} leads</span>
                  <p className="business-tab-toolbar__hint">
                    Drag a card, use the stage dropdown, or log notes so AI can move it for you.
                  </p>
                </div>
                {renderQueryFilter('-pipeline')}
                <p className="business-pipeline-scroll-hint business-pipeline-scroll-hint--desktop" aria-hidden="true">Swipe columns →</p>
                <p className="business-pipeline-scroll-hint business-pipeline-scroll-hint--mobile" aria-hidden="true">Scroll for all stages ↓</p>
              </div>
              <div className="pipeline-board-shell">
                {renderKanbanBoard()}
              </div>
            </div>
          )}
      </div>

      <div
        className="business-section business-section--table"
        hidden={workspaceSection !== 'table'}
        aria-hidden={workspaceSection !== 'table'}
      >
          {leadsLoading ? renderLeadsLoading() : leadsError ? renderLeadsError() : (
            <>
              <div className="business-tab-toolbar">
                <div className="business-tab-toolbar__intro">
                  <span className="business-tab-toolbar__count">{filteredLeads.length} leads</span>
                  <p className="business-tab-toolbar__hint">
                    Use the stage dropdown, or open a lead and log notes so AI can update the stage.
                  </p>
                </div>
                {renderQueryFilter('-table')}
              </div>
              {filteredLeads.length === 0 ? (
                <div className="business-tab-state">
                  <p>No leads match this filter.</p>
                  <button type="button" className="btn-primary" onClick={() => { handleSelectLead(null); setWorkspaceSection('source'); }}>
                    Find New Leads
                  </button>
                </div>
              ) : (
                <div className="business-table-panel">
                  <DotScrollArea className="business-table-scroll" axis="vertical">
                    <table className="results-table business-leads-table">
                      <thead>
                        <tr>
                          <th>Business</th>
                          <th>Stage</th>
                          <th>Query</th>
                          <th>Address</th>
                          <th>Rating</th>
                          <th>Phone</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedTableLeads.map((lead) => (
                            <tr
                              key={lead.id}
                              className={selectedLeadId === lead.id ? 'business-leads-table__row--selected' : ''}
                              onClick={() => handleSelectLead(lead.id)}
                            >
                              <td>
                                <div className="business-leads-table__biz">
                                  <span className="business-leads-table__avatar" aria-hidden="true">
                                    {lead.has_image ? (
                                      <img
                                        src={leadImageUrl(apiBaseUrl, lead.id)}
                                        alt=""
                                        className="business-leads-table__avatar-img"
                                        onError={(e) => {
                                          e.currentTarget.style.display = 'none';
                                          const placeholder = e.currentTarget.nextElementSibling;
                                          if (placeholder) placeholder.style.display = 'flex';
                                        }}
                                      />
                                    ) : null}
                                    <span
                                      className="business-leads-table__avatar-fallback"
                                      style={{ display: lead.has_image ? 'none' : 'flex' }}
                                    >
                                      <Building2 size={14} />
                                    </span>
                                  </span>
                                  <span className="business-leads-table__name">{lead.business_name}</span>
                                </div>
                              </td>
                              <td>
                                <MenuSelect
                                  className="business-leads-table__stage"
                                  value={lead.pipeline_stage}
                                  options={STAGE_OPTIONS}
                                  onChange={(next) => handleStageUpdate(lead.id, lead.pipeline_stage, next)}
                                  ariaLabel={`Change stage for ${lead.business_name}`}
                                />
                              </td>
                              <td>{lead.source_query || '-'}</td>
                              <td>{lead.address || '-'}</td>
                              <td>{lead.rating || '-'}</td>
                              <td>{lead.phone || '-'}</td>
                              <td>
                                <div className="business-leads-table__actions">
                                  {lead.website && (
                                    <a
                                      href={lead.website}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="business-leads-table__action-btn"
                                      title="Open website"
                                      aria-label={`Open website for ${lead.business_name}`}
                                    >
                                      <Globe size={13} />
                                    </a>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      requestDeleteLead(lead.id, lead.business_name);
                                    }}
                                    className="business-leads-table__action-btn business-leads-table__action-btn--danger"
                                    title="Remove lead"
                                    aria-label={`Remove ${lead.business_name}`}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </DotScrollArea>
                  <div className="business-table-pagination" role="navigation" aria-label="Table pagination">
                    <span className="business-table-pagination__meta">
                      Showing {tablePageStart}-{tablePageEnd} of {filteredLeads.length}
                    </span>
                    <div className="business-table-pagination__controls">
                      <button
                        type="button"
                        className="business-table-pagination__btn"
                        disabled={safeTablePage <= 1}
                        onClick={() => setTablePage((page) => Math.max(1, page - 1))}
                        aria-label="Previous page"
                      >
                        <ChevronLeft size={14} />
                        Previous
                      </button>
                      <span className="business-table-pagination__page">
                        Page {safeTablePage} of {tablePageCount}
                      </span>
                      <button
                        type="button"
                        className="business-table-pagination__btn"
                        disabled={safeTablePage >= tablePageCount}
                        onClick={() => setTablePage((page) => Math.min(tablePageCount, page + 1))}
                        aria-label="Next page"
                      >
                        Next
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
      </div>

      {/* Lead detail panel */}
      {selectedLeadId && workspaceSection !== 'source' && (
        <>
        <div
          className="detail-slide-over-backdrop"
          onClick={() => handleSelectLead(null)}
        />
        <div className="detail-slide-over" role="dialog" aria-modal="true" aria-label="Lead details">
          {detailsLoading ? (
            <div className="biz-detail__state">
              <Loader2 className="animate-spin" size={22} style={{ color: COLORS.textMuted }} />
              <p>Loading details…</p>
            </div>
          ) : detailsError ? (
            <div className="biz-detail__state">
              <AlertTriangle size={22} style={{ color: COLORS.error }} />
              <h4>Couldn’t load details</h4>
              <button type="button" onClick={() => fetchLeadDetails(selectedLeadId, { force: true })} className="chip-fallback-btn">
                Retry
              </button>
            </div>
          ) : leadDetails ? (
            <div className="biz-detail">
              {(() => {
                const stageInfo = STAGES.find((s) => s.id === leadDetails.pipeline_stage) || STAGES[0];
                const latestPlan = leadDetails.follow_up_plans?.length
                  ? leadDetails.follow_up_plans[leadDetails.follow_up_plans.length - 1]
                  : null;
                const activity = buildLeadActivity(leadDetails);
                const siteLabel = websiteHost(leadDetails.website);
                const mapHref = mapsUrl(leadDetails.address);
                const openLabel = humanizeOpenStatus(leadDetails.open_status);
                const people = [
                  leadDetails.owner_name && { label: 'Owner', value: leadDetails.owner_name },
                  leadDetails.manager_name && { label: 'Manager', value: leadDetails.manager_name },
                  leadDetails.contact_email && {
                    label: 'Email',
                    value: leadDetails.contact_email,
                    href: `mailto:${leadDetails.contact_email}`,
                  },
                  leadDetails.contact_linkedin && {
                    label: 'LinkedIn',
                    value: 'Profile',
                    href: leadDetails.contact_linkedin,
                    external: true,
                  },
                ].filter(Boolean);

                return (
                  <>
                    <header className="biz-detail__head">
                      <div className="biz-detail__head-main">
                        <p
                          className="biz-detail__stage"
                          style={{ color: stageInfo.color, background: stageInfo.bg }}
                        >
                          {stageInfo.label}
                        </p>
                        <div className="biz-detail__title-row">
                          <h2 className="biz-detail__name">{leadDetails.business_name}</h2>
                          {leadDetails.rating != null && leadDetails.rating !== '' && (
                            <span className="biz-detail__chip biz-detail__chip--rating" title="Google rating">
                              <Star
                                size={12}
                                style={{ fill: COLORS.warning, color: COLORS.warning }}
                                aria-hidden="true"
                              />
                              {leadDetails.rating}
                            </span>
                          )}
                        </div>
                        {leadDetails.source_query && (
                          <p className="biz-detail__found">
                            Found via query &ldquo;{leadDetails.source_query}&rdquo;
                          </p>
                        )}
                      </div>
                      <div className="biz-detail__actions">
                        <button
                          type="button"
                          className="biz-detail__icon-btn biz-detail__icon-btn--danger"
                          disabled={deletingLeadId === leadDetails.id}
                          onClick={() => requestDeleteLead(leadDetails.id, leadDetails.business_name)}
                          title="Remove lead"
                          aria-label={`Remove ${leadDetails.business_name}`}
                        >
                          {deletingLeadId === leadDetails.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </button>
                        <button
                          type="button"
                          className="biz-detail__icon-btn"
                          onClick={() => handleSelectLead(null)}
                          aria-label="Close details"
                        >
                          <X size={15} />
                        </button>
                      </div>
                    </header>

                    <div className="biz-detail__body">
                      <section className="biz-detail__section" aria-label="Business contact">
                        <div className="biz-detail__section-head">
                          <h3 className="biz-detail__section-label">Contact</h3>
                          <p className="biz-detail__section-hint">
                            Reach them or open the listing. Move stages by dragging the card, or by logging notes so AI can advance them.
                          </p>
                        </div>
                        <dl className="biz-detail__facts">
                          {leadDetails.address && (
                            <div className="biz-detail__fact">
                              <dt>Address</dt>
                              <dd>
                                {mapHref ? (
                                  <a href={mapHref} target="_blank" rel="noreferrer">{leadDetails.address}</a>
                                ) : (
                                  leadDetails.address
                                )}
                              </dd>
                            </div>
                          )}
                          {leadDetails.phone && (
                            <div className="biz-detail__fact">
                              <dt>Phone</dt>
                              <dd><a href={`tel:${leadDetails.phone}`}>{leadDetails.phone}</a></dd>
                            </div>
                          )}
                          {leadDetails.website && (
                            <div className="biz-detail__fact">
                              <dt>Website</dt>
                              <dd>
                                <a href={leadDetails.website} target="_blank" rel="noreferrer">
                                  {siteLabel}
                                </a>
                              </dd>
                            </div>
                          )}
                          {!leadDetails.address && !leadDetails.phone && !leadDetails.website && (
                            <p className="biz-detail__empty">No public contact details on this listing yet.</p>
                          )}
                        </dl>
                        {openLabel && openLabel !== 'Open' && (
                          <div className="biz-detail__chips">
                            <span className="biz-detail__chip">{openLabel}</span>
                          </div>
                        )}
                      </section>

                      {people.length > 0 && (
                        <section className="biz-detail__section" aria-label="People">
                          <div className="biz-detail__section-head">
                            <h3 className="biz-detail__section-label">People</h3>
                            <p className="biz-detail__section-hint">
                              Contacts pulled from the business website when available.
                            </p>
                          </div>
                          <dl className="biz-detail__facts">
                            {people.map((person) => (
                              <div key={person.label} className="biz-detail__fact">
                                <dt>{person.label}</dt>
                                <dd>
                                  {person.href ? (
                                    <a
                                      href={person.href}
                                      {...(person.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                                    >
                                      {person.value}
                                    </a>
                                  ) : (
                                    person.value
                                  )}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </section>
                      )}

                      <section className="biz-detail__section" aria-label="Suggested next step">
                        <div className="biz-detail__section-head">
                          <h3 className="biz-detail__section-label">Suggested next step</h3>
                          <p className="biz-detail__section-hint">
                            Written from your notes. Use it as a starting point, then log what happened so AI can move the stage when needed.
                          </p>
                        </div>
                        {latestPlan ? (
                          <div className="biz-detail__next-box">
                            <div className="biz-detail__next-meta">
                              {latestPlan.suggested_channel && (
                                <p className="biz-detail__next-channel">
                                  Best channel: <strong>{latestPlan.suggested_channel}</strong>
                                </p>
                              )}
                              {latestPlan.created_at && (
                                <time
                                  className="biz-detail__activity-time"
                                  dateTime={latestPlan.created_at}
                                >
                                  {formatActivityWhen(latestPlan.created_at)}
                                </time>
                              )}
                            </div>
                            <p className="biz-detail__next-action">{latestPlan.recommended_action}</p>
                            {latestPlan.reasoning && (
                              <p className="biz-detail__next-why">
                                <strong>Why: </strong>
                                {latestPlan.reasoning}
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="biz-detail__empty">
                            No suggestion yet. Add a note below (call outcome, interest, timing) and we’ll draft the next move.
                          </p>
                        )}
                      </section>

                      <section className="biz-detail__section" aria-label="Activity">
                        <div className="biz-detail__section-head">
                          <h3 className="biz-detail__section-label">Activity</h3>
                          <p className="biz-detail__section-hint">
                            Notes and stage changes for this lead, newest first.
                          </p>
                        </div>
                        {activity.length === 0 ? (
                          <p className="biz-detail__empty">
                            Nothing logged yet. After you talk to them, capture it here so the pipeline stays accurate.
                          </p>
                        ) : (
                          <ul className="biz-detail__activity-list">
                            {activity.map((item) => (
                              <li key={item.id} className="biz-detail__activity-item">
                                <div className="biz-detail__activity-top">
                                  <span className="biz-detail__activity-kind">{item.kind}</span>
                                  <time className="biz-detail__activity-time" dateTime={item.at}>
                                    {formatActivityWhen(item.at)}
                                  </time>
                                </div>
                                <p className="biz-detail__activity-body">{item.body}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    </div>

                    <footer className="biz-detail__footer">
                      <form className="biz-detail__note-form" onSubmit={handleAddNote}>
                        <p className="biz-detail__note-label">Log a note</p>
                        <p className="biz-detail__note-hint">
                          Example: “Spoke with owner. Wants pricing next Tuesday.” Saving a note can move this lead to the next stage automatically.
                        </p>
                        <textarea
                          className="biz-detail__note-input"
                          placeholder="What happened?"
                          value={newNoteContent}
                          onChange={(e) => setNewNoteContent(e.target.value)}
                          aria-label="Log a note"
                        />
                        <div className="biz-detail__note-actions">
                          <button
                            type="submit"
                            className="btn-primary biz-detail__note-submit"
                            disabled={noteSaving || !newNoteContent.trim()}
                          >
                            {noteSaving ? 'Updating…' : 'Save note'}
                          </button>
                        </div>
                      </form>
                    </footer>
                  </>
                );
              })()}
            </div>
          ) : null}
        </div>
        </>
      )}

    </div>
  );
}

export default function BusinessPage() {
  return (
    <Suspense fallback={
      <div className="glass-card" style={{ padding: '40px', textAlign: 'center', background: '#ffffff' }}>
        <Loader2 className="animate-spin" size={24} style={{ color: COLORS.textMuted, margin: '0 auto 12px' }} />
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading Workspace...</span>
      </div>
    }>
      <BusinessWorkspaceContent />
    </Suspense>
  );
}
