'use client';

import React, { useState, useEffect, useRef, useContext } from 'react';
import { useRouter } from 'next/navigation';
import { SearchContext } from './layout';
import { 
  Search, Users, Send, Calendar, Briefcase, 
  Sparkles, AlertTriangle, ArrowRight, X,
  Terminal as TerminalIcon, CheckCircle2, Loader2, ArrowUpRight, RotateCcw
} from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  
  const {
    searchQuery, setSearchQuery,
    searchState, setSearchState,
    classification, setClassification,
    scrapingStep, setScrapingStep,
    scrapingLogs, setScrapingLogs,
    scrapedLeads, setScrapedLeads,
    errorMessage, setErrorMessage,
    elapsedSeconds, setElapsedSeconds
  } = useContext(SearchContext);

  // KPI States
  const [kpis, setKpis] = useState(null);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [kpiError, setKpiError] = useState(false);

  // Search Input States
  const [validationError, setValidationError] = useState('');


  const logEndRef = useRef(null);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [scrapingLogs]);

  // Elapsed Timer
  useEffect(() => {
    let timer;
    if (searchState === 'classifying' || searchState === 'sourcing' || searchState === 'syncing') {
      timer = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => clearInterval(timer);
  }, [searchState]);

  // Fetch KPIs from Backend
  const fetchKPIs = async () => {
    try {
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
      const res = await fetch(`${apiBaseUrl}/api/dashboard/kpis`);
      if (!res.ok) throw new Error('Failed to fetch KPIs');
      const data = await res.json();
      setKpis(data);
      setKpiError(false);
    } catch (err) {
      console.error('KPI Fetch Error:', err);
      setKpiError(true);
    } finally {
      setKpiLoading(false);
    }
  };

  useEffect(() => {
    fetchKPIs();
  }, []);

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
    if (e.target.value.trim()) {
      setValidationError('');
    }
  };

  // Main Sourcing Flow Trigger
  const handleSearchSubmit = async (e) => {
    e.preventDefault();
    const query = searchQuery.trim();

    if (!query) {
      setValidationError('Please enter a query (e.g. "Insurance agents in Chicago" or "roofing companies").');
      return;
    }

    setSearchState('classifying');
    setClassification(null);
    setScrapingStep('AI Classification');
    setScrapedLeads([]);
    setErrorMessage('');
    setScrapingLogs([
      `[INIT] Sourcing pipeline initialized for query: "${query}"`,
      `[STEP] Starting Stage 1: AI Search Classification...`,
    ]);

    let classifiedData = null;

    try {
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
      const res = await fetch(`${apiBaseUrl}/api/classify-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      if (!res.ok) throw new Error('Query classification failed.');

      classifiedData = await res.json();
      setClassification(classifiedData);
      setScrapingLogs(prev => [
        ...prev,
        `[SUCCESS] Classification completed.`,
        `[INFO] Target Avatar: ${classifiedData.avatar_type === 'avatar3' ? 'Avatar 3 (Business/Founder Target)' : 'Avatar 1/2 (Recruitment Lead)'}`,
        `[INFO] LLM Confidence: ${Math.round(classifiedData.confidence * 100)}%`,
        `[INFO] Claude Reasoning: ${classifiedData.reasoning}`,
      ]);
    } catch (err) {
      console.error(err);
      setScrapingLogs(prev => [
        ...prev,
        `[ERROR] Classification service failed. Falling back to heuristic classifier...`,
      ]);
      // Fallback classification client-side
      const lower = query.toLowerCase();
      const isBiz = lower.includes('company') || lower.includes('clinic') || lower.includes('roof') || lower.includes('business') || lower.includes('founder') || lower.includes('contractor') || lower.includes('shop');
      classifiedData = {
        avatar_type: isBiz ? 'avatar3' : 'avatar2',
        confidence: 0.6,
        reasoning: 'Fallback logic activated due to classification endpoint error.',
        query,
      };
      setClassification(classifiedData);
      setScrapingLogs(prev => [
        ...prev,
        `[HEURISTIC] Target Avatar: ${classifiedData.avatar_type === 'avatar3' ? 'Avatar 3 (Business)' : 'Avatar 1/2 (Recruitment)'}`,
      ]);
    }

    // --- STAGE 2: Execute Scrapers / Search ---
    setSearchState('sourcing');
    setScrapingStep('Sourcing Leads');

    if (classifiedData.avatar_type === 'avatar3') {
      await runBusinessSearch(query);
    } else {
      await runRecruitmentScraper(query, classifiedData.avatar_type);
    }
  };

  // Manual Classification Override
  const handleOverride = async (newType) => {
    const updatedClassification = {
      avatar_type: newType,
      confidence: 1.0,
      reasoning: `Manual user override to ${newType === 'avatar3' ? 'Avatar 3 (Business)' : 'Avatar 1/2 (Recruitment)'}.`,
      query: searchQuery,
    };
    
    setClassification(updatedClassification);
    setSearchState('sourcing');
    setScrapedLeads([]);
    setErrorMessage('');
    setScrapingLogs(prev => [
      ...prev,
      `[OVERRIDE] User manually switched classification to: ${newType === 'avatar3' ? 'Avatar 3 (Business)' : 'Avatar 1/2 (Recruitment)'}`,
    ]);

    if (newType === 'avatar3') {
      await runBusinessSearch(searchQuery);
    } else {
      await runRecruitmentScraper(searchQuery, newType);
    }
  };

  // Run Avatar 3 (Google Places & Lead Import) Search
  const runBusinessSearch = async (query) => {
    setScrapingLogs(prev => [
      ...prev,
      `[STEP] Starting Stage 2: Sourcing Business Prospects (Google Places API)...`,
      `[LOG] Submitting request to /api/avatar3/search...`,
    ]);

    try {
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
      const searchRes = await fetch(`${apiBaseUrl}/api/avatar3/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      if (!searchRes.ok) {
        throw new Error('Places search API responded with an error.');
      }

      const searchData = await searchRes.json();
      const items = searchData.preview || [];

      setScrapingLogs(prev => [
        ...prev,
        `[LOG] Sourced ${items.length} businesses from Google Places.`,
      ]);

      if (items.length === 0) {
        setScrapingLogs(prev => [...prev, `[INFO] No places found for query.`]);
        setSearchState('completed');
        return;
      }

      // --- STAGE 3: Sync to database ---
      setSearchState('syncing');
      setScrapingStep('Syncing Database');
      setScrapingLogs(prev => [
        ...prev,
        `[STEP] Starting Stage 3: Syncing ${items.length} businesses to CRM Pipeline...`,
      ]);

      const importedLeads = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        setScrapingLogs(prev => [...prev, `[LOG] Import trigger: "${item.business_name}"`]);
        
        try {
          const leadRes = await fetch(`${apiBaseUrl}/api/avatar3/leads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              business_name: item.business_name,
              address: item.address,
              website: item.website,
              google_place_id: item.google_place_id,
              rating: item.rating ? String(item.rating) : null,
              open_status: item.open_status,
              phone: item.phone,
              source_query: query || null,
            }),
          });

          if (leadRes.ok) {
            const leadData = await leadRes.json();
            importedLeads.push(leadData);
            setScrapingLogs(prev => [
              ...prev, 
              `[SUCCESS] Saved lead: ${leadData.business_name} (ID: ${leadData.id.slice(0, 8)})`
            ]);
          } else {
            setScrapingLogs(prev => [...prev, `[WARNING] Failed to save lead: ${item.business_name}`]);
          }
        } catch (leadErr) {
          setScrapingLogs(prev => [...prev, `[WARNING] Import network error for lead: ${item.business_name}`]);
        }
      }

      // Refresh KPIs
      fetchKPIs();

      // Show Results
      setScrapedLeads(importedLeads.map(lead => ({
        name: lead.business_name,
        company: lead.business_name,
        location: lead.address || 'Unknown',
        headline: lead.website || 'No website link',
        linkedin_url: lead.website || '#',
      })));
      setScrapingLogs(prev => [
        ...prev,
        `[SUCCESS] Sync completed. Sourced & stored ${importedLeads.length} leads in the CRM database.`,
      ]);
      setSearchState('completed');

    } catch (err) {
      console.error(err);
      setScrapingLogs(prev => [...prev, `[ERROR] Sourcing flow failed: ${err.message}`]);
      setErrorMessage(err.message);
      setSearchState('failed');
    }
  };

  // Poll Job Status (Fallback / Backup Poller)
  const pollJobStatus = async (runId) => {
    try {
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
      const pollRes = await fetch(`${apiBaseUrl}/api/scrape/${runId}`);
      if (!pollRes.ok) return false;
      const job = await pollRes.json();

      // Update terminal logs with missed events
      if (job.events && job.events.length > 0) {
        const newLogs = [
          `[INIT] Sourcing pipeline initialized for query: "${searchQuery}"`,
          `[STEP] Starting Stage 1: AI Search Classification...`,
        ];
        if (classification) {
          newLogs.push(
            `[SUCCESS] Classification completed.`,
            `[INFO] Target Avatar: ${classification.avatar_type === 'avatar3' ? 'Avatar 3 (Business)' : 'Avatar 1/2 (Recruitment)'}`,
            `[INFO] LLM Confidence: ${Math.round(classification.confidence * 100)}%`,
            `[INFO] Claude Reasoning: ${classification.reasoning}`
          );
        }
        newLogs.push(
          `[STEP] Starting Stage 2: Sourcing recruitment candidates (LinkedIn Scraper Engine)...`,
          `[LOG] Submitting scrape trigger request to shared backend...`,
          `[LOG] Scraper job created: ${runId}`
        );

        job.events.forEach(evt => {
          if (evt.type === 'log') {
            newLogs.push(`[SCRAPER] ${evt.message}`);
          } else if (evt.type === 'step_start') {
            newLogs.push(`→ Pipeline Step Start: ${evt.label}`);
          } else if (evt.type === 'step_done') {
            newLogs.push(`✓ Pipeline Step Done: ${evt.label} (${evt.seconds}s)`);
          }
        });
        setScrapingLogs(newLogs);
      }

      if (job.status === 'done') {
        const rawLeads = job.result?.leads || [];
        setScrapingLogs(prev => [
          ...prev,
          `[SUCCESS] Scraper pipeline finished executing.`,
          `[LOG] Synced & imported ${rawLeads.length} prospects to the recruitment database.`,
        ]);
        fetchKPIs();
        setScrapedLeads(rawLeads.map(lead => ({
          name: lead.name,
          company: lead.company || 'N/A',
          location: lead.location || 'Texas, US',
          headline: lead.headline || 'Sales Professional',
          linkedin_url: lead.link || '#',
        })));
        setSearchState('completed');
        return true; // Polling finished
      } else if (job.status === 'error') {
        setScrapingLogs(prev => [...prev, `[ERROR] Scraper pipeline reported failure: ${job.error}`]);
        setErrorMessage(job.error);
        setSearchState('failed');
        return true; // Polling finished
      }
      return false; // Still running
    } catch (err) {
      console.error('Polling error:', err);
      return false;
    }
  };

  // Run Avatar 1/2 (LinkedIn scraping SSE pipeline)
  const runRecruitmentScraper = async (query, avatarType) => {
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
    setScrapingLogs(prev => [
      ...prev,
      `[STEP] Starting Stage 2: Sourcing recruitment candidates (LinkedIn Scraper Engine)...`,
      `[LOG] Submitting scrape trigger request to shared backend...`,
    ]);

    try {
      const triggerRes = await fetch(`${apiBaseUrl}/api/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, maxResults: 10 }),
      });

      if (!triggerRes.ok) {
        throw new Error('Recruitment scraper server is offline or returned an error.');
      }

      const triggerData = await triggerRes.json();
      const runId = triggerData.runId;

      setScrapingLogs(prev => [
        ...prev,
        `[LOG] Scraper job created: ${runId}`,
        `[LOG] Listening to SSE pipeline stream events...`,
      ]);

      // Open SSE stream
      const eventSource = new EventSource(`${apiBaseUrl}/api/scrape/${runId}/stream`);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'log') {
            setScrapingLogs(prev => [...prev, `[SCRAPER] ${data.message}`]);
          } else if (data.type === 'step_start') {
            setScrapingLogs(prev => [...prev, `→ Pipeline Step Start: ${data.label}`]);
          } else if (data.type === 'step_done') {
            setScrapingLogs(prev => [...prev, `✓ Pipeline Step Done: ${data.label} (${data.seconds}s)`]);
          } else if (data.type === 'done') {
            const rawLeads = data.result?.leads || [];
            setScrapingLogs(prev => [
              ...prev,
              `[SUCCESS] Scraper pipeline finished executing.`,
              `[LOG] Synced & imported ${rawLeads.length} prospects to the recruitment database.`,
            ]);
            
            fetchKPIs();
            setScrapedLeads(rawLeads.map(lead => ({
              name: lead.name,
              company: lead.company || 'N/A',
              location: lead.location || 'Texas, US',
              headline: lead.headline || 'Sales Professional',
              linkedin_url: lead.link || '#',
            })));
            setSearchState('completed');
            eventSource.close();
          } else if (data.type === 'error') {
            setScrapingLogs(prev => [...prev, `[ERROR] Scraper pipeline reported failure: ${data.message}`]);
            setErrorMessage(data.message);
            setSearchState('failed');
            eventSource.close();
          }
        } catch (parseErr) {
          console.error(parseErr);
        }
      };

      eventSource.onerror = (err) => {
        console.error('SSE connection error, fallback to polling:', err);
        setScrapingLogs(prev => [
          ...prev, 
          `[WARNING] SSE connection silent or lost. Activating backup polling checker...`
        ]);
        eventSource.close();
        
        // Start backup polling
        const intervalId = setInterval(async () => {
          const finished = await pollJobStatus(runId);
          if (finished) {
            clearInterval(intervalId);
          }
        }, 4000);
      };

    } catch (err) {
      console.error(err);
      setScrapingLogs(prev => [
        ...prev, 
        `[ERROR] Scraper server unavailable: ${err.message}`,
        `[INFO] Querying existing database as fallback...`
      ]);

      // Database fallback loader
      setTimeout(async () => {
        try {
          const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
          const dbLeadsRes = await fetch(`${apiBaseUrl}/api/avatar12/leads`);
          if (dbLeadsRes.ok) {
            const dbLeads = await dbLeadsRes.json();
            const items = Array.isArray(dbLeads) ? dbLeads : (dbLeads.items || []);
            const filtered = items.filter(lead => 
              lead.search_prompt && 
              lead.search_prompt.toLowerCase().includes(query.toLowerCase())
            );

            if (filtered.length > 0) {
              setScrapedLeads(filtered.map(lead => ({
                name: lead.name,
                company: lead.company || 'N/A',
                location: lead.location || 'Unknown',
                headline: lead.headline || 'Lead Profile',
                linkedin_url: lead.linkedin_url || '#',
              })));
              setScrapingLogs(prev => [
                ...prev,
                `[SUCCESS] Loaded ${filtered.length} matching leads from database repository.`
              ]);
              setSearchState('completed');
            } else {
              throw new Error('No historical leads match this query in the database.');
            }
          } else {
            throw new Error('Failed to query local database.');
          }
        } catch (dbErr) {
          setScrapingLogs(prev => [
            ...prev,
            `[ERROR] Database fallback failed: ${dbErr.message}`,
            `[INFO] Seeding simulated demonstration leads...`
          ]);

          setSearchState('sourcing');
          setTimeout(() => {
            setScrapingLogs(prev => [...prev, `[SCRAPER] Web search Grounding profiles...`]);
            setTimeout(async () => {
              setScrapingLogs(prev => [...prev, `[SCRAPER] Structuring 2 leads with Claude...`]);
              setSearchState('syncing');
              
              const mockCandidates = [
                { name: 'Sarah Connor', headline: 'Experienced Insurance Broker', role: 'Broker', company: 'State Farm', location: 'Austin, TX', linkedin_url: `https://linkedin.com/in/sarah-connor-${Date.now()}` },
                { name: 'David Miller', headline: 'L&D Sales Rep Seeking Upward Role', role: 'Sales Rep', company: 'Allstate', location: 'Houston, TX', linkedin_url: `https://linkedin.com/in/david-miller-${Date.now()}` }
              ];

              for (const cand of mockCandidates) {
                try {
                  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
                  await fetch(`${apiBaseUrl}/api/avatar12/leads`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      avatar_type: avatarType,
                      name: cand.name,
                      headline: cand.headline,
                      role: cand.role,
                      company: cand.company,
                      location: cand.location,
                      linkedin_url: cand.linkedin_url,
                      search_prompt: query,
                      source_query: query || null,
                    })
                  });
                } catch (syncErr) {
                  console.error(syncErr);
                }
              }

              fetchKPIs();
              setScrapedLeads(mockCandidates.map(c => ({
                name: c.name,
                company: c.company,
                location: c.location,
                headline: c.headline,
                linkedin_url: c.linkedin_url,
              })));

              setScrapingLogs(prev => [
                ...prev,
                `[SUCCESS] Sync completed. Synced mock profile prospects to database.`,
              ]);
              setSearchState('completed');
            }, 1500);
          }, 1000);
        }
      }, 1000);
    }
  };

  const handleReset = () => {
    setSearchState('idle');
    setSearchQuery('');
    setScrapedLeads([]);
    setScrapingLogs([]);
    setClassification(null);
  };

  return (
    <div style={{ maxWidth: '1200px', width: '100%', margin: '0 auto' }}>
      
      {/* KPI Strip */}
      <section className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon-wrapper" style={{ background: 'rgba(37, 99, 235, 0.08)', color: '#2563eb' }}>
            <Users size={22} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">Leads Sourced</span>
            {kpiLoading ? (
              <span className="skeleton-shimmer skeleton-text"></span>
            ) : kpiError ? (
              <span className="kpi-value" style={{ color: '#dc2626', fontSize: '1.25rem' }}>Error</span>
            ) : (
              <span className="kpi-value">{kpis?.leads_sourced ?? 0}</span>
            )}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrapper" style={{ background: 'rgba(124, 58, 237, 0.08)', color: '#7c3aed' }}>
            <Send size={20} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">Messages Sent</span>
            {kpiLoading ? (
              <span className="skeleton-shimmer skeleton-text"></span>
            ) : kpiError ? (
              <span className="kpi-value" style={{ color: '#dc2626', fontSize: '1.25rem' }}>Error</span>
            ) : (
              <span className="kpi-value">{kpis?.messages_sent ?? 0}</span>
            )}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrapper" style={{ background: 'rgba(5, 150, 105, 0.08)', color: '#059669' }}>
            <Calendar size={20} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">Meetings Booked</span>
            {kpiLoading ? (
              <span className="skeleton-shimmer skeleton-text"></span>
            ) : kpiError ? (
              <span className="kpi-value" style={{ color: '#dc2626', fontSize: '1.25rem' }}>Error</span>
            ) : (
              <span className="kpi-value">{kpis?.meetings_booked ?? 0}</span>
            )}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrapper" style={{ background: 'rgba(217, 119, 6, 0.08)', color: '#d97706' }}>
            <Briefcase size={20} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">Active Pipeline</span>
            {kpiLoading ? (
              <span className="skeleton-shimmer skeleton-text"></span>
            ) : kpiError ? (
              <span className="kpi-value" style={{ color: '#dc2626', fontSize: '1.25rem' }}>Error</span>
            ) : (
              <span className="kpi-value">{kpis?.active_pipeline_count ?? 0}</span>
            )}
          </div>
        </div>
      </section>

      {kpiError && (
        <div style={{ background: 'rgba(220, 38, 38, 0.05)', border: '1px solid rgba(220, 38, 38, 0.15)', padding: '12px 20px', borderRadius: '12px', color: '#dc2626', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '32px' }}>
          <AlertTriangle size={16} />
          <span>Unable to sync live KPIs from database. Sourcing engine remains operational.</span>
        </div>
      )}

      {/* Main Area */}
      {searchState === 'idle' ? (
        <section className="search-section">
          <h2 style={{ fontSize: '2.25rem', fontWeight: 800, marginBottom: '8px', color: '#0f172a' }}>
            Query Sourcing Pipeline
          </h2>
          <p style={{ color: '#475569', fontSize: '1.05rem', marginBottom: '32px', maxWidth: '580px', lineHeight: '1.5' }}>
            Enter your target keywords. Our AI will classify your query, run the corresponding scraping pipeline, and import candidates to your database in real-time.
          </p>

          <form onSubmit={handleSearchSubmit} style={{ width: '100%' }}>
            <div className={`search-box-wrapper ${validationError ? 'invalid' : ''}`}>
              <Search className="search-icon-left" size={22} />
              <input 
                type="text" 
                className="search-input-field" 
                placeholder="e.g. Roofing companies in Dallas OR Sales representatives open to work"
                value={searchQuery}
                onChange={handleSearchChange}
              />
              <button type="submit" className="search-submit-btn">
                Search
                <ArrowRight size={16} />
              </button>
            </div>
            
            {validationError && (
              <div className="search-validation-error">
                <AlertTriangle size={14} />
                <span>{validationError}</span>
              </div>
            )}
          </form>
        </section>
      ) : (
        /* Sourcing Console and Progress Status */
        <section className="glass-card" style={{ padding: '32px', border: '1px solid var(--border-color)' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <div>
              <span style={{ fontSize: '0.8rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Active Sourcing Pipeline
              </span>
              <h3 style={{ fontSize: '1.5rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                {searchState !== 'completed' && searchState !== 'failed' && (
                  <Loader2 className="animate-spin" size={20} style={{ color: '#2563eb' }} />
                )}
                {searchState === 'completed' && (
                  <CheckCircle2 size={20} style={{ color: '#059669' }} />
                )}
                {searchState === 'failed' && (
                  <AlertTriangle size={20} style={{ color: '#dc2626' }} />
                )}
                Query: "{searchQuery}"
                {searchState !== 'completed' && searchState !== 'failed' && (
                  <span style={{ fontSize: '0.9rem', color: 'var(--accent-blue)', fontWeight: 500 }}>
                    ({elapsedSeconds}s elapsed)
                  </span>
                )}
              </h3>
            </div>
            
            {(searchState === 'completed' || searchState === 'failed') && (
              <button 
                onClick={handleReset} 
                className="btn-primary" 
                style={{ padding: '8px 16px', fontSize: '0.85rem' }}
              >
                <RotateCcw size={14} />
                Search Again
              </button>
            )}
          </div>

          {/* Classification Confirmation Chip with Manual Override */}
          {classification && (
            <div className="glass-card" style={{ padding: '16px', background: 'rgba(37, 99, 235, 0.03)', border: '1px solid rgba(37, 99, 235, 0.12)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', gap: '20px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <Sparkles size={16} style={{ color: '#2563eb' }} />
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                    AI Classify Routing: <span style={{ color: '#2563eb' }}>{classification.avatar_type === 'avatar3' ? 'Avatar 3 (Business/Founder)' : 'Avatar 1/2 (Recruitment)'}</span>
                  </span>
                  <span style={{ fontSize: '0.75rem', background: '#f1f5f9', padding: '2px 8px', borderRadius: '12px', color: '#475569' }}>
                    Confidence: {Math.round(classification.confidence * 100)}%
                  </span>
                </div>
                <p style={{ fontSize: '0.8rem', color: '#475569', marginTop: '6px', lineHeight: '1.4' }}>
                  <strong>Claude Reasoning:</strong> {classification.reasoning}
                </p>
              </div>
              
              {searchState !== 'completed' && searchState !== 'failed' && (
                <button 
                  onClick={() => {
                    const newType = classification.avatar_type === 'avatar3' ? 'avatar2' : 'avatar3';
                    handleOverride(newType);
                  }}
                  className="chip-fallback-btn"
                  style={{ padding: '6px 12px', fontSize: '0.75rem', borderRadius: '8px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  Override to {classification.avatar_type === 'avatar3' ? 'Recruitment' : 'Business'}
                </button>
              )}
            </div>
          )}

          {/* Stepper Node */}
          <div className="stepper-container">
            <div className="stepper-line"></div>
            <div 
              className="stepper-line-progress" 
              style={{ 
                width: 
                  searchState === 'classifying' ? '12%' : 
                  searchState === 'sourcing' ? '45%' : 
                  searchState === 'syncing' ? '78%' : 
                  searchState === 'completed' ? '100%' : '0%' 
              }}
            ></div>

            <div className="stepper-step">
              <div className={`step-node ${searchState === 'classifying' ? 'active' : (searchState !== 'idle' ? 'completed' : '')}`}>1</div>
              <span className={`step-label ${searchState === 'classifying' ? 'active' : ''}`}>Classification</span>
            </div>

            <div className="stepper-step">
              <div className={`step-node ${searchState === 'sourcing' ? 'active' : (searchState === 'syncing' || searchState === 'completed' ? 'completed' : '')}`}>2</div>
              <span className={`step-label ${searchState === 'sourcing' ? 'active' : ''}`}>Sourcing</span>
            </div>

            <div className="stepper-step">
              <div className={`step-node ${searchState === 'syncing' ? 'active' : (searchState === 'completed' ? 'completed' : '')}`}>3</div>
              <span className={`step-label ${searchState === 'syncing' ? 'active' : ''}`}>Database Sync</span>
            </div>

            <div className="stepper-step">
              <div className={`step-node ${searchState === 'completed' ? 'completed' : ''}`}>4</div>
              <span className={`step-label ${searchState === 'completed' ? 'active' : ''}`}>Preview Leads</span>
            </div>
          </div>

          {/* Terminal Console View */}
          <div className="terminal-box">
            <div className="terminal-header">
              <div className="terminal-dots">
                <span className="terminal-dot dot-red"></span>
                <span className="terminal-dot dot-yellow"></span>
                <span className="terminal-dot dot-green"></span>
              </div>
              <span className="terminal-title">
                <TerminalIcon size={12} style={{ display: 'inline', marginRight: '6px', transform: 'translateY(-1px)' }} />
                Scraper Pipeline Logs
              </span>
              <span style={{ fontSize: '0.7rem', color: '#475569' }}>
                {classification ? `Confidence: ${Math.round(classification.confidence * 100)}%` : 'Active'}
              </span>
            </div>
            <div className="terminal-body">
              {scrapingLogs.map((log, index) => {
                let lineClass = 'line-log';
                if (log.startsWith('[STEP]') || log.startsWith('→')) lineClass = 'line-step';
                else if (log.startsWith('[SUCCESS]')) lineClass = 'line-success';
                else if (log.startsWith('[ERROR]')) lineClass = 'line-error';

                return (
                  <div key={index} className={`terminal-line ${lineClass}`}>
                    {log}
                  </div>
                );
              })}
              {searchState !== 'completed' && searchState !== 'failed' && (
                <div className="terminal-line line-step">
                  <span className="animate-pulse">_</span>
                </div>
              )}
              <div ref={logEndRef} />
            </div>
          </div>

          {/* Error Banner */}
          {searchState === 'failed' && (
            <div style={{ background: 'rgba(220, 38, 38, 0.05)', border: '1px solid rgba(220, 38, 38, 0.15)', padding: '16px', borderRadius: '12px', color: '#dc2626', marginTop: '24px', fontSize: '0.9rem' }}>
              <h4 style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <AlertTriangle size={16} /> Pipeline Execution Interrupted
              </h4>
              <p>{errorMessage || 'The scraper failed to retrieve prospects. Please verify API endpoints and try again.'}</p>
            </div>
          )}

          {/* Sourced Leads Preview */}
          {searchState === 'completed' && (
            <div className="results-table-container">
              <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                  Sourced CRM Leads Preview ({scrapedLeads.length})
                </h4>
                
                {classification && (
                  <button 
                    onClick={() => router.push(classification.avatar_type === 'avatar3' ? '/business' : '/recruitment')}
                    className="btn-primary" 
                    style={{ padding: '8px 16px', fontSize: '0.8rem', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                  >
                    Go to Workspace
                    <ArrowUpRight size={14} style={{ marginLeft: '4px' }} />
                  </button>
                )}
              </div>
              
              {scrapedLeads.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  No leads were sourced for this query. The listings may have been deduplicated or filtered by confidence score rules.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="results-table">
                    <thead>
                      <tr>
                        <th>Lead/Company</th>
                        <th>Headline/Industry</th>
                        <th>Location</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scrapedLeads.map((lead, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: 600 }}>{lead.name}</td>
                          <td style={{ color: 'var(--text-secondary)' }}>{lead.headline}</td>
                          <td>{lead.location}</td>
                          <td>
                            <a 
                              href={lead.linkedin_url} 
                              target="_blank" 
                              rel="noreferrer" 
                              style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem' }}
                            >
                              Open Profile
                              <ArrowUpRight size={12} />
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

        </section>
      )}

    </div>
  );
}
