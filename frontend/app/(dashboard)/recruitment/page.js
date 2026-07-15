'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { individualShortLabel } from '../../../lib/avatar-labels';
import { LEAD_SEGMENTS, useIndividualSegment } from '../../../context/IndividualSegmentContext';
import { BRAND } from '../../../lib/brand';
import { COLORS, GRADIENT, RGBA } from '../../../lib/colors';
import IndividualSearchPanel from '../../../components/IndividualSearchPanel';
import DotScrollArea from '../../../components/DotScrollArea';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  API_CACHE_KEYS,
  fetchCachedJson,
  getApiCache,
  invalidateApiCache,
  setApiCache,
} from '../../../lib/api-cache';
import { getApiBaseUrl } from '../../../lib/apiBaseUrl';
import { 
  Send, Sparkles, AlertCircle, Search, MapPin, 
  Briefcase, Filter, X, RotateCcw, AlertTriangle, 
  CheckCircle2, ArrowUpRight, User, FileText, ChevronRight, Loader2,
  Clock, Activity, MessageSquare, TrendingUp, ArrowUpDown
} from 'lucide-react';

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name_asc', label: 'Name A → Z' },
  { value: 'name_desc', label: 'Name Z → A' },
  { value: 'company_asc', label: 'Company A → Z' },
  { value: 'status', label: 'Outreach status' },
];

function stripEmDashes(text) {
  if (!text) return '';
  return text.replace(/\s*[\u2014\u2013]\s*/g, ', ').trim();
}

function formatLeadInsight(text) {
  return stripEmDashes(text);
}

function RecruitmentWorkspaceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Selected state from URL
  const selectedLeadId = searchParams.get('leadId');
  const urlQuery = searchParams.get('q') || '';

  // Leads state
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Funnel dashboard state
  const [funnelData, setFunnelData] = useState({ chart: [], items: [] });
  const [funnelLoading, setFunnelLoading] = useState(true);
  const [funnelError, setFunnelError] = useState(false);
  const { leadSegment, setSegmentCounts } = useIndividualSegment();

  // Filters state
  const [textSearch, setTextSearch] = useState(urlQuery);
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'draft' | 'sent' | 'failed'
  const [sortBy, setSortBy] = useState('newest');
  const urlView = searchParams.get('view');
  const [workspaceSection, setWorkspaceSection] = useState(
    urlView === 'source' || urlView === 'analytics' ? urlView : 'leads'
  ); // source | leads | analytics
  const [listFiltersOpen, setListFiltersOpen] = useState(false);

  // Right pane details state
  const [activeTab, setActiveTab] = useState('profile'); // profile | compose | history | funnel
  const [selectedLeadDetails, setSelectedLeadDetails] = useState(null);
  const [draftMessage, setDraftMessage] = useState('');
  const [draftReasoning, setDraftReasoning] = useState('');
  const [rightLoading, setRightLoading] = useState(false);
  const [rightError, setRightError] = useState(false);
  const [noDraftExists, setNoDraftExists] = useState(false);
  const [sendChannel, setSendChannel] = useState('email'); // 'email' | 'sms' | 'both'
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [toast, setToast] = useState(null); // { message: string, type: 'success' | 'error' }

  // Show Toast Helper
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Pre-fill text search from URL if present
  useEffect(() => {
    if (urlQuery && !textSearch) {
      setTextSearch(urlQuery);
    }
  }, [urlQuery]);

  // Fetch leads
  const fetchLeads = async ({ force = false } = {}) => {
    if (!force) {
      const cached = getApiCache(API_CACHE_KEYS.avatar12Leads);
      if (cached) {
        const items = Array.isArray(cached) ? cached : (cached.items || []);
        setLeads(items);
        setLoading(false);
        void fetchLeads({ force: true });
        return;
      }
    }
    if (!force) setLoading(true);
    setError(false);
    try {
      const apiBaseUrl = getApiBaseUrl();
      const { data } = await fetchCachedJson(`${apiBaseUrl}/api/avatar12/leads`, {
        cacheKey: API_CACHE_KEYS.avatar12Leads,
        force: true,
      });
      const items = Array.isArray(data) ? data : (data.items || []);
      setLeads(items);
    } catch (err) {
      console.error(err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  // Fetch funnel statistics
  const fetchFunnelData = async ({ force = false } = {}) => {
    if (!force) {
      const cached = getApiCache(API_CACHE_KEYS.funnel);
      if (cached) {
        setFunnelData({
          chart: cached.chart || [],
          items: cached.items || [],
        });
        setFunnelLoading(false);
        void fetchFunnelData({ force: true });
        return;
      }
    }
    if (!force) setFunnelLoading(true);
    setFunnelError(false);
    try {
      const apiBaseUrl = getApiBaseUrl();
      const { data } = await fetchCachedJson(`${apiBaseUrl}/api/dashboard/funnel`, {
        cacheKey: API_CACHE_KEYS.funnel,
        force: true,
      });
      setFunnelData({
        chart: data.chart || [],
        items: data.items || [],
      });
    } catch (err) {
      console.error(err);
      setFunnelError(true);
    } finally {
      setFunnelLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
    fetchFunnelData();
  }, []);

  useEffect(() => {
    setSegmentCounts({
      avatar1: leads.filter((lead) => lead.avatar_type === 'avatar1').length,
      avatar2: leads.filter((lead) => lead.avatar_type === 'avatar2').length,
    });
  }, [leads, setSegmentCounts]);

  // Fetch selected lead details & latest draft when selectedLeadId changes
  useEffect(() => {
    if (!selectedLeadId) {
      setSelectedLeadDetails(null);
      setDraftMessage('');
      setDraftReasoning('');
      setNoDraftExists(false);
      return;
    }

    const loadRightPaneData = async () => {
      setRightLoading(true);
      setRightError(false);
      setNoDraftExists(false);
      setActiveTab('profile');

      try {
        const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000');
        
        // 1. Fetch Lead Details
        const leadRes = await fetch(`${apiBaseUrl}/api/avatar12/leads/${selectedLeadId}`);
        if (!leadRes.ok) throw new Error('Failed to fetch lead details');
        const leadData = await leadRes.json();
        setSelectedLeadDetails(leadData);
        setContactEmail(leadData.contact_email || '');
        setContactPhone(leadData.contact_phone || '');

        // 2. Fetch Latest Draft
        const draftRes = await fetch(`${apiBaseUrl}/api/avatar12/leads/${selectedLeadId}/drafts/latest`);
        
        if (draftRes.ok) {
          const draftData = await draftRes.json();
          setDraftMessage(stripEmDashes(draftData.message || ''));
          setDraftReasoning(draftData.reasoning || '');
        } else if (draftRes.status === 404) {
          // If latest drafts endpoint 404s, fall back to check drafts list in lead detail
          const draftsList = leadData.drafts || [];
          if (draftsList.length > 0) {
            const latest = draftsList[draftsList.length - 1];
            setDraftMessage(stripEmDashes(latest.message || ''));
            setDraftReasoning(latest.reasoning || '');
          } else {
            setNoDraftExists(true);
            setDraftMessage('');
            setDraftReasoning('');
          }
        } else {
          throw new Error('Failed to load latest draft');
        }
      } catch (err) {
        console.error(err);
        setRightError(true);
      } finally {
        setRightLoading(false);
      }
    };

    loadRightPaneData();
  }, [selectedLeadId]);

  useEffect(() => {
    if (activeTab !== 'history' || !selectedLeadDetails) return;
    const status = selectedLeadDetails.drafts?.[selectedLeadDetails.drafts.length - 1]?.status || 'draft';
    if (status !== 'sent') {
      setActiveTab('compose');
    }
  }, [activeTab, selectedLeadDetails]);

  // Update URL search parameters when selecting a lead
  const handleSelectLead = (leadId) => {
    const params = new URLSearchParams(searchParams.toString());
    if (leadId) {
      params.set('leadId', leadId);
    } else {
      params.delete('leadId');
    }
    if (textSearch) {
      params.set('q', textSearch);
    } else {
      params.delete('q');
    }
    router.push(`?${params.toString()}`);
  };

  // Clear selected lead when switching between job seekers and upgraders
  useEffect(() => {
    if (!selectedLeadId) return;
    const lead = leads.find((item) => String(item.id) === String(selectedLeadId));
    if (lead && lead.avatar_type !== leadSegment) {
      handleSelectLead('');
    }
  }, [leadSegment, selectedLeadId, leads]);

  // Reset Filters
  const handleResetFilters = () => {
    setTextSearch('');
    setStatusFilter('all');
    setSortBy('newest');
    
    const params = new URLSearchParams(searchParams.toString());
    params.delete('q');
    if (selectedLeadId) {
      params.set('leadId', selectedLeadId);
    }
    router.push(`?${params.toString()}`);
  };

  // Sync text search state with URL query param
  const handleSearchChange = (e) => {
    const val = e.target.value;
    setTextSearch(val);
    
    const params = new URLSearchParams(searchParams.toString());
    if (val.trim()) {
      params.set('q', val);
    } else {
      params.delete('q');
    }
    router.push(`?${params.toString()}`);
  };

  // Dispatch message sender
  const handleSendOutreach = async () => {
    if (!selectedLeadId) return;

    const channels = sendChannel === 'both' ? ['email', 'sms'] : [sendChannel];

    try {
      const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000');
      const sendRes = await fetch(`${apiBaseUrl}/api/avatar12/leads/${selectedLeadId}/messages/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          channels,
          message: draftMessage,
          to_email: contactEmail || undefined,
          to_phone: contactPhone || undefined,
        })
      });

      if (!sendRes.ok) {
        const errBody = await sendRes.json().catch(() => ({}));
        throw new Error(errBody.detail || 'Failed to dispatch outreach message.');
      }

      const resData = await sendRes.json();
      const deliveryNote = resData.delivery?.map((d) => d.detail).filter(Boolean).join(' · ');
      
      showToast(deliveryNote ? `Message sent. ${deliveryNote}` : 'Outreach message sent successfully!');
      
      // Update local leads list status in-memory for instant feedback
      setLeads(prev => {
        const next = prev.map(l => {
          if (l.id === selectedLeadId) {
            return {
              ...l,
              latest_draft: {
                ...(l.latest_draft || {}),
                status: 'sent',
                message: draftMessage
              }
            };
          }
          return l;
        });
        setApiCache(API_CACHE_KEYS.avatar12Leads, { items: next });
        return next;
      });

      // Update selected lead details in-memory
      setSelectedLeadDetails(prev => {
        if (!prev) return null;
        const updatedDrafts = prev.drafts ? [...prev.drafts] : [];
        if (updatedDrafts.length > 0) {
          updatedDrafts[updatedDrafts.length - 1].status = 'sent';
          updatedDrafts[updatedDrafts.length - 1].message = draftMessage;
        } else {
          updatedDrafts.push({
            id: 'new',
            status: 'sent',
            message: draftMessage,
            reasoning: 'Draft created from scratch.',
            created_at: new Date().toISOString()
          });
        }
        return {
          ...prev,
          drafts: updatedDrafts
        };
      });

      // Reload funnel aggregates to reflect dispatch update
      fetchFunnelData();

    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to dispatch message.', 'error');
    }
  };

  // Filtering and sorting leads on client-side
  const filteredLeads = useMemo(() => {
    const filtered = leads.filter(lead => {
      const query = textSearch.toLowerCase().trim();
      if (query) {
        const nameMatch = lead.name?.toLowerCase().includes(query);
        const headlineMatch = lead.headline?.toLowerCase().includes(query);
        const companyMatch = lead.company?.toLowerCase().includes(query);
        const locationMatch = lead.location?.toLowerCase().includes(query);
        const promptMatch = lead.search_prompt?.toLowerCase().includes(query);
        if (!nameMatch && !headlineMatch && !companyMatch && !locationMatch && !promptMatch) {
          return false;
        }
      }

      if (lead.avatar_type !== leadSegment) {
        return false;
      }

      const draftStatus = lead.latest_draft?.status || 'draft';
      if (statusFilter !== 'all' && draftStatus !== statusFilter) {
        return false;
      }

      return true;
    });

    const statusRank = { draft: 0, sent: 1, failed: 2 };
    const sorted = [...filtered];

    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'oldest':
          return new Date(a.created_at || 0) - new Date(b.created_at || 0);
        case 'name_asc':
          return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
        case 'name_desc':
          return (b.name || '').localeCompare(a.name || '', undefined, { sensitivity: 'base' });
        case 'company_asc':
          return (a.company || '').localeCompare(b.company || '', undefined, { sensitivity: 'base' });
        case 'status': {
          const aStatus = statusRank[a.latest_draft?.status || 'draft'] ?? 0;
          const bStatus = statusRank[b.latest_draft?.status || 'draft'] ?? 0;
          return aStatus - bStatus || new Date(b.created_at || 0) - new Date(a.created_at || 0);
        }
        case 'newest':
        default:
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
    });

    return sorted;
  }, [leads, textSearch, leadSegment, statusFilter, sortBy]);

  // Calculate aggregate funnel metrics for the active segment
  const aggregateItems = funnelData.items.filter((item) => item.avatar_type === leadSegment);

  const totals = aggregateItems.reduce((acc, item) => {
    acc.link_clicked += item.link_clicked || 0;
    acc.form_started += item.form_started || 0;
    acc.form_submitted += item.form_submitted || 0;
    acc.meeting_booked += item.meeting_booked || 0;
    return acc;
  }, { link_clicked: 0, form_started: 0, form_submitted: 0, meeting_booked: 0 });

  const activeFilterCount = [
    textSearch,
    statusFilter !== 'all' ? statusFilter : '',
  ].filter(Boolean).length;

  const activeSegmentMeta = LEAD_SEGMENTS.find((segment) => segment.id === leadSegment) || LEAD_SEGMENTS[0];

  const workspaceSections = [
    { id: 'source', label: 'Find New Leads', icon: Search, desc: 'Search for and source fresh individual prospects' },
    { id: 'leads', label: 'Outreach Drafts', icon: FileText, desc: 'Review, edit, and send personalized outreach drafts' },
    { id: 'analytics', label: 'Track Sent', icon: TrendingUp, desc: 'Monitor how sent drafts perform after delivery' },
  ];

  const leadDetailTabs = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'compose', label: 'Compose', icon: MessageSquare },
    { id: 'history', label: 'Sent Review', icon: Clock, sentOnly: true },
    { id: 'funnel', label: 'Funnel', icon: Activity },
  ];

  const latestDraftStatus = selectedLeadDetails?.drafts?.[selectedLeadDetails.drafts.length - 1]?.status || 'draft';
  const isLatestDraftSent = latestDraftStatus === 'sent';
  const visibleLeadDetailTabs = leadDetailTabs.filter((tab) => !tab.sentOnly || isLatestDraftSent);

  const hasAnyFunnelActivity = totals.link_clicked > 0 || totals.form_started > 0 || totals.form_submitted > 0 || totals.meeting_booked > 0;

  const renderAnalyticsPanel = () => {
    if (funnelLoading) {
      return (
        <div className="individual-analytics-loading">
          <Loader2 className="animate-spin" size={32} style={{ color: COLORS.oldRose }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading sent draft tracking...</span>
        </div>
      );
    }
    if (funnelError) {
      return (
        <div className="individual-analytics-loading">
          <AlertTriangle size={36} style={{ color: COLORS.error }} />
          <h4 style={{ fontWeight: 600 }}>Failed to load sent draft tracking</h4>
          <button type="button" onClick={fetchFunnelData} className="chip-fallback-btn">Retry Load</button>
        </div>
      );
    }
    return (
      <div className="individual-analytics">
        <header className="individual-analytics__header">
          <div>
            <h3 className="individual-analytics__title">
              <TrendingUp size={20} aria-hidden="true" />
              Sent Draft Performance
            </h3>
            <p className="individual-analytics__subtitle">
              Track clicks, intake progress, and meetings for {activeSegmentMeta.label.toLowerCase()} you&apos;ve already sent.
            </p>
          </div>
        </header>

        {!hasAnyFunnelActivity ? (
          <div className="individual-analytics__empty glass-card">
            <TrendingUp size={40} aria-hidden="true" />
            <div>
              <h4>No sent draft activity yet</h4>
              <p>
                Once you send {activeSegmentMeta.label.toLowerCase()} outreach, responses will show up here.
              </p>
            </div>
          </div>
        ) : (
          <div className="individual-analytics__metrics" role="list" aria-label="Response stages after send">
            {[
              { stage: 'Clicks', count: totals.link_clicked, suffix: 'clicks' },
              { stage: 'Starts', count: totals.form_started, suffix: 'started' },
              { stage: 'Submits', count: totals.form_submitted, suffix: 'submitted' },
              { stage: 'Booked', count: totals.meeting_booked, suffix: 'booked' },
            ].map((step) => (
              <div key={step.stage} className="individual-analytics__metric" role="listitem">
                <span className="individual-analytics__metric-label">{step.stage}</span>
                <span className="individual-analytics__metric-value">{step.count}</span>
                <span className="individual-analytics__metric-suffix">{step.suffix}</span>
              </div>
            ))}
          </div>
        )}

        <div className="glass-card individual-analytics__table-card">
          <div className="individual-analytics__table-head">
            <h4>Sent draft activity by candidate</h4>
            <span>{aggregateItems.length} records</span>
          </div>
          <DotScrollArea className="individual-analytics__table-scroll results-table-scroll">
            <table className="results-table results-table--compact">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Type</th>
                  <th className="results-table__num">Clicks</th>
                  <th className="results-table__num">Starts</th>
                  <th className="results-table__num">Submits</th>
                  <th className="results-table__num">Booked</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {aggregateItems.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="results-table__empty">
                      No {activeSegmentMeta.label.toLowerCase()} with sent draft activity yet.
                    </td>
                  </tr>
                ) : (
                  aggregateItems.map((item) => (
                    <tr
                      key={item.lead_id}
                      onClick={() => { handleSelectLead(item.lead_id); setWorkspaceSection('leads'); }}
                      className="results-table__row--clickable"
                    >
                      <td>
                        <div className="results-table__primary">{item.name}</div>
                        <div className="results-table__secondary">{item.headline || item.role}</div>
                      </td>
                      <td>
                        <span className="segment-type-badge">{individualShortLabel(item.avatar_type)}</span>
                      </td>
                      <td className="results-table__num">{item.link_clicked || 0}</td>
                      <td className="results-table__num">{item.form_started || 0}</td>
                      <td className="results-table__num">{item.form_submitted || 0}</td>
                      <td className="results-table__num">{item.meeting_booked || 0}</td>
                      <td className="results-table__muted">
                        {item.latest_event_at
                          ? new Date(item.latest_event_at).toLocaleDateString()
                          : 'N/A'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </DotScrollArea>
        </div>
      </div>
    );
  };

  return (
    <div className="workspace-page workspace-page--recruitment">
      {toast && (
        <div className={`workspace-toast workspace-toast--${toast.type}`}>
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{toast.message}</span>
        </div>
      )}

      <header className="individual-page-header">
        <nav className="individual-workspace-nav" aria-label="Individual outreach workflow">
          {workspaceSections.map((section) => {
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

      {workspaceSection === 'source' && (
        <div className="individual-section individual-section--source">
          <IndividualSearchPanel
            activeSegment={leadSegment}
            onComplete={() => {
              invalidateApiCache([API_CACHE_KEYS.avatar12Leads, API_CACHE_KEYS.funnel]);
              fetchLeads({ force: true });
              fetchFunnelData({ force: true });
              setWorkspaceSection('leads');
            }}
          />
        </div>
      )}

      {workspaceSection === 'leads' && (
      <div className={`workspace-split${selectedLeadId ? ' workspace-split--detail-open' : ''}`}>
      <div className="workspace-list-pane">
        
        {/* List header: search + collapsible filters */}
        <div className="individual-list-header">
          <div className="individual-list-header__top">
            <h3 className="individual-list-header__title">Outreach Drafts</h3>
            <span className="individual-list-header__count">{filteredLeads.length} · {activeSegmentMeta.shortLabel}</span>
          </div>

          <div className="individual-list-toolbar">
            <div className="individual-list-toolbar__search">
              <Search size={16} className="individual-list-toolbar__search-icon" aria-hidden="true" />
              <input 
                type="text" 
                placeholder="Search name or role…" 
                value={textSearch}
                onChange={handleSearchChange}
                className="individual-list-search"
              />
              {textSearch && (
                <button 
                  type="button"
                  onClick={() => {
                    setTextSearch('');
                    const params = new URLSearchParams(searchParams.toString());
                    params.delete('q');
                    router.push(`?${params.toString()}`);
                  }}
                  className="individual-list-search__clear"
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="individual-list-toolbar__actions">
              <button
                type="button"
                className={`individual-list-icon-btn${listFiltersOpen ? ' individual-list-icon-btn--active' : ''}`}
                onClick={() => setListFiltersOpen((open) => !open)}
                aria-expanded={listFiltersOpen}
                aria-label={`Filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ''}`}
              >
                <Filter size={16} />
                {activeFilterCount > 0 && (
                  <span className="individual-list-filters-toggle__badge">{activeFilterCount}</span>
                )}
              </button>

              <div className="individual-list-sort-wrap">
                <select
                  className="individual-list-sort"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  aria-label={`Sort drafts: ${SORT_OPTIONS.find((option) => option.value === sortBy)?.label || 'Newest first'}`}
                  title={SORT_OPTIONS.find((option) => option.value === sortBy)?.label || 'Newest first'}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <ArrowUpDown size={16} className="individual-list-sort-wrap__icon" aria-hidden="true" />
              </div>
            </div>
          </div>

          {listFiltersOpen && (
          <div className="individual-list-filters-panel">
          {/* Status Filter Selector */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Status:</span>
            <div style={{ display: 'flex', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '2px', border: '1px solid var(--border-color)' }}>
              {['draft', 'sent'].map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  style={{
                    background: statusFilter === status ? '#ffffff' : 'transparent',
                    border: statusFilter === status ? '1px solid var(--border-color)' : '1px solid transparent',
                    borderRadius: '6px',
                    color: statusFilter === status ? COLORS.oldRose : 'var(--text-secondary)',
                    padding: '4px 10px',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textTransform: 'capitalize'
                  }}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          {/* Filter stats & clear option */}
          {(textSearch || statusFilter !== 'all' || sortBy !== 'newest') && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <span>Filtered: {filteredLeads.length} of {leads.length} drafts</span>
              <button 
                type="button"
                onClick={handleResetFilters}
                style={{ background: 'none', border: 'none', color: COLORS.oldRose, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: 0 }}
              >
                <RotateCcw size={12} />
                Reset Filters
              </button>
            </div>
          )}
          </div>
          )}
        </div>

        {/* Scrollable list content */}
        <DotScrollArea className="workspace-list-pane__scroll">
          {loading ? (
            /* Skeleton list loader */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[1, 2, 3, 4, 5].map((idx) => (
                <div key={idx} className="glass-card" style={{ padding: '16px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span className="skeleton-shimmer skeleton-text" style={{ width: '120px', height: '16px' }}></span>
                    <span className="skeleton-shimmer skeleton-text" style={{ width: '60px', height: '14px' }}></span>
                  </div>
                  <div className="skeleton-shimmer skeleton-text" style={{ width: '180px', height: '12px', marginBottom: '6px' }}></div>
                  <div className="skeleton-shimmer skeleton-text" style={{ width: '100px', height: '12px' }}></div>
                </div>
              ))}
            </div>
          ) : error ? (
            /* Error state with retry */
            <div style={{ textAlign: 'center', padding: '32px 16px', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
              <AlertTriangle size={32} style={{ color: COLORS.error }} />
              <div>
                <h5 style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '4px' }}>Failed to load drafts</h5>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Verify FastAPI backend server on port 8000 is active.</p>
              </div>
              <button onClick={() => fetchLeads({ force: true })} className="chip-fallback-btn" style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <RotateCcw size={12} />
                Retry Fetch
              </button>
            </div>
          ) : leads.length === 0 ? (
            /* Empty state pointing to Home */
            <div style={{ textAlign: 'center', padding: '40px 16px', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
              <Briefcase size={40} style={{ color: 'var(--text-muted)' }} />
              <div>
                <h5 style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '6px' }}>No {activeSegmentMeta.label.toLowerCase()} drafts yet</h5>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: '1.4', maxWidth: '280px' }}>
                  Head to Find New Leads to search for {activeSegmentMeta.label.toLowerCase()}. New matches will appear here as drafts ready to review and send.
                </p>
              </div>
              <button type="button" onClick={() => setWorkspaceSection('source')} className="btn-primary" style={{ padding: '8px 16px', fontSize: '0.75rem' }}>
                Find new leads
              </button>
            </div>
          ) : filteredLeads.length === 0 ? (
            /* Empty state for active filter */
            <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              No drafts match your search or filters.
            </div>
          ) : (
            /* Leads list */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredLeads.map((lead) => {
                const isActive = lead.id === selectedLeadId;
                const draftStatus = lead.latest_draft?.status || 'draft';
                
                return (
                  <div
                    key={lead.id}
                    onClick={() => handleSelectLead(lead.id)}
                    style={{
                      background: isActive ? 'rgba(75, 85, 99, 0.04)' : '#ffffff',
                      border: `1px solid ${isActive ? COLORS.oldRose : 'var(--border-color)'}`,
                      borderRadius: '12px',
                      padding: '16px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      boxShadow: isActive ? '0 0 0 3px rgba(75, 85, 99, 0.08)' : 'none'
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) e.currentTarget.style.borderColor = 'var(--border-hover)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) e.currentTarget.style.borderColor = 'var(--border-color)';
                    }}
                  >
                    {/* Name + Status badge row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '6px' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {lead.name}
                      </span>
                      
                      {/* Status badge */}
                      <span style={{
                        fontSize: '0.65rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        padding: '2px 8px',
                        borderRadius: '6px',
                        border: `1px solid ${
                          draftStatus === 'sent' ? RGBA.success20 : 
                          draftStatus === 'failed' ? 'rgba(184, 107, 107, 0.25)' : 
                          'rgba(75, 85, 99, 0.25)'
                        }`,
                        background: `${
                          draftStatus === 'sent' ? RGBA.success06 : 
                          draftStatus === 'failed' ? 'rgba(184, 107, 107, 0.06)' : 
                          'rgba(75, 85, 99, 0.06)'
                        }`,
                        color: `${
                          draftStatus === 'sent' ? COLORS.success : 
                          draftStatus === 'failed' ? COLORS.error : 
                          COLORS.oldRose
                        }`
                      }}>
                        {draftStatus}
                      </span>
                    </div>

                    {/* Headline / Role description */}
                    <div style={{ 
                      fontSize: '0.75rem', 
                      color: 'var(--text-secondary)', 
                      marginBottom: '10px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {lead.headline || lead.role || 'Sales Professional'}
                    </div>

                    <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginBottom: '8px', fontStyle: 'italic' }}>
                      Query: {lead.source_query || 'no source query'}
                    </div>

                    {/* Bottom badges: Location & Avatar badge */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem' }}>
                      <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <MapPin size={10} />
                        {lead.location || 'US'}
                      </span>

                      {/* Avatar badge */}
                      <span className="segment-type-badge">
                        {individualShortLabel(lead.avatar_type)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DotScrollArea>
      </div>

      {/* Right Pane: Selected Details or Aggregate Funnel Analytics Dashboard */}
      <div className="workspace-detail-pane">
        {selectedLeadId ? (
          /* LEAD SPECIFIC VIEW */
          rightLoading ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
              <Loader2 className="animate-spin" size={32} style={{ color: COLORS.oldRose }} />
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading lead details...</span>
            </div>
          ) : rightError ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
              <AlertTriangle size={36} style={{ color: COLORS.error }} />
              <h4 style={{ fontWeight: 600 }}>Failed to load details</h4>
              <button 
                onClick={() => {
                  const lid = selectedLeadId;
                  handleSelectLead('');
                  setTimeout(() => handleSelectLead(lid), 50);
                }} 
                className="chip-fallback-btn"
              >
                Retry
              </button>
            </div>
          ) : selectedLeadDetails ? (
            <div className="individual-lead-detail">
              <div className="individual-lead-detail__header">
                <div className="individual-lead-detail__header-main">
                  <h3 className="individual-lead-detail__name">{selectedLeadDetails.name}</h3>
                  <div className="individual-lead-detail__meta">
                    <span className="individual-lead-detail__type-badge">
                      {individualShortLabel(selectedLeadDetails.avatar_type)}
                    </span>
                    <span className={`individual-lead-detail__status individual-lead-detail__status--${(selectedLeadDetails.drafts?.[selectedLeadDetails.drafts.length - 1]?.status || 'draft')}`}>
                      {selectedLeadDetails.drafts?.[selectedLeadDetails.drafts.length - 1]?.status || 'draft'}
                    </span>
                  </div>
                </div>
                <button type="button" onClick={() => handleSelectLead('')} className="individual-lead-detail__close" aria-label="Close">
                  <X size={18} />
                </button>
              </div>

              <nav className="individual-lead-tabs" aria-label="Lead detail sections">
                {visibleLeadDetailTabs.map((tab) => {
                  const TabIcon = tab.icon;
                  const isTabActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      className={`individual-lead-tabs__tab${isTabActive ? ' individual-lead-tabs__tab--active' : ''}`}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      <TabIcon size={14} />
                      {tab.label}
                    </button>
                  );
                })}
              </nav>

              <DotScrollArea className="individual-lead-detail__body">
              {activeTab === 'profile' && (
                <div className="individual-lead-profile">
                  <p className="individual-lead-profile__headline">
                    {selectedLeadDetails.headline || selectedLeadDetails.role || 'Sales Professional'}
                  </p>

                  <dl className="individual-lead-profile__facts">
                    {selectedLeadDetails.company && (
                      <div className="individual-lead-profile__fact">
                        <dt>Company</dt>
                        <dd>{selectedLeadDetails.company}</dd>
                      </div>
                    )}
                    <div className="individual-lead-profile__fact">
                      <dt>Location</dt>
                      <dd>{selectedLeadDetails.location || 'US'}</dd>
                    </div>
                    {selectedLeadDetails.linkedin_url && (
                      <div className="individual-lead-profile__fact">
                        <dt>LinkedIn</dt>
                        <dd>
                          <a
                            href={selectedLeadDetails.linkedin_url}
                            target="_blank"
                            rel="noreferrer"
                            className="individual-lead-profile__link"
                          >
                            View profile
                            <ArrowUpRight size={12} aria-hidden="true" />
                          </a>
                        </dd>
                      </div>
                    )}
                  </dl>

                  <div className="individual-lead-profile__source">
                    <span className="individual-lead-profile__source-label">Sourced via</span>
                    <p>{selectedLeadDetails.source_query || 'No source query'}</p>
                    {selectedLeadDetails.search_prompt && (
                      <p className="individual-lead-profile__prompt">&ldquo;{selectedLeadDetails.search_prompt}&rdquo;</p>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'compose' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Email compose card */}
                  <div style={{ 
                    background: '#ffffff', 
                    border: '1px solid var(--border-color)', 
                    borderRadius: '12px', 
                    overflow: 'hidden',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.04)'
                  }}>
                    {/* Email header — To: line */}
                    <div style={{ 
                      padding: '14px 20px', 
                      borderBottom: '1px solid var(--border-color)', 
                      background: COLORS.white,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '0.85rem'
                    }}>
                      <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>To:</span>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {selectedLeadDetails.name}
                      </span>
                      {selectedLeadDetails.linkedin_url && (
                        <>
                          <span style={{ color: 'var(--text-muted)' }}>·</span>
                          <a 
                            href={selectedLeadDetails.linkedin_url} 
                            target="_blank" 
                            rel="noreferrer"
                            style={{ color: COLORS.oldRose, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '3px' }}
                          >
                            LinkedIn <ArrowUpRight size={10} />
                          </a>
                        </>
                      )}
                      {noDraftExists && (
                        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', background: RGBA.amber08, color: COLORS.warning, padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(180,83,9,0.15)', fontWeight: 600 }}>
                          No AI Draft
                        </span>
                      )}
                    </div>

                    {/* From line */}
                    <div style={{ 
                      padding: '10px 20px', 
                      borderBottom: '1px solid var(--border-color)', 
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '0.82rem'
                    }}>
                      <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>From:</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{BRAND.senderName}</span>
                    </div>
                    
                    {/* Delivery channel & contact */}
                    <div style={{ 
                      padding: '12px 20px', 
                      borderBottom: '1px solid var(--border-color)', 
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '12px',
                      alignItems: 'center',
                      fontSize: '0.82rem'
                    }}>
                      <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Send via:</span>
                      {['email', 'sms', 'both'].map((ch) => (
                        <button
                          key={ch}
                          type="button"
                          onClick={() => setSendChannel(ch)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            border: sendChannel === ch ? `1px solid ${COLORS.oldRose}` : '1px solid var(--border-color)',
                            background: sendChannel === ch ? RGBA.neutral06 : '#fff',
                            color: sendChannel === ch ? COLORS.oldRose : 'var(--text-secondary)',
                            fontWeight: sendChannel === ch ? 600 : 500,
                            cursor: 'pointer',
                            textTransform: 'uppercase',
                            fontSize: '0.72rem',
                          }}
                        >
                          {ch === 'both' ? 'Email + SMS' : ch}
                        </button>
                      ))}
                    </div>
                    <div className="form-grid-2" style={{ 
                      padding: '10px 20px', 
                      borderBottom: '1px solid var(--border-color)', 
                    }}>
                      <div>
                        <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Email</label>
                        <input
                          type="email"
                          value={contactEmail}
                          onChange={(e) => setContactEmail(e.target.value)}
                          placeholder="lead@example.com"
                          style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.82rem' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Phone (SMS)</label>
                        <input
                          type="tel"
                          value={contactPhone}
                          onChange={(e) => setContactPhone(e.target.value)}
                          placeholder="+1 555 000 0000"
                          style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.82rem' }}
                        />
                      </div>
                    </div>

                    {/* Message body — editable textarea */}
                    <textarea
                      value={draftMessage}
                      onChange={(e) => setDraftMessage(e.target.value)}
                      placeholder="Compose your outreach message here..."
                      style={{
                        width: '100%',
                        background: '#ffffff',
                        border: 'none',
                        padding: '20px',
                        fontFamily: 'inherit',
                        lineHeight: '1.7',
                        fontSize: '0.92rem',
                        color: 'var(--text-primary)',
                        minHeight: '240px',
                        outline: 'none',
                        resize: 'vertical',
                        display: 'block'
                      }}
                    />

                    <div className="individual-compose-footer">
                      <span className="individual-compose-footer__count">
                        {draftMessage.length} characters
                      </span>
                      {(selectedLeadDetails.drafts?.[selectedLeadDetails.drafts.length - 1]?.status || 'draft') === 'sent' ? (
                        <span className="individual-compose-footer__sent">
                          <CheckCircle2 size={16} />
                          Sent
                        </span>
                      ) : (
                        <button
                          className="btn-primary individual-compose-footer__send"
                          onClick={handleSendOutreach}
                        >
                          <Send size={14} />
                          Send
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Lead profile insight from sourcing */}
                  {draftReasoning && (
                    <div style={{ padding: '16px 20px', background: COLORS.white, border: '1px solid var(--border-color)', borderRadius: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--text-primary)' }}>
                        <Sparkles size={14} style={{ color: COLORS.textMuted }} />
                        <h4 style={{ fontWeight: 600, fontSize: '0.85rem' }}>What we learned about this lead</h4>
                      </div>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: '1.5' }}>
                        {formatLeadInsight(draftReasoning)}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Sent review — only available after outreach is sent */}
              {activeTab === 'history' && isLatestDraftSent && (
                <div className="glass-card" style={{ padding: '24px', border: '1px solid var(--border-color)' }}>
                  <h4 style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Clock size={16} style={{ color: COLORS.oldRose }} />
                    Sent Review
                  </h4>
                  
                  {(!selectedLeadDetails.drafts || selectedLeadDetails.drafts.length === 0) ? (
                    <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      No sent outreach recorded for this prospect.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative', borderLeft: '1px solid var(--border-color)', paddingLeft: '20px', marginLeft: '10px' }}>
                      {selectedLeadDetails.drafts.slice().reverse().map((draft, idx) => (
                        <div key={draft.id || idx} style={{ position: 'relative' }}>
                          <div style={{
                            position: 'absolute',
                            left: '-26px',
                            top: '4px',
                            width: '10px',
                            height: '10px',
                            borderRadius: '50%',
                            background: draft.status === 'sent' ? COLORS.success : COLORS.oldRose,
                            border: '2px solid #ffffff'
                          }}></div>
                          
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <span style={{ fontWeight: 600, color: draft.status === 'sent' ? COLORS.success : COLORS.oldRose }}>
                              {draft.status.toUpperCase()}
                            </span>
                            <span>
                              {draft.created_at ? new Date(draft.created_at).toLocaleString() : 'Recent'}
                            </span>
                          </div>
                          
                          <div style={{
                            background: COLORS.white,
                            border: '1px solid var(--border-color)',
                            borderRadius: '8px',
                            padding: '12px 16px',
                            fontSize: '0.85rem',
                            color: 'var(--text-secondary)',
                            whiteSpace: 'pre-wrap'
                          }}>
                            {stripEmDashes(draft.message)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 3. FUNNEL TAB */}
              {activeTab === 'funnel' && (
                <div className="glass-card" style={{ padding: '24px', border: '1px solid var(--border-color)' }}>
                  <h4 style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Activity size={16} style={{ color: COLORS.oldRose }} />
                    Individual Intake Funnel
                  </h4>
                  
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '32px', lineHeight: '1.6' }}>
                    Outreach messages include custom trackable intake forms and scheduling links. Future modules will capture real-time user metrics dynamically.
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    {[
                      { label: 'Outreach Dispatched', desc: 'Personalized outreach message sent.', completed: (selectedLeadDetails.drafts?.[selectedLeadDetails.drafts.length - 1]?.status === 'sent') },
                      { label: 'Link Clicked', desc: 'Prospect opened the custom landing page link.', completed: false },
                      { label: 'Intake Form Started', desc: 'Prospect initiated form questions.', completed: false },
                      { label: 'Form Submitted', desc: 'Lead submitted license details & experience.', completed: false },
                      { label: 'Meeting Scheduled', desc: 'Calendar booking completed via workspace integrations.', completed: false }
                    ].map((step, index) => (
                      <div key={index} style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <div style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            background: step.completed ? RGBA.success06 : COLORS.white,
                            border: `2px solid ${step.completed ? COLORS.success : 'var(--border-color)'}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: step.completed ? COLORS.success : 'var(--text-muted)',
                            fontSize: '0.75rem',
                            fontWeight: 'bold'
                          }}>
                            {step.completed ? '✓' : index + 1}
                          </div>
                          {index < 4 && (
                            <div style={{
                              width: '2px',
                              height: '32px',
                              background: 'var(--border-color)',
                              marginTop: '4px'
                            }}></div>
                          )}
                        </div>
                        <div>
                          <h5 style={{ fontWeight: 600, fontSize: '0.85rem', color: step.completed ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                            {step.label}
                          </h5>
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {step.desc}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              </DotScrollArea>
            </div>
          ) : null
        ) : (
          <div className="individual-pipeline-empty">
            <FileText size={40} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
            <h4>Select a draft to work on</h4>
            <p>Pick someone from your draft queue to review their profile, finish the message, or send outreach.</p>
            <button type="button" className="btn-primary individual-pipeline-empty__cta" onClick={() => setWorkspaceSection('source')}>
              <Search size={14} />
              Find new leads
            </button>
          </div>
        )}
      </div>

      </div>
      )}

      {workspaceSection === 'analytics' && (
        <div className="individual-section individual-section--analytics">
          {renderAnalyticsPanel()}
        </div>
      )}

    </div>
  );
}

export default function RecruitmentPage() {
  return (
    <Suspense fallback={
      <div className="glass-card" style={{ padding: '40px', textAlign: 'center', background: COLORS.white }}>
        <Loader2 className="animate-spin" size={24} style={{ color: COLORS.oldRose, margin: '0 auto 12px' }} />
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading Workspace...</span>
      </div>
    }>
      <RecruitmentWorkspaceContent />
    </Suspense>
  );
}
