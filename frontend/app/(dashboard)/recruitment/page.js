'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { individualLabel } from '../../../lib/avatar-labels';
import { BRAND } from '../../../lib/brand';
import { COLORS, GRADIENT, RGBA } from '../../../lib/colors';
import IndividualSearchPanel from '../../../components/IndividualSearchPanel';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
  Send, Sparkles, AlertCircle, Search, MapPin, 
  Briefcase, Filter, X, RotateCcw, AlertTriangle, 
  CheckCircle2, ArrowUpRight, User, FileText, ChevronRight, Loader2,
  Clock, Activity, MessageSquare, BarChart3, TrendingUp, Calendar, ArrowUpDown
} from 'lucide-react';

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name_asc', label: 'Name A → Z' },
  { value: 'name_desc', label: 'Name Z → A' },
  { value: 'company_asc', label: 'Company A → Z' },
  { value: 'status', label: 'Outreach status' },
];

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
  const [aggregateAvatarFilter, setAggregateAvatarFilter] = useState('all'); // 'all' | 'avatar1' | 'avatar2'

  // Filters state
  const [textSearch, setTextSearch] = useState(urlQuery);
  const [avatarFilter, setAvatarFilter] = useState('all'); // 'all' | 'avatar1' | 'avatar2'
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'draft' | 'sent' | 'failed'
  const [sortBy, setSortBy] = useState('newest');
  const [workspaceSection, setWorkspaceSection] = useState('leads'); // source | leads | analytics
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
  const fetchLeads = async () => {
    setLoading(true);
    setError(false);
    try {
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
      const res = await fetch(`${apiBaseUrl}/api/avatar12/leads`);
      if (!res.ok) throw new Error('Failed to load leads');
      const data = await res.json();
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
  const fetchFunnelData = async () => {
    setFunnelLoading(true);
    setFunnelError(false);
    try {
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
      const res = await fetch(`${apiBaseUrl}/api/dashboard/funnel`);
      if (!res.ok) throw new Error('Failed to load funnel analytics');
      const data = await res.json();
      setFunnelData({
        chart: data.chart || [],
        items: data.items || []
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
        const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
        
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
          setDraftMessage(draftData.message || '');
          setDraftReasoning(draftData.reasoning || '');
        } else if (draftRes.status === 404) {
          // If latest drafts endpoint 404s, fall back to check drafts list in lead detail
          const draftsList = leadData.drafts || [];
          if (draftsList.length > 0) {
            const latest = draftsList[draftsList.length - 1];
            setDraftMessage(latest.message || '');
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

  // Reset Filters
  const handleResetFilters = () => {
    setTextSearch('');
    setAvatarFilter('all');
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
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
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
      setLeads(prev => prev.map(l => {
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
      }));

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

      if (avatarFilter !== 'all' && lead.avatar_type !== avatarFilter) {
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
  }, [leads, textSearch, avatarFilter, statusFilter, sortBy]);

  // Calculate aggregate funnel metrics filterable by avatar type
  const aggregateItems = funnelData.items.filter(item => {
    if (aggregateAvatarFilter === 'all') return true;
    return item.avatar_type === aggregateAvatarFilter;
  });

  const totals = aggregateItems.reduce((acc, item) => {
    acc.link_clicked += item.link_clicked || 0;
    acc.form_started += item.form_started || 0;
    acc.form_submitted += item.form_submitted || 0;
    acc.meeting_booked += item.meeting_booked || 0;
    return acc;
  }, { link_clicked: 0, form_started: 0, form_submitted: 0, meeting_booked: 0 });

  const maxVal = Math.max(totals.link_clicked, 1);
  const percentStart = totals.link_clicked ? Math.round((totals.form_started / totals.link_clicked) * 100) : 0;
  const percentSubmit = totals.form_started ? Math.round((totals.form_submitted / totals.form_started) * 100) : 0;
  const percentBook = totals.form_submitted ? Math.round((totals.meeting_booked / totals.form_submitted) * 100) : 0;

  const activeFilterCount = [
    textSearch,
    avatarFilter !== 'all' ? avatarFilter : '',
    statusFilter !== 'all' ? statusFilter : '',
    sortBy !== 'newest' ? sortBy : '',
  ].filter(Boolean).length;

  const workspaceSections = [
    { id: 'leads', label: 'Pipeline', icon: User, desc: 'Browse leads and run outreach' },
    { id: 'source', label: 'Source', icon: Search, desc: 'Find new individual leads' },
    { id: 'analytics', label: 'Analytics', icon: BarChart3, desc: 'Funnel conversion metrics' },
  ];

  const leadDetailTabs = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'compose', label: 'Compose', icon: MessageSquare },
    { id: 'history', label: 'History', icon: Clock },
    { id: 'funnel', label: 'Funnel', icon: Activity },
  ];

  const hasAnyFunnelActivity = totals.link_clicked > 0 || totals.form_started > 0 || totals.form_submitted > 0 || totals.meeting_booked > 0;

  const renderAnalyticsPanel = () => {
    if (funnelLoading) {
      return (
        <div className="individual-analytics-loading">
          <Loader2 className="animate-spin" size={32} style={{ color: COLORS.oldRose }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading funnel analytics...</span>
        </div>
      );
    }
    if (funnelError) {
      return (
        <div className="individual-analytics-loading">
          <AlertTriangle size={36} style={{ color: COLORS.error }} />
          <h4 style={{ fontWeight: 600 }}>Failed to load funnel analytics</h4>
          <button type="button" onClick={fetchFunnelData} className="chip-fallback-btn">Retry Load</button>
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h3 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <BarChart3 size={24} style={{ color: COLORS.oldRose }} />
              Individual Leads Funnel
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
              Conversion metrics for job seekers and job upgraders.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Filter size={14} style={{ color: 'var(--text-muted)' }} />
            <div style={{ display: 'flex', background: COLORS.white, borderRadius: '8px', padding: '2px', border: '1px solid var(--border-color)' }}>
              {['avatar1', 'avatar2'].map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setAggregateAvatarFilter(type)}
                  style={{
                    background: aggregateAvatarFilter === type ? 'var(--bg-secondary)' : 'transparent',
                    border: 'none',
                    borderRadius: '6px',
                    color: aggregateAvatarFilter === type ? COLORS.oldRose : 'var(--text-secondary)',
                    padding: '6px 12px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {individualLabel(type)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {!hasAnyFunnelActivity ? (
          <div className="glass-card" style={{ padding: '60px 40px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', border: '1px dashed var(--border-color)' }}>
            <TrendingUp size={48} style={{ color: 'var(--text-muted)', opacity: 0.6 }} />
            <div>
              <h4 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                No Funnel Activity Recorded Yet
              </h4>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '400px', margin: '0 auto', lineHeight: '1.5' }}>
                Candidates haven&apos;t interacted with outreach landing pages yet. Sourced leads will trigger click, intake progress, and calendar booking events as they respond.
              </p>
            </div>
          </div>
        ) : (
          <div className="glass-card" style={{ padding: '24px', border: '1px solid var(--border-color)' }}>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '24px' }}>
              Conversion Funnel Stages
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {[
                { stage: 'Link Clicked', count: totals.link_clicked, color: COLORS.oldRose, percentage: 100, suffix: 'clicks' },
                { stage: 'Form Started', count: totals.form_started, color: COLORS.accentDark, percentage: percentStart, suffix: 'started' },
                { stage: 'Form Submitted', count: totals.form_submitted, color: COLORS.powderBlush, percentage: percentSubmit, suffix: 'submitted' },
                { stage: 'Meeting Booked', count: totals.meeting_booked, color: COLORS.success, percentage: percentBook, suffix: 'booked' }
              ].map((step, idx) => {
                const widthPercent = maxVal > 0 ? (step.count / maxVal) * 100 : 0;
                return (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{step.stage}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>
                          {step.count} {step.suffix}
                        </span>
                        {idx > 0 && (
                          <span style={{ color: step.color, fontWeight: 600, fontSize: '0.75rem', background: COLORS.white, padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                            {step.percentage}% Conv
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ width: '100%', height: '24px', background: COLORS.white, border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
                      <div style={{ width: `${widthPercent}%`, height: '100%', background: `linear-gradient(to right, ${step.color}33, ${step.color})`, transition: 'width 0.4s ease-out', borderRadius: '4px' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="glass-card" style={{ padding: '0px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
              Candidate Activity Breakdown
            </h4>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Showing {aggregateItems.length} records
            </span>
          </div>
          <div className="results-table-scroll">
            <table className="results-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Type</th>
                  <th style={{ textAlign: 'center' }}>Clicks</th>
                  <th style={{ textAlign: 'center' }}>Starts</th>
                  <th style={{ textAlign: 'center' }}>Submits</th>
                  <th style={{ textAlign: 'center' }}>Booked</th>
                  <th>Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {aggregateItems.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                      No candidates found for this lead type.
                    </td>
                  </tr>
                ) : (
                  aggregateItems.map((item) => (
                    <tr key={item.lead_id} onClick={() => { handleSelectLead(item.lead_id); setWorkspaceSection('leads'); }} style={{ cursor: 'pointer' }}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '240px' }}>
                          {item.headline || item.role}
                        </div>
                      </td>
                      <td>
                        <span style={{
                          fontSize: '0.7rem', fontWeight: 600, padding: '2px 6px', borderRadius: '4px',
                          border: `1px solid ${item.avatar_type === 'avatar1' ? 'rgba(192, 132, 151, 0.2)' : 'rgba(247, 175, 157, 0.2)'}`,
                          color: item.avatar_type === 'avatar1' ? COLORS.oldRose : COLORS.powderBlush
                        }}>
                          {individualLabel(item.avatar_type)}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: item.link_clicked ? '700' : '400', color: item.link_clicked ? COLORS.oldRose : 'var(--text-muted)' }}>{item.link_clicked || 0}</td>
                      <td style={{ textAlign: 'center', fontWeight: item.form_started ? '700' : '400', color: item.form_started ? COLORS.accentDark : 'var(--text-muted)' }}>{item.form_started || 0}</td>
                      <td style={{ textAlign: 'center', fontWeight: item.form_submitted ? '700' : '400', color: item.form_submitted ? COLORS.powderBlush : 'var(--text-muted)' }}>{item.form_submitted || 0}</td>
                      <td style={{ textAlign: 'center', fontWeight: item.meeting_booked ? '700' : '400', color: item.meeting_booked ? COLORS.success : 'var(--text-muted)' }}>{item.meeting_booked || 0}</td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {item.latest_event_at ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Calendar size={12} />
                            <span>{new Date(item.latest_event_at).toLocaleString()}</span>
                          </div>
                        ) : 'N/A'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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

      <nav className="individual-workspace-nav" aria-label="Individual workspace sections">
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

      {workspaceSection === 'source' && (
        <div className="individual-section individual-section--source">
          <IndividualSearchPanel onComplete={() => { fetchLeads(); fetchFunnelData(); setWorkspaceSection('leads'); }} />
        </div>
      )}

      {workspaceSection === 'leads' && (
      <div className={`workspace-split${selectedLeadId ? ' workspace-split--detail-open' : ''}`}>
      <div className="workspace-list-pane">
        
        {/* List header: search + collapsible filters */}
        <div className="individual-list-header">
          <div className="individual-list-header__top">
            <h3 className="individual-list-header__title">Leads</h3>
            <span className="individual-list-header__count">{filteredLeads.length} shown</span>
          </div>

          <div style={{ position: 'relative', width: '100%' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Search leads, roles, prompt..." 
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
              >
                <X size={14} />
              </button>
            )}
          </div>

          <button
            type="button"
            className="individual-list-filters-toggle"
            onClick={() => setListFiltersOpen((open) => !open)}
            aria-expanded={listFiltersOpen}
          >
            <Filter size={14} />
            Filters
            {activeFilterCount > 0 && (
              <span className="individual-list-filters-toggle__badge">{activeFilterCount}</span>
            )}
          </button>

          {listFiltersOpen && (
          <div className="individual-list-filters-panel">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Type:</span>
            <div style={{ display: 'flex', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '2px', border: '1px solid var(--border-color)' }}>
              {['avatar1', 'avatar2'].map((type) => (
                <button
                  key={type}
                  onClick={() => setAvatarFilter(type)}
                  style={{
                    background: avatarFilter === type ? '#ffffff' : 'transparent',
                    border: avatarFilter === type ? '1px solid var(--border-color)' : '1px solid transparent',
                    borderRadius: '6px',
                    color: avatarFilter === type ? COLORS.oldRose : 'var(--text-secondary)',
                    padding: '4px 10px',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textTransform: 'capitalize'
                  }}
                >
                  {individualLabel(type)}
                </button>
              ))}
            </div>
          </div>

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

          {/* Sort selector */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <ArrowUpDown size={13} />
              Sort by:
            </span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{
                background: '#ffffff',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                padding: '4px 8px',
                fontSize: '0.72rem',
                outline: 'none',
                maxWidth: '180px',
                fontWeight: 500,
              }}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          {/* Filter stats & clear option */}
          {(textSearch || avatarFilter !== 'all' || statusFilter !== 'all' || sortBy !== 'newest') && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <span>Filtered: {filteredLeads.length} of {leads.length} leads</span>
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
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
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
              <AlertTriangle size={32} style={{ color: '#ef4444' }} />
              <div>
                <h5 style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '4px' }}>Failed to load leads</h5>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Verify FastAPI backend server on port 8000 is active.</p>
              </div>
              <button onClick={fetchLeads} className="chip-fallback-btn" style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <RotateCcw size={12} />
                Retry Fetch
              </button>
            </div>
          ) : leads.length === 0 ? (
            /* Empty state pointing to Home */
            <div style={{ textAlign: 'center', padding: '40px 16px', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
              <Briefcase size={40} style={{ color: 'var(--text-muted)' }} />
              <div>
                <h5 style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '6px' }}>No individual leads yet</h5>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: '1.4', maxWidth: '280px' }}>
                  Use the search above to source business leads. Imported prospects will appear on the board below.
                </p>
              </div>
              <button onClick={() => router.push('/')} className="btn-primary" style={{ padding: '8px 16px', fontSize: '0.75rem' }}>
                Go to Home
              </button>
            </div>
          ) : filteredLeads.length === 0 ? (
            /* Empty state for active filter */
            <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              No leads match your search criteria.
            </div>
          ) : (
            /* Leads list */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredLeads.map((lead) => {
                const isActive = lead.id === selectedLeadId;
                const draftStatus = lead.latest_draft?.status || 'draft';
                const avatarLabel = individualLabel(lead.avatar_type);
                
                return (
                  <div
                    key={lead.id}
                    onClick={() => handleSelectLead(lead.id)}
                    style={{
                      background: isActive ? 'rgba(192, 132, 151, 0.04)' : '#ffffff',
                      border: `1px solid ${isActive ? COLORS.oldRose : 'var(--border-color)'}`,
                      borderRadius: '12px',
                      padding: '16px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      boxShadow: isActive ? '0 0 0 3px rgba(192, 132, 151, 0.08)' : 'none'
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
                          draftStatus === 'sent' ? 'rgba(74, 107, 92, 0.25)' : 
                          draftStatus === 'failed' ? 'rgba(220, 38, 38, 0.25)' : 
                          'rgba(192, 132, 151, 0.25)'
                        }`,
                        background: `${
                          draftStatus === 'sent' ? 'rgba(74, 107, 92, 0.06)' : 
                          draftStatus === 'failed' ? 'rgba(220, 38, 38, 0.06)' : 
                          'rgba(192, 132, 151, 0.06)'
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
                      <span style={{
                        fontWeight: 600,
                        padding: '1px 6px',
                        borderRadius: '4px',
                        border: `1px solid ${
                          lead.avatar_type === 'avatar1' ? 'rgba(192, 132, 151, 0.2)' : 'rgba(247, 175, 157, 0.2)'
                        }`,
                        background: `${
                          lead.avatar_type === 'avatar1' ? 'rgba(192, 132, 151, 0.05)' : 'rgba(247, 175, 157, 0.05)'
                        }`,
                        color: lead.avatar_type === 'avatar1' ? COLORS.oldRose : COLORS.powderBlush
                      }}>
                        {avatarLabel}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
                      {individualLabel(selectedLeadDetails.avatar_type)}
                    </span>
                    <span className={`individual-lead-detail__status individual-lead-detail__status--${(selectedLeadDetails.drafts?.[selectedLeadDetails.drafts.length - 1]?.status || 'draft')}`}>
                      {selectedLeadDetails.drafts?.[selectedLeadDetails.drafts.length - 1]?.status || 'draft'}
                    </span>
                  </div>
                </div>
                <button type="button" onClick={() => handleSelectLead('')} className="individual-lead-detail__close">
                  <X size={16} />
                  Close
                </button>
              </div>

              <nav className="individual-lead-tabs" aria-label="Lead detail sections">
                {leadDetailTabs.map((tab) => {
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

              {activeTab === 'profile' && (
                <div className="glass-card individual-lead-profile" style={{ padding: '24px', border: '1px solid var(--border-color)' }}>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    {selectedLeadDetails.headline || selectedLeadDetails.role || 'Sales Professional'}
                  </p>
                  {selectedLeadDetails.company && (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '8px' }}>
                      Company: <span style={{ color: 'var(--text-primary)' }}>{selectedLeadDetails.company}</span>
                    </p>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '12px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <MapPin size={12} />
                      {selectedLeadDetails.location || 'US'}
                    </span>
                    {selectedLeadDetails.linkedin_url && (
                      <a href={selectedLeadDetails.linkedin_url} target="_blank" rel="noreferrer" style={{ color: COLORS.oldRose, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        LinkedIn Profile
                        <ArrowUpRight size={12} />
                      </a>
                    )}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '12px', fontStyle: 'italic' }}>
                    Original Search Query: {selectedLeadDetails.source_query || 'no source query'}
                  </div>
                  {selectedLeadDetails.search_prompt && (
                    <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-color)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      <span>Source query prompt: </span>
                      <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>&quot;{selectedLeadDetails.search_prompt}&quot;</span>
                    </div>
                  )}
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
                        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', background: 'rgba(217, 119, 6, 0.08)', color: '#d97706', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(217,119,6,0.15)', fontWeight: 600 }}>
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
                            background: sendChannel === ch ? 'rgba(192,132,151,0.08)' : '#fff',
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

                    {/* Bottom toolbar */}
                    <div style={{ 
                      padding: '12px 20px', 
                      borderTop: '1px solid var(--border-color)', 
                      background: COLORS.white,
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center' 
                    }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {draftMessage.length} characters
                      </span>

                      {(selectedLeadDetails.drafts?.[selectedLeadDetails.drafts.length - 1]?.status || 'draft') === 'sent' ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: COLORS.success, fontSize: '0.85rem', fontWeight: 600 }}>
                          <CheckCircle2 size={16} />
                          Sent
                        </span>
                      ) : (
                        <button 
                          className="btn-primary" 
                          onClick={handleSendOutreach}
                          style={{ padding: '10px 24px', fontSize: '0.85rem' }}
                        >
                          <Send size={14} />
                          Send
                        </button>
                      )}
                    </div>
                  </div>

                  {/* AI copy logic/reasoning */}
                  {draftReasoning && (
                    <div style={{ padding: '16px 20px', background: COLORS.white, border: '1px solid var(--border-color)', borderRadius: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--text-primary)' }}>
                        <Sparkles size={14} style={{ color: COLORS.powderBlush }} />
                        <h4 style={{ fontWeight: 600, fontSize: '0.85rem' }}>AI Draft Logic</h4>
                      </div>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: '1.5' }}>
                        {draftReasoning}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* 2. HISTORY TAB */}
              {activeTab === 'history' && (
                <div className="glass-card" style={{ padding: '24px', border: '1px solid var(--border-color)' }}>
                  <h4 style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Clock size={16} style={{ color: COLORS.oldRose }} />
                    Outreach Draft History
                  </h4>
                  
                  {(!selectedLeadDetails.drafts || selectedLeadDetails.drafts.length === 0) ? (
                    <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      No outreach history recorded for this prospect.
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
                            {draft.message}
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
                            background: step.completed ? 'rgba(74, 107, 92, 0.06)' : COLORS.white,
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

            </div>
          ) : null
        ) : (
          <div className="individual-pipeline-empty">
            <User size={40} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
            <h4>Select a lead to view details</h4>
            <p>Choose a candidate from the list to review their profile, compose outreach, or track funnel progress.</p>
            <button type="button" className="chip-fallback-btn" onClick={() => setWorkspaceSection('source')}>
              <Search size={14} />
              Source new leads
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
