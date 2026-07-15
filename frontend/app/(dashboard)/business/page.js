'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LEAD_PATH } from '../../../lib/avatar-labels';
import { COLORS, RGBA, BUSINESS_STAGES } from '../../../lib/colors';
import {
  API_CACHE_KEYS,
  avatar3LeadDetailKey,
  avatar3SearchKey,
  fetchCachedJson,
  getApiCache,
  setApiCache,
} from '../../../lib/api-cache';
import { getApiBaseUrl } from '../../../lib/apiBaseUrl';
import { 
  Search, Plus, MapPin, Star, Phone, Globe, 
  ChevronRight, Loader2, AlertTriangle, CheckCircle2, 
  KanbanSquare, Sliders, X, MessageSquare, Building2,
  Clock, PlusCircle, ArrowRight, Sparkles, Activity, Table2,
  Check, AlertCircle
} from 'lucide-react';

const BUSINESS_WORKSPACE_SECTIONS = [
  { id: 'source', label: 'Find New Leads', icon: Search },
  { id: 'pipeline', label: 'Pipeline Board', icon: KanbanSquare },
  { id: 'table', label: 'Table View', icon: Table2 },
];

const BUSINESS_SEARCH_HINTS = [
  'Roofing contractors in Dallas',
  'Dental practices in Austin',
  'Auto repair shops in Houston',
];

