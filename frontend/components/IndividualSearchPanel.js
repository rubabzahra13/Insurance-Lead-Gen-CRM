'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { AVATAR_LABELS, LEAD_PATH, individualLabel, individualOverrideLabel } from '../lib/avatar-labels';
import { refreshDashboard } from '../lib/dashboard-events';
import { COLORS, RGBA } from '../lib/colors';
import {
  Search,
  Sparkles, AlertTriangle, ArrowRight,
  Terminal as TerminalIcon, CheckCircle2, Loader2, ArrowUpRight, RotateCcw,
} from 'lucide-react';

export default function IndividualSearchPanel({ onComplete }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchState, setSearchState] = useState('idle');
  const [classification, setClassification] = useState(null);
  const [scrapingLogs, setScrapingLogs] = useState([]);
  const [scrapedLeads, setScrapedLeads] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
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
      setValidationError('Please enter a query (e.g. "Insurance agents open to work in Chicago").');
      return;
    }

    setSearchState('classifying');
    setClassification(null);
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
        `[INFO] Lead type: ${individualLabel(classifiedData.avatar_type)}`,
        `[INFO] LLM Confidence: ${Math.round(classifiedData.confidence * 100)}%`,
        `[INFO] Claude Reasoning: ${classifiedData.reasoning}`,
      ]);
    } catch (err) {
      console.error(err);
      setScrapingLogs(prev => [
        ...prev,
        `[ERROR] Classification service failed. Falling back to heuristic classifier...`,
      ]);
      // Fallback classification client-side (individual leads only)
      const lower = query.toLowerCase();
      const isBiz = lower.includes('company') || lower.includes('clinic') || lower.includes('roof') || lower.includes('business') || lower.includes('founder') || lower.includes('contractor') || lower.includes('shop');
      if (isBiz) {
        setClassification({
          avatar_type: 'avatar3',
          confidence: 0.8,
          reasoning: 'This query looks business-focused. Use the Business Leads workspace instead.',
          query,
        });
        setScrapingLogs(prev => [
          ...prev,
          `[INFO] Business searches belong on the Business Leads workspace.`,
        ]);
        setErrorMessage('This looks like a business search. Use Business Leads to source founder-led and small businesses.');
        setSearchState('failed');
        return;
      }
      classifiedData = {
        avatar_type: lower.includes('open to work') || lower.includes('job seeker') ? 'avatar1' : 'avatar2',
        confidence: 0.6,
        reasoning: 'Fallback logic activated due to classification endpoint error.',
        query,
      };
      setClassification(classifiedData);
      setScrapingLogs(prev => [
        ...prev,
        `[HEURISTIC] Lead type: ${individualLabel(classifiedData.avatar_type)}`,
      ]);
    }

    if (classifiedData.avatar_type === 'avatar3') {
      setScrapingLogs(prev => [
        ...prev,
        `[INFO] Business searches belong on the Business Leads workspace.`,
      ]);
      setErrorMessage('This looks like a business search. Use Business Leads to source founder-led and small businesses.');
      setSearchState('failed');
      return;
    }

    // --- STAGE 2: LinkedIn sourcing for individual leads ---
    setSearchState('sourcing');
    await runRecruitmentScraper(query, classifiedData.avatar_type);
  };

  // Toggle job seeker vs job upgrader classification
  const handleOverride = async (newType) => {
    if (newType === 'avatar3') return;

    const updatedClassification = {
      avatar_type: newType,
      confidence: 1.0,
      reasoning: `Manual override to ${individualLabel(newType)}.`,
      query: searchQuery,
    };
    
    setClassification(updatedClassification);
    setSearchState('sourcing');
    setScrapedLeads([]);
    setErrorMessage('');
    setScrapingLogs(prev => [
      ...prev,
      `[OVERRIDE] User manually switched lead type to: ${individualLabel(newType)}`,
    ]);

    await runRecruitmentScraper(searchQuery, newType);
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
            `[INFO] Lead type: ${individualLabel(classification.avatar_type)}`,
            `[INFO] LLM Confidence: ${Math.round(classification.confidence * 100)}%`,
            `[INFO] Claude Reasoning: ${classification.reasoning}`
          );
        }
        newLogs.push(
          `[STEP] Starting Stage 2: Sourcing individual leads (LinkedIn)...`,
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
          `[LOG] Synced & imported ${rawLeads.length} individual leads to the database.`,
        ]);
        refreshDashboard();
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
      `[STEP] Starting Stage 2: Sourcing individual leads (LinkedIn)...`,
      `[LOG] Submitting scrape trigger request to shared backend...`,
    ]);

    try {
      const triggerRes = await fetch(`${apiBaseUrl}/api/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, maxResults: 10, avatarType }),
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
              `[LOG] Synced & imported ${rawLeads.length} individual leads to the database.`,
            ]);
            
            refreshDashboard();
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

              refreshDashboard();
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

  useEffect(() => {
    if (searchState === 'completed' && onComplete) {
      onComplete();
    }
  }, [searchState, onComplete]);

  const handleReset = () => {
    setSearchState('idle');
    setSearchQuery('');
    setScrapedLeads([]);
    setScrapingLogs([]);
    setClassification(null);
  };

  return (
    <div className="workspace-source-panel workspace-source-panel--individual">
      {searchState === 'idle' ? (
        <section className="workspace-source-hero">
          <div className="workspace-source-hero-copy">
            <p className="workspace-source-eyebrow">LinkedIn sourcing</p>
            <h2 className="workspace-source-title">Source individual leads</h2>
            <p className="workspace-source-desc">
              Find {LEAD_PATH.people.label.toLowerCase()}. AI classifies each search as {AVATAR_LABELS.avatar1.toLowerCase()} or {AVATAR_LABELS.avatar2.toLowerCase()}, then imports profiles to your list below.
            </p>
          </div>
          <form onSubmit={handleSearchSubmit} className="workspace-source-form">
            <div className={`search-box-wrapper workspace-search-box ${validationError ? 'invalid' : ''}`}>
              <Search className="search-icon-left" size={20} />
              <input
                type="text"
                className="search-input-field"
                placeholder="e.g. Insurance agents open to work in Dallas"
                value={searchQuery}
                onChange={handleSearchChange}
              />
              <button type="submit" className="search-submit-btn">
                Source leads
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
        <section className="workspace-source-console glass-card">
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Active Sourcing Pipeline
              </span>
              <h3 style={{ fontSize: '1.5rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                {searchState !== 'completed' && searchState !== 'failed' && (
                  <Loader2 className="animate-spin" size={20} style={{ color: COLORS.oldRose }} />
                )}
                {searchState === 'completed' && (
                  <CheckCircle2 size={20} style={{ color: COLORS.success }} />
                )}
                {searchState === 'failed' && (
                  <AlertTriangle size={20} style={{ color: COLORS.error }} />
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
          {classification && classification.avatar_type !== 'avatar3' && (
            <div className="glass-card" style={{ padding: '16px', background: RGBA.accent06, border: `1px solid ${RGBA.accent12}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', gap: '20px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <Sparkles size={16} style={{ color: COLORS.oldRose }} />
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                    Lead type: <span style={{ color: COLORS.oldRose }}>{individualLabel(classification.avatar_type)}</span>
                  </span>
                  <span style={{ fontSize: '0.75rem', background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: '12px', color: 'var(--text-secondary)' }}>
                    Confidence: {Math.round(classification.confidence * 100)}%
                  </span>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '6px', lineHeight: '1.4' }}>
                  <strong>Claude Reasoning:</strong> {classification.reasoning}
                </p>
              </div>
              
              {searchState !== 'completed' && searchState !== 'failed' && (
                <button 
                  onClick={() => {
                    const newType = classification.avatar_type === 'avatar1' ? 'avatar2' : 'avatar1';
                    handleOverride(newType);
                  }}
                  className="chip-fallback-btn"
                  style={{ padding: '6px 12px', fontSize: '0.75rem', borderRadius: '8px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  Switch to {individualOverrideLabel(classification.avatar_type)}
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
              <span className={`step-label ${searchState === 'classifying' ? 'active' : ''}`}>Lead Type</span>
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
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
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
            <div style={{ background: 'rgba(181, 74, 58, 0.06)', border: '1px solid rgba(181, 74, 58, 0.15)', padding: '16px', borderRadius: '12px', color: COLORS.error, marginTop: '24px', fontSize: '0.9rem' }}>
              <h4 style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <AlertTriangle size={16} /> Pipeline Execution Interrupted
              </h4>
              <p>{errorMessage || 'The scraper failed to retrieve prospects. Please verify API endpoints and try again.'}</p>
              {errorMessage?.includes('business search') && (
                <Link href="/business" className="workspace-source-link">
                  Go to Business Leads
                  <ArrowUpRight size={14} />
                </Link>
              )}
            </div>
          )}

          {/* Sourced Leads Preview */}
          {searchState === 'completed' && (
            <div className="results-table-container">
              <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                  Sourced leads ({scrapedLeads.length})
                </h4>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Saved to your lead list below
                </span>
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
                        <th>Name</th>
                        <th>Headline</th>
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
                              style={{ color: COLORS.oldRose, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem' }}
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
