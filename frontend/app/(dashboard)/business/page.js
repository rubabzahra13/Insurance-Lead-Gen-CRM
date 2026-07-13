'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { WORKSPACE_LABELS, LEAD_PATH } from '../../../lib/avatar-labels';
import { COLORS, GRADIENT, RGBA } from '../../../lib/colors';
import { 
  Search, Plus, MapPin, Star, Phone, Globe, 
  ChevronRight, Loader2, AlertTriangle, CheckCircle2, 
  Move, KanbanSquare, Sliders, X, MessageSquare, 
  Clock, PlusCircle, ArrowRight, Sparkles, Activity
} from 'lucide-react';

function BusinessWorkspaceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Route states
  const urlQuery = searchParams.get('q') || '';
  const initialLeadId = searchParams.get('leadId') || null;

  // Pipeline leads state
  const [leads, setLeads] = useState([]);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsError, setLeadsError] = useState(false);
  const [selectedQueryFilter, setSelectedQueryFilter] = useState('');

  // Search/sourcing states
  const [searchQuery, setSearchQuery] = useState(urlQuery);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [showSearchPanel, setShowSearchPanel] = useState(false);

  // Detail slide-over states (Step 3.7)
  const [selectedLeadId, setSelectedLeadId] = useState(initialLeadId);
  const [leadDetails, setLeadDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [noteAuthor, setNoteAuthor] = useState('Peter');
  const [noteSaving, setNoteSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [approvingPlan, setApprovingPlan] = useState(false);

  // Toast notification
  const [toast, setToast] = useState(null); // { message: string, type: 'success' | 'error' }

  // Pipeline Stages definition
  const STAGES = [
    { id: 'new', label: 'New', color: COLORS.oldRose, bg: 'rgba(192, 132, 151, 0.08)' },
    { id: 'qualified', label: 'Qualified', color: COLORS.accentDark, bg: 'rgba(192, 132, 151, 0.08)' },
    { id: 'warm', label: 'Warm', color: COLORS.powderBlush, bg: 'rgba(247, 175, 157, 0.12)' },
    { id: 'follow_up_later', label: 'Follow Up Later', color: COLORS.warning, bg: 'rgba(196, 137, 58, 0.08)' },
    { id: 'sealed_won', label: 'Sealed/Won', color: COLORS.success, bg: 'rgba(74, 107, 92, 0.08)' },
    { id: 'lost', label: 'Lost', color: COLORS.error, bg: 'rgba(181, 74, 58, 0.08)' },
    { id: 'not_interested', label: 'Not Interested', color: COLORS.text, bg: 'rgba(34, 56, 67, 0.06)' }
  ];

  // Show Toast helper
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Fetch pipeline leads on mount
  const fetchPipelineLeads = async () => {
    setLeadsLoading(true);
    setLeadsError(false);
    try {
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
      const res = await fetch(`${apiBaseUrl}/api/avatar3/leads`);
      if (!res.ok) throw new Error('Failed to fetch business leads');
      const data = await res.json();
      setLeads(data.items || []);
    } catch (err) {
      console.error(err);
      setLeadsError(true);
    } finally {
      setLeadsLoading(false);
    }
  };

  // Run Google Places Search Sourcing
  const executeSearch = async (queryStr) => {
    if (!queryStr.trim()) return;
    setSearchLoading(true);
    setSearchError(false);
    setShowSearchPanel(true);
    try {
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
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
    } catch (err) {
      console.error(err);
      setSearchError(true);
      showToast(err.message || 'Failed to retrieve search results.', 'error');
    } finally {
      setSearchLoading(false);
    }
  };

  // Sourcing initial search if query param is present on mount
  useEffect(() => {
    fetchPipelineLeads();
    if (urlQuery) {
      executeSearch(urlQuery);
    }
  }, [urlQuery]);

  // Load details for selected lead
  const fetchLeadDetails = async (id) => {
    if (!id) return;
    setDetailsLoading(true);
    setDetailsError(false);
    try {
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
      const res = await fetch(`${apiBaseUrl}/api/avatar3/leads/${id}`);
      if (!res.ok) throw new Error('Failed to fetch lead details');
      const data = await res.json();
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
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
      const res = await fetch(`${apiBaseUrl}/api/avatar3/leads/${selectedLeadId}/enrich`, { method: 'POST' });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || 'Enrichment failed');
      }
      const data = await res.json();
      setLeadDetails((prev) => (prev ? { ...prev, ...data } : data));
      showToast('Contact details enriched from website');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Could not enrich from website', 'error');
    } finally {
      setEnriching(false);
    }
  };

  const handleApproveFollowUp = async (planId) => {
    if (!selectedLeadId || !planId) return;
    setApprovingPlan(true);
    try {
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
      const res = await fetch(
        `${apiBaseUrl}/api/avatar3/leads/${selectedLeadId}/follow-up-plans/${planId}/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ send: true }),
        }
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || 'Failed to approve follow-up');
      }
      await fetchLeadDetails(selectedLeadId);
      showToast('Follow-up approved and outreach dispatched');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Could not approve follow-up', 'error');
    } finally {
      setApprovingPlan(false);
    }
  };

  // Sourcing import: Add a searched business lead straight into the board
  const handleAddLead = async (business) => {
    try {
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
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

      if (!res.ok) throw new Error('Failed to create pipeline lead');
      const leadData = await res.json();

      if (leadData.duplicate) {
        showToast(`"${leadData.business_name}" already exists. Opening details!`, 'success');
        // Highlight / select existing lead
        handleSelectLead(leadData.id);
      } else {
        showToast(`Added "${leadData.business_name}" to pipeline!`, 'success');
        // Add to leads array in-memory
        setLeads(prev => [leadData, ...prev]);
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to add lead to pipeline.', 'error');
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
    setLeads(prev => prev.map(l => {
      if (l.id === leadId) {
        return { ...l, pipeline_stage: toStage };
      }
      return l;
    }));

    try {
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
      const patchRes = await fetch(`${apiBaseUrl}/api/avatar3/leads/${leadId}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_stage: toStage })
      });

      if (!patchRes.ok) throw new Error('Stage change was rejected by server');
      
      const updatedLead = await patchRes.json();
      
      // Update in-memory list with backend response
      setLeads(prev => prev.map(l => (l.id === leadId ? updatedLead : l)));
      
      // If currently selected lead details are active, sync them
      if (selectedLeadId === leadId) {
        setLeadDetails(prev => (prev ? { ...prev, pipeline_stage: toStage } : null));
      }

      showToast('Lead stage updated successfully.');

    } catch (err) {
      console.error(err);
      // Revert change
      setLeads(previousLeads);
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
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
      const res = await fetch(`${apiBaseUrl}/api/avatar3/leads/${selectedLeadId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newNoteContent, author: noteAuthor })
      });

      if (!res.ok) throw new Error('Failed to save note');

      // Backend now returns the full updated lead (stage, plans, events) in one shot
      const updatedLead = await res.json();
      setLeadDetails(updatedLead);
      setNewNoteContent('');

      // Sync board column if reclassification agent moved the stage
      setLeads(prev => prev.map(l =>
        l.id === selectedLeadId
          ? { ...l, pipeline_stage: updatedLead.pipeline_stage }
          : l
      ));

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
    <div className="workspace-page workspace-page--bleed" id="business-workspace-root">
      
      {/* Source business leads */}
      <div className="workspace-source-panel workspace-source-panel--business business-source-panel">
        <section className="workspace-source-hero">
          <div className="workspace-source-hero-copy">
            <p className="workspace-source-eyebrow">Google Places sourcing</p>
            <h2 className="workspace-source-title">Source business leads</h2>
            <p className="workspace-source-desc">
              Find {LEAD_PATH.business.label.toLowerCase()}. Search by region or category, review results, then add prospects to your pipeline board below.
            </p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); executeSearch(searchQuery); }} className="workspace-source-form">
            <div className="search-box-wrapper workspace-search-box">
              <Search className="search-icon-left" size={20} />
              <input
                type="text"
                className="search-input-field"
                placeholder="e.g. Roofing contractors in Dallas"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button type="submit" className="search-submit-btn">
                Source leads
                <ArrowRight size={16} />
              </button>
            </div>
          </form>
        </section>
      </div>

      {/* Sourcing Results Panel */}
      {showSearchPanel && (
        <div className="glass-card business-search-results" style={{ border: '1px solid var(--border-color)', background: '#ffffff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <PlusCircle size={16} style={{ color: COLORS.powderBlush }} />
              <h4 style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                Google Places Sourcing: "{searchQuery || urlQuery}"
              </h4>
            </div>
            <button 
              onClick={() => { setShowSearchPanel(false); setSearchResults([]); }}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={16} />
            </button>
          </div>

          {searchLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', gap: '8px', color: 'var(--text-secondary)' }}>
              <Loader2 className="animate-spin" size={20} style={{ color: COLORS.powderBlush }} />
              <span>Scraping regional listings...</span>
            </div>
          ) : searchError ? (
            <div style={{ color: COLORS.error, fontSize: '0.8rem', textAlign: 'center', padding: '16px' }}>
              Failed to fetch results. Check backend logs.
            </div>
          ) : searchResults.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '16px' }}>
              No businesses found matching this query.
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '8px' }}>
              {searchResults.map((business, idx) => (
                <div 
                  key={business.google_place_id || idx}
                  className="glass-card"
                  style={{
                    minWidth: '280px',
                    width: '280px',
                    padding: '16px',
                    border: '1px solid var(--border-color)',
                    background: COLORS.white,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '12px'
                  }}
                >
                  <div>
                    <h5 style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {business.business_name}
                    </h5>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      <Star size={10} style={{ color: COLORS.warning, fill: COLORS.warning }} />
                      <span>{business.rating || 'No rating'}</span>
                      <span>•</span>
                      <span>{business.open_status || 'UNKNOWN'}</span>
                    </div>

                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <MapPin size={10} style={{ marginRight: '2px', display: 'inline' }} />
                      {business.address || 'No Address'}
                    </p>
                  </div>

                  <button 
                    onClick={() => handleAddLead(business)}
                    style={{
                      width: '100%',
                      background: RGBA.blush05,
                      border: `1px solid ${RGBA.blush20}`,
                      borderRadius: '6px',
                      color: COLORS.powderBlush,
                      padding: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = RGBA.blush20; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = RGBA.blush05; }}
                  >
                    <Plus size={12} />
                    Add to Pipeline
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main Board View */}
      {leadsLoading ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
          <Loader2 className="animate-spin" size={32} style={{ color: COLORS.powderBlush }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading board columns...</span>
        </div>
      ) : leadsError ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
          <AlertTriangle size={36} style={{ color: COLORS.error }} />
          <h4 style={{ fontWeight: 600 }}>Failed to load Pipeline Board</h4>
          <button onClick={fetchPipelineLeads} className="chip-fallback-btn">
            Retry Load
          </button>
        </div>
      ) : leads.length === 0 ? (
        /* Empty State */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '40px' }}>
          <Sliders size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px', opacity: 0.6 }} />
          <h4 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
            Your Pipeline is Empty
          </h4>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '380px', marginBottom: '24px', lineHeight: '1.5' }}>
            No business prospects found. Search for regional targets using the sourcing input above to seed your sales pipeline.
          </p>
          <div style={{ maxWidth: '360px', width: '100%', display: 'flex', gap: '8px' }}>
            <input 
              type="text"
              placeholder="e.g. Roofers in Dallas"
              className="chip-fallback-btn"
              style={{ flex: 1, textAlign: 'left', background: COLORS.white, border: '1px solid var(--border-color)', color: 'var(--text-primary)', outline: 'none' }}
              onChange={(e) => setSearchQuery(e.target.value)}
              value={searchQuery}
            />
            <button 
              className="btn-primary" 
              onClick={() => executeSearch(searchQuery)}
              style={{ fontSize: '0.8rem', padding: '8px 16px' }}
            >
              Source
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Filters Toolbar */}
          <div className="business-filter-bar">
            <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: '12px', background: COLORS.white, padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Filter by original search query:</span>
            <select
              value={selectedQueryFilter}
              onChange={(e) => setSelectedQueryFilter(e.target.value)}
              style={{
                background: '#ffffff',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                padding: '6px 12px',
                fontSize: '0.75rem',
                outline: 'none',
                minWidth: '180px',
                fontWeight: 500
              }}
            >
              <option value="">All Queries</option>
              {Array.from(new Set(leads.map(lead => lead.source_query).filter(Boolean))).map(q => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>
            {selectedQueryFilter && (
              <button
                onClick={() => setSelectedQueryFilter('')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: COLORS.powderBlush,
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                Clear Filter
              </button>
            )}
            </div>
          </div>

      {/* Pipeline board */}
      <div className="business-pipeline-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <KanbanSquare size={22} style={{ color: COLORS.text }} />
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Pipeline board</h3>
            <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>Drag cards to update stage</p>
          </div>
        </div>
      </div>

      {/* Kanban area */}
          <div className="kanban-board">
            {STAGES.map(stage => {
              const stageLeads = leads
                .filter(l => !selectedQueryFilter || l.source_query === selectedQueryFilter)
                .filter(l => l.pipeline_stage === stage.id);
            return (
              <div
                key={stage.id}
                className="kanban-column"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(e, stage.id)}
                style={{
                  background: stage.bg,
                }}
              >
                {/* Column Header */}
                <div style={{ padding: '12px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'transparent', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: stage.color, flexShrink: 0 }}></div>
                    <span style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-primary)', whitespace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {stage.label}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.7rem', background: '#ffffff', color: 'var(--text-secondary)', padding: '2px 6px', borderRadius: '8px', border: '1px solid var(--border-color)', fontWeight: 600, flexShrink: 0 }}>
                    {stageLeads.length}
                  </span>
                </div>

                {/* Column Scrollable Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
                  {stageLeads.length === 0 ? (
                    <div style={{ padding: '16px 12px', textTransform: 'uppercase', fontSize: '0.6rem', color: 'var(--text-muted)', border: '1px dashed rgba(255,255,255,0.03)', borderRadius: '6px', textAlign: 'center', fontStyle: 'italic', letterSpacing: '0.05em' }}>
                      Drop cards here
                    </div>
                  ) : (
                    stageLeads.map(lead => (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, lead.id, lead.pipeline_stage)}
                        onClick={() => handleSelectLead(lead.id)}
                        style={{
                          background: '#ffffff',
                          border: `1px solid ${selectedLeadId === lead.id ? COLORS.powderBlush : 'var(--border-color)'}`,
                          borderRadius: '6px',
                          padding: '10px',
                          cursor: 'grab',
                          transition: 'all 0.2s',
                          boxShadow: selectedLeadId === lead.id ? '0 0 8px rgba(247,175,157,0.25)' : 'none'
                        }}
                        onMouseEnter={(e) => { if (selectedLeadId !== lead.id) e.currentTarget.style.borderColor = 'var(--border-hover)'; }}
                        onMouseLeave={(e) => { if (selectedLeadId !== lead.id) e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                      >
                        <h5 style={{ fontWeight: 600, fontSize: '0.75rem', color: 'var(--text-primary)', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {lead.business_name}
                        </h5>

                        <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', marginBottom: '3px', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          Query: {lead.source_query || 'no query'}
                        </div>

                        <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '2px', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <MapPin size={9} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {lead.address || 'No Location'}
                          </span>
                        </p>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            {lead.rating && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '1px', fontSize: '0.6rem', color: COLORS.warning, fontWeight: 'bold' }}>
                                <Star size={9} style={{ fill: COLORS.warning, flexShrink: 0 }} />
                                {lead.rating}
                              </div>
                            )}
                            {lead.website && (
                              <a 
                                href={lead.website} 
                                target="_blank" 
                                rel="noreferrer" 
                                onClick={(e) => e.stopPropagation()} 
                                style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                              >
                                <Globe size={9} />
                              </a>
                            )}
                          </div>

                          {/* Mobile/Touch Fallback drop selector */}
                          <select
                            value={lead.pipeline_stage}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => handleStageUpdate(lead.id, lead.pipeline_stage, e.target.value)}
                            style={{
                              background: COLORS.white,
                              border: '1px solid var(--border-color)',
                              borderRadius: '3px',
                              color: 'var(--text-muted)',
                              fontSize: '0.6rem',
                              padding: '2px 3px',
                              outline: 'none',
                              cursor: 'pointer'
                            }}
                          >
                            {STAGES.map(s => (
                              <option key={s.id} value={s.id} style={{ background: COLORS.white, color: 'var(--text-primary)' }}>
                                Move to {s.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
        </>
      )}

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
              <Loader2 className="animate-spin" size={32} style={{ color: COLORS.powderBlush }} />
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Scraping details...</span>
            </div>
          ) : detailsError ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
              <AlertTriangle size={36} style={{ color: COLORS.error }} />
              <h4 style={{ fontWeight: 600 }}>Failed to load lead details</h4>
              <button onClick={() => fetchLeadDetails(selectedLeadId)} className="chip-fallback-btn">
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
                        {leadDetails.address && (
                          <p style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                            <MapPin size={11} />{leadDetails.address}
                          </p>
                        )}
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: '10px', fontStyle: 'italic' }}>
                          Original Search Query: {leadDetails.source_query || 'no source query'}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', padding: '3px 10px', borderRadius: '20px', border: `1px solid ${stageInfo.color}55`, color: stageInfo.color, background: stageInfo.bg }}>
                            {stageInfo.label}
                          </span>
                          {leadDetails.rating && (
                            <span style={{ fontSize: '0.72rem', color: COLORS.warning, display: 'flex', alignItems: 'center', gap: '3px', fontWeight: 600 }}>
                              <Star size={11} style={{ fill: COLORS.warning }} />{leadDetails.rating}
                            </span>
                          )}
                          {leadDetails.open_status && (
                            <span style={{ fontSize: '0.68rem', fontWeight: 600, color: leadDetails.open_status === 'OPERATIONAL' ? COLORS.success : COLORS.warning }}>{leadDetails.open_status}</span>
                          )}
                          {leadDetails.phone && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}><Phone size={10} />{leadDetails.phone}</span>
                          )}
                          {leadDetails.website && (
                            <a href={leadDetails.website} target="_blank" rel="noreferrer" style={{ fontSize: '0.72rem', color: COLORS.oldRose, display: 'flex', alignItems: 'center', gap: '3px' }}><Globe size={10} />Website</a>
                          )}
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
                
                {/* Contact enrichment card (Step 3.7 Agent output) */}
                <div className="glass-card" style={{ padding: '20px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h4 style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Sparkles size={14} style={{ color: COLORS.powderBlush }} />
                      Contact & Owner Details
                    </h4>
                    {leadDetails.website && (
                      <button
                        type="button"
                        onClick={handleEnrichFromWebsite}
                        disabled={enriching}
                        className="btn-primary"
                        style={{ padding: '6px 12px', fontSize: '0.75rem' }}
                      >
                        {enriching ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                        {enriching ? 'Enriching…' : 'Enrich from website'}
                      </button>
                    )}
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.82rem' }}>
                    {[['Owner', leadDetails.owner_name], ['Manager', leadDetails.manager_name], ['Email', leadDetails.contact_email]].map(([label, val]) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-muted)' }}>{label}:</span>
                        <span style={{ color: val ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: val ? 600 : 400, fontStyle: val ? 'normal' : 'italic' }}>{val || 'Not found'}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-muted)' }}>LinkedIn:</span>
                      {leadDetails.contact_linkedin
                        ? <a href={leadDetails.contact_linkedin} target="_blank" rel="noreferrer" style={{ color: COLORS.oldRose, display: 'flex', alignItems: 'center', gap: '3px' }}>Profile <ArrowRight size={10} /></a>
                        : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not found</span>}
                    </div>
                  </div>
                </div>

                {/* AI Follow-Up Plans (Step 3.7 planning agent output) */}
                <div className="glass-card" style={{ padding: '20px', border: '1px solid var(--border-color)' }}>
                  <h4 style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Activity size={14} style={{ color: COLORS.powderBlush }} />
                    Recommended Follow-Up Action
                  </h4>

                  {/* Stage-change banner — live from response data */}
                  {(() => {
                    const stageChangeEvent = leadDetails.events?.slice().reverse().find(e => e.event_type === 'stage_change' && e.from_stage);
                    if (!stageChangeEvent) return null;
                    const stageInfo = STAGES.find(s => s.id === stageChangeEvent.to_stage);
                    return (
                      <div style={{ background: `${stageInfo?.color || COLORS.powderBlush}11`, border: `1px solid ${stageInfo?.color || COLORS.powderBlush}33`, borderRadius: '8px', padding: '10px 14px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Activity size={14} style={{ color: stageInfo?.color || COLORS.powderBlush, flexShrink: 0 }} />
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
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: COLORS.warning, textTransform: 'uppercase', background: 'rgba(196, 137, 58, 0.08)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(196, 137, 58, 0.18)' }}>
                            {plan.suggested_channel}
                          </span>
                          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{new Date(plan.created_at).toLocaleDateString()}</span>
                        </div>
                        <div style={{ background: COLORS.white, border: '1px solid var(--border-color)', borderRadius: '6px', padding: '12px', fontSize: '0.82rem', color: 'var(--text-primary)', lineHeight: '1.55' }}>
                          {plan.recommended_action}
                        </div>
                        <p style={{ fontSize: '0.73rem', color: 'var(--text-muted)', lineHeight: '1.45' }}><strong>Reasoning:</strong> {plan.reasoning}</p>
                        {plan.status === 'approved' ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: COLORS.success, fontSize: '0.8rem', fontWeight: 600 }}>
                            <CheckCircle2 size={14} />
                            Approved
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleApproveFollowUp(plan.id)}
                            disabled={approvingPlan}
                            className="btn-primary"
                            style={{ alignSelf: 'flex-start', padding: '8px 16px', fontSize: '0.8rem' }}
                          >
                            {approvingPlan ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
                            {approvingPlan ? 'Sending…' : 'Approve & Send'}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Interaction History */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h4 style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <MessageSquare size={14} style={{ color: COLORS.powderBlush }} />
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
                    <Clock size={14} style={{ color: COLORS.powderBlush }} />
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
                            background: event.event_type === 'stage_change' ? COLORS.powderBlush : event.event_type === 'follow_up_generated' ? COLORS.warning : COLORS.text,
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
        <Loader2 className="animate-spin" size={24} style={{ color: COLORS.powderBlush, margin: '0 auto 12px' }} />
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading Workspace...</span>
      </div>
    }>
      <BusinessWorkspaceContent />
    </Suspense>
  );
}