const STAGES = BUSINESS_STAGES;

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

  // Detail slide-over states (Step 3.7)
  const [selectedLeadId, setSelectedLeadId] = useState(initialLeadId);
  const [leadDetails, setLeadDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [noteAuthor, setNoteAuthor] = useState('Peter');
  const [noteSaving, setNoteSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);

  // Toast notification
  const [toast, setToast] = useState(null); // { message: string, type: 'success' | 'error' }
  const [workspaceSection, setWorkspaceSection] = useState(
    urlView === 'source' || urlQuery ? 'source' : urlView === 'table' ? 'table' : 'pipeline'
  );

  const filteredLeads = useMemo(
    () => leads.filter((l) => !selectedQueryFilter || l.source_query === selectedQueryFilter),
    [leads, selectedQueryFilter]
  );

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
        return (
          <section
            key={stage.id}
            className="pipeline-list"
            onDragOver={(e) => e.preventDefault()}
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
                <p className="pipeline-list__empty">No leads in this stage</p>
              ) : (
                stageLeads.map((lead) => (
                  <article
                    key={lead.id}
                    className={`pipeline-card${selectedLeadId === lead.id ? ' pipeline-card--active' : ''}`}
                    style={{ '--card-accent': stage.color }}
                    draggable
                    onDragStart={(e) => {
                      handleDragStart(e, lead.id, lead.pipeline_stage);
                      e.currentTarget.style.opacity = '0.45';
                    }}
                    onDragEnd={(e) => {
                      e.currentTarget.style.opacity = '';
                    }}
                    onClick={() => handleSelectLead(lead.id)}
                  >
                    <div className="pipeline-card__labels" aria-hidden="true">
                      <span className="pipeline-card__label" />
                    </div>

                    <div className="pipeline-card__media">
                      {lead.has_image ? (
                        <img
                          src={`${apiBaseUrl}/api/avatar3/leads/${lead.id}/image`}
                          alt={lead.business_name}
                          className="pipeline-card__image"
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
                      <h4 className="pipeline-card__title">{lead.business_name}</h4>
                      {lead.source_query && (
                        <p className="pipeline-card__subtitle">{lead.source_query}</p>
                      )}
                    </div>

                    {(lead.rating || lead.address || lead.website) && (
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
                        {lead.website && (
                          <a
                            href={lead.website}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="pipeline-card__badge pipeline-card__badge--link"
                            aria-label="Open website"
                          >
                            <Globe size={12} />
                          </a>
                        )}
                      </div>
                    )}

                    <footer className="pipeline-card__footer">
                      <label className="pipeline-card__move-label">
                        <span className="pipeline-card__move-text">Move</span>
                        <select
                          className="pipeline-stage-select pipeline-card__move"
                          value={lead.pipeline_stage}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => handleStageUpdate(lead.id, lead.pipeline_stage, e.target.value)}
                          aria-label={`Move ${lead.business_name} to another stage`}
                        >
                          {STAGES.map((s) => (
                            <option key={s.id} value={s.id}>{s.label}</option>
                          ))}
                        </select>
                      </label>
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
      <p>Search Google Places to add your first business prospects.</p>
      <button type="button" className="btn-primary" onClick={() => setWorkspaceSection('source')}>
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
  const fetchPipelineLeads = async ({ force = false } = {}) => {
    if (!force) {
      const cached = getApiCache(API_CACHE_KEYS.avatar3Leads);
      if (cached) {
        setLeads(cached.items || []);
        setLeadsLoading(false);
        void fetchPipelineLeads({ force: true });
        return;
      }
    }
    if (!force) setLeadsLoading(true);
    setLeadsError(false);
    try {
      const { data } = await fetchCachedJson(`${apiBaseUrl}/api/avatar3/leads`, {
        cacheKey: API_CACHE_KEYS.avatar3Leads,
        force: true,
      });
      setLeads(data.items || []);
    } catch (err) {
      console.error(err);
      setLeadsError(true);
    } finally {
      setLeadsLoading(false);
    }
  };

  const syncLeadsCache = (nextLeads) => {
    setApiCache(API_CACHE_KEYS.avatar3Leads, { items: nextLeads });
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
      if (cached) {
        setSearchResults(cached.preview || []);
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

  const handleEnrichFromWebsite = async () => {
    if (!selectedLeadId || !leadDetails?.website) return;
    setEnriching(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/avatar3/leads/${selectedLeadId}/enrich`, { method: 'POST' });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || 'Enrichment failed');
      }
      const data = await res.json();
      setLeadDetails((prev) => {
        const next = prev ? { ...prev, ...data } : data;
        syncLeadDetailCache(selectedLeadId, next);
        return next;
      });
      showToast('Contact details enriched from website');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Could not enrich from website', 'error');
    } finally {
      setEnriching(false);
    }
  };

  // Sourcing import: Add a searched business lead straight into the board
  const handleAddLead = async (business) => {
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
        showToast(`"${leadData.business_name}" is already in the pipeline.`, 'success');
        // Ensure it's in our leads list so the UI updates to show "Added"
        setLeads(prev => {
          if (prev.some(l => l.google_place_id === leadData.google_place_id)) {
            return prev;
          }
          const next = [leadData, ...prev];
          syncLeadsCache(next);
          return next;
        });
      } else {
        showToast(`Added "${leadData.business_name}" to pipeline!`, 'success');
        setLeads(prev => {
          const next = [leadData, ...prev];
          syncLeadsCache(next);
          return next;
        });
      }

      // Clear any errors/loading on success
      setAddingLeads(prev => {
        const next = { ...prev };
        delete next[placeId];
        return next;
      });
    } catch (err) {
      console.error(err);
      const errMsg = err.message || 'Failed to add lead to pipeline.';
      showToast(errMsg, 'error');
      setAddingLeads(prev => ({
        ...prev,
        [placeId]: { status: 'error', message: errMsg }
      }));
    }
  };

  // Native HTML5 Drag and Drop handlers
  const handleDragStart = (e, leadId, fromStage) => {
    e.dataTransfer.setData('text/plain', leadId);
    e.dataTransfer.setData('fromStage', fromStage);
  };

  const handleStageUpdate = async (leadId, fromStage, toStage) => {
    if (fromStage === toStage) return;

    // Optimistic UI updates
    const previousLeads = [...leads];
    setLeads(prev => {
      const next = prev.map(l => {
        if (l.id === leadId) {
          return { ...l, pipeline_stage: toStage };
        }
        return l;
      });
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
      
      // Update in-memory list with backend response
      setLeads(prev => {
        const next = prev.map(l => (l.id === leadId ? updatedLead : l));
        syncLeadsCache(next);
        return next;
      });
      
      // If currently selected lead details are active, sync them
      if (selectedLeadId === leadId) {
        setLeadDetails(prev => {
          if (!prev) return null;
          const next = { ...prev, pipeline_stage: toStage };
          syncLeadDetailCache(leadId, next);
          return next;
        });
      }

      showToast('Lead stage updated successfully.');

    } catch (err) {
      console.error(err);
      // Revert change
      setLeads(previousLeads);
      syncLeadsCache(previousLeads);
      showToast('Failed to update lead stage. Reverted changes.', 'error');
    }
  };

  const handleDrop = (e, toStage) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text/plain');
    const fromStage = e.dataTransfer.getData('fromStage');
    handleStageUpdate(leadId, fromStage, toStage);
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
        body: JSON.stringify({ content: newNoteContent, author: noteAuthor })
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
                onClick={() => setWorkspaceSection(section.id)}
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
                    Search Google Places by region or category to find {LEAD_PATH.business.label.toLowerCase()}.
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
                  <PlusCircle size={16} style={{ color: COLORS.textMuted }} />
                  Results for &ldquo;{searchQuery || urlQuery}&rdquo;
                </h3>
                <button
                  type="button"
                  className="business-search-active__back"
                  onClick={() => { setShowSearchPanel(false); setSearchResults([]); setSearchError(false); }}
                >
                  <X size={14} />
                  Search again
                </button>
              </div>

              {searchLoading ? (
                <div className="business-tab-state business-tab-state--inline">
                  <Loader2 className="animate-spin" size={20} style={{ color: COLORS.textMuted }} />
                  <span>Scraping regional listings…</span>
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

                    return (
                      <div key={business.google_place_id || idx} className="glass-card business-search-card">
                        <div>
                          <h5 className="business-search-card__title">{business.business_name}</h5>
                          <div className="business-search-card__meta">
                            <Star size={10} style={{ color: COLORS.warning, fill: COLORS.warning }} />
                            <span>{business.rating || 'No rating'}</span>
                            <span>·</span>
                            <span>{business.open_status || 'UNKNOWN'}</span>
                          </div>
                          <p className="business-search-card__address">
                            <MapPin size={10} />
                            {business.address || 'No address'}
                          </p>
                          {addError && (
                            <div className="business-search-card__error-inline">
                              <AlertCircle size={10} />
                              <span>{addError}</span>
                            </div>
                          )}
                        </div>
                        {isAdded ? (
                          <div className="business-search-card__added">
                            <Check size={12} />
                            Added
                          </div>
                        ) : isAdding ? (
                          <button type="button" disabled className="business-search-card__adding">
                            <Loader2 className="animate-spin" size={12} />
                            Adding...
                          </button>
                        ) : (
                          <button type="button" onClick={() => handleAddLead(business)} className="business-search-card__add">
                            <Plus size={12} />
                            Add to pipeline
                          </button>
                        )}
                      </div>
                    );
                  })}
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
                <span className="business-tab-toolbar__count">{filteredLeads.length} leads</span>
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
                <span className="business-tab-toolbar__count">{filteredLeads.length} leads</span>
                {renderQueryFilter('-table')}
              </div>
              {filteredLeads.length === 0 ? (
                <div className="business-tab-state">
                  <p>No leads match this filter.</p>
                  <button type="button" className="btn-primary" onClick={() => setWorkspaceSection('source')}>
                    Find New Leads
                  </button>
                </div>
              ) : (
                <div className="business-table-scroll">
                  <table className="results-table business-leads-table">
                    <thead>
                      <tr>
                        <th>Business</th>
                        <th>Stage</th>
                        <th>Query</th>
                        <th>Address</th>
                        <th>Rating</th>
                        <th>Phone</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLeads.map((lead) => (
                          <tr
                            key={lead.id}
                            className={selectedLeadId === lead.id ? 'business-leads-table__row--selected' : ''}
                            onClick={() => handleSelectLead(lead.id)}
                          >
                            <td>
                              <span className="business-leads-table__name">{lead.business_name}</span>
                              {lead.website && (
                                <a
                                  href={lead.website}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="business-leads-table__link"
                                >
                                  <Globe size={12} />
                                </a>
                              )}
                            </td>
                            <td>
                              <select
                                className="pipeline-stage-select business-leads-table__stage"
                                value={lead.pipeline_stage}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => handleStageUpdate(lead.id, lead.pipeline_stage, e.target.value)}
                                aria-label={`Change stage for ${lead.business_name}`}
                              >
                                {STAGES.map((s) => (
                                  <option key={s.id} value={s.id}>{s.label}</option>
                                ))}
                              </select>
                            </td>
                            <td>{lead.source_query || '—'}</td>
                            <td>{lead.address || '—'}</td>
                            <td>{lead.rating || '—'}</td>
                            <td>{lead.phone || '—'}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
      </div>

      {/* Detail Slide-over Panel (Step 3.7) */}
      {selectedLeadId && (
        <>
        {/* Backdrop overlay */}
        <div
          className="detail-slide-over-backdrop"
          onClick={() => handleSelectLead(null)}
        />
        <div className="detail-slide-over">
          {detailsLoading ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
              <Loader2 className="animate-spin" size={32} style={{ color: COLORS.textMuted }} />
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Scraping details...</span>
            </div>
          ) : detailsError ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
              <AlertTriangle size={36} style={{ color: COLORS.error }} />
              <h4 style={{ fontWeight: 600 }}>Failed to load lead details</h4>
              <button onClick={() => fetchLeadDetails(selectedLeadId, { force: true })} className="chip-fallback-btn">
                Retry Details
              </button>
            </div>
          ) : leadDetails ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              
              {/* Drawer Header */}
              {(() => {
                const stageInfo = STAGES.find(s => s.id === leadDetails.pipeline_stage) || STAGES[0];
                return (
                  <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', background: COLORS.white, flexShrink: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>{leadDetails.business_name}</h3>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', padding: '3px 10px', borderRadius: '20px', border: `1px solid ${stageInfo.color}55`, color: stageInfo.color, background: stageInfo.bg }}>
                            {stageInfo.label}
                          </span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', fontStyle: 'italic' }}>
                            Search Query: {leadDetails.source_query || 'no source query'}
                          </span>
                        </div>
                      </div>
                      <button onClick={() => handleSelectLead(null)} style={{ background: COLORS.white, border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-secondary)', padding: '6px', cursor: 'pointer', flexShrink: 0 }}>
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Drawer Content */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', minHeight: 0 }}>
                
                {/* Business & Contact Details Card */}
                <div className="glass-card" style={{ padding: '20px', border: '1px solid var(--border-color)' }}>
                  <h4 style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Building2 size={14} style={{ color: COLORS.textMuted }} />
                    Business Profile
                  </h4>
                  
                  {/* Prominent Business Info (Places Data) */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px', paddingBottom: '16px', borderBottom: '1px solid var(--border-color)', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Business Name</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>{leadDetails.business_name}</span>
                    </div>

                    {leadDetails.address && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Address</span>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>{leadDetails.address}</span>
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      {leadDetails.phone && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Phone</span>
                          <a href={`tel:${leadDetails.phone}`} style={{ fontSize: '0.82rem', color: COLORS.oldRose, fontWeight: 500 }}>{leadDetails.phone}</a>
                        </div>
                      )}

                      {leadDetails.website && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Website</span>
                          <a href={leadDetails.website} target="_blank" rel="noreferrer" style={{ fontSize: '0.82rem', color: COLORS.oldRose, display: 'flex', alignItems: 'center', gap: '3px', fontWeight: 500 }}>
                            Visit Website <Globe size={11} />
                          </a>
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      {leadDetails.rating && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Google Rating</span>
                          <span style={{ fontSize: '0.82rem', color: COLORS.warning, display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                            <Star size={12} style={{ fill: COLORS.warning }} /> {leadDetails.rating} / 5
                          </span>
                        </div>
                      )}

                      {leadDetails.open_status && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Status</span>
                          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: leadDetails.open_status === 'OPERATIONAL' ? COLORS.success : COLORS.warning }}>
                            {leadDetails.open_status}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Secondary Enrichment Contact Details */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <h5 style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)', margin: 0 }}>
                        Contact Details
                      </h5>
                      {leadDetails.website && (
                        <button
                          type="button"
                          onClick={handleEnrichFromWebsite}
                          disabled={enriching}
                          className="btn-primary"
                          style={{ padding: '4px 10px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          {enriching ? <Loader2 size={12} className="spin" /> : <Sparkles size={12} />}
                          {enriching ? 'Enriching…' : 'Enrich Website'}
                        </button>
                      )}
                    </div>

                    {(() => {
                      const hasEnrichmentData = !!(leadDetails.owner_name || leadDetails.manager_name || leadDetails.contact_email || leadDetails.contact_linkedin);
                      
                      if (!hasEnrichmentData) {
                        return (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
                            No additional contact details found.
                          </div>
                        );
                      }

                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.8rem' }}>
                          {leadDetails.owner_name && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Owner:</span>
                              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{leadDetails.owner_name}</span>
                            </div>
                          )}
                          {leadDetails.manager_name && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Manager:</span>
                              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{leadDetails.manager_name}</span>
                            </div>
                          )}
                          {leadDetails.contact_email && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Email:</span>
                              <a href={`mailto:${leadDetails.contact_email}`} style={{ color: COLORS.oldRose, fontWeight: 500 }}>{leadDetails.contact_email}</a>
                            </div>
                          )}
                          {leadDetails.contact_linkedin && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ color: 'var(--text-muted)' }}>LinkedIn:</span>
                              <a href={leadDetails.contact_linkedin} target="_blank" rel="noreferrer" style={{ color: COLORS.oldRose, display: 'flex', alignItems: 'center', gap: '3px', fontWeight: 500 }}>
                                View Profile <ArrowRight size={10} />
                              </a>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* AI Follow-Up Plans (Step 3.7 planning agent output) */}
                <div className="glass-card" style={{ padding: '20px', border: '1px solid var(--border-color)' }}>
                  <h4 style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Activity size={14} style={{ color: COLORS.textMuted }} />
                    Recommended Follow-Up Action
                  </h4>

                  {/* Stage-change banner — live from response data */}
                  {(() => {
                    const stageChangeEvent = leadDetails.events?.slice().reverse().find(e => e.event_type === 'stage_change' && e.from_stage);
                    if (!stageChangeEvent) return null;
                    const stageInfo = STAGES.find(s => s.id === stageChangeEvent.to_stage);
                    return (
                      <div style={{ background: `${stageInfo?.color || COLORS.neutral}11`, border: `1px solid ${stageInfo?.color || COLORS.neutral}33`, borderRadius: '8px', padding: '10px 14px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Activity size={14} style={{ color: stageInfo?.color || COLORS.neutral, flexShrink: 0 }} />
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                          AI reclassified: <strong>{stageChangeEvent.from_stage?.replace(/_/g,' ')}</strong> → <strong style={{ color: stageInfo?.color }}>{stageChangeEvent.to_stage?.replace(/_/g,' ')}</strong>
                        </span>
                      </div>
                    );
                  })()}
                  {(!leadDetails.follow_up_plans || leadDetails.follow_up_plans.length === 0) ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic', lineHeight: '1.4' }}>
                      No follow-up plan yet. Add a note below to trigger AI agents.
                    </p>
                  ) : (() => {
                    const plan = leadDetails.follow_up_plans[leadDetails.follow_up_plans.length - 1];
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: COLORS.warning, textTransform: 'uppercase', background: RGBA.amber08, padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(180, 83, 9, 0.18)' }}>
                            Suggested Channel: {plan.suggested_channel}
                          </span>
                          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{new Date(plan.created_at).toLocaleDateString()}</span>
                        </div>
                        <div style={{ background: COLORS.white, border: '1px solid var(--border-color)', borderRadius: '6px', padding: '12px', fontSize: '0.82rem', color: 'var(--text-primary)', lineHeight: '1.55' }}>
                          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>RECOMMENDED ACTION</div>
                          {plan.recommended_action}
                        </div>
                        <p style={{ fontSize: '0.73rem', color: 'var(--text-muted)', lineHeight: '1.45' }}><strong>Reasoning:</strong> {plan.reasoning}</p>
                      </div>
                    );
                  })()}
                </div>

                {/* Interaction History */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h4 style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <MessageSquare size={14} style={{ color: COLORS.textMuted }} />
                    Interaction History
                  </h4>

                  {/* Notes Timeline List */}
                  {(!leadDetails.notes || leadDetails.notes.length === 0) ? (
                    <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      No interaction notes captured yet.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {leadDetails.notes.slice().reverse().map((note) => (
                        <div 
                          key={note.id}
                          style={{
                            background: COLORS.white,
                            border: '1px solid var(--border-color)',
                            borderRadius: '8px',
                            padding: '12px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                            <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{note.author}</span>
                            <span>{new Date(note.created_at).toLocaleString()}</span>
                          </div>
                          <p style={{ fontSize: '0.8rem', color: 'var(--text-primary)', lineHeight: '1.4' }}>
                            {note.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Pipeline Event History log */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <h4 style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Clock size={14} style={{ color: COLORS.textMuted }} />
                    Audit Log Timeline
                  </h4>

                  {(!leadDetails.events || leadDetails.events.length === 0) ? (
                    <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      No event log.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderLeft: '1px solid var(--border-color)', paddingLeft: '14px', marginLeft: '6px' }}>
                      {leadDetails.events.slice().reverse().map((event) => (
                        <div key={event.id} style={{ position: 'relative', fontSize: '0.75rem' }}>
                          <div style={{
                            position: 'absolute',
                            left: '-19px',
                            top: '4px',
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: event.event_type === 'stage_change' ? COLORS.neutral : event.event_type === 'follow_up_generated' ? COLORS.warning : COLORS.text,
                            border: '1.5px solid #ffffff'
                          }}></div>
                          
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
                            {new Date(event.created_at).toLocaleString()}
                          </div>
                          <p style={{ color: 'var(--text-secondary)', marginTop: '2px', lineHeight: '1.4' }}>
                            {event.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>

              {/* Add Note Form (Fixed Bottom) */}
              <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', background: '#ffffff', zIndex: 10, flexShrink: 0 }}>
                <form onSubmit={handleAddNote} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <textarea
                    placeholder="Add interaction notes here (e.g. 'Spoke to owner, they requested pricing list next Tuesday')..."
                    value={newNoteContent}
                    onChange={(e) => setNewNoteContent(e.target.value)}
                    style={{
                      width: '100%',
                      background: COLORS.white,
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      padding: '12px',
                      fontSize: '0.8rem',
                      color: 'var(--text-primary)',
                      minHeight: '80px',
                      outline: 'none',
                      resize: 'vertical'
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <input 
                      type="text" 
                      placeholder="Author" 
                      value={noteAuthor} 
                      onChange={(e) => setNoteAuthor(e.target.value)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        borderBottom: '1px solid var(--border-color)',
                        color: 'var(--text-secondary)',
                        fontSize: '0.75rem',
                        outline: 'none',
                        width: '100px'
                      }}
                    />
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={noteSaving || !newNoteContent.trim()}
                      style={{ padding: '6px 14px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      {noteSaving ? <><Loader2 size={12} className="animate-spin" />Analyzing...</> : 'Add Note'}
                    </button>
                  </div>
                </form>
              </div>

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
