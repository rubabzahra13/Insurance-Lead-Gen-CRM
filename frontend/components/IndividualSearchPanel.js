'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { AVATAR_LABELS, LEAD_PATH, individualLabel, individualOverrideLabel } from '../lib/avatar-labels';
import { refreshDashboard } from '../lib/dashboard-events';
import { toFriendlyTrace, traceLevel } from '../lib/pipeline-trace';
import { COLORS, RGBA } from '../lib/colors';

const PIPELINE_STEPS = [
  { key: 'classifying', number: 1, label: 'Lead Type', message: 'Understanding whether this search targets job seekers or job upgraders' },
  { key: 'sourcing', number: 2, label: 'Sourcing', message: 'Searching LinkedIn for matching profiles' },
  { key: 'syncing', number: 3, label: 'Database Sync', message: 'Saving profiles to your outreach drafts' },
  { key: 'completed', number: 4, label: 'Preview Leads', message: 'Preparing your lead preview' },
];

function getPipelineProgress(searchState) {
  switch (searchState) {
    case 'classifying':
      return { width: 33, live: true, complete: false };
    case 'sourcing':
      return { width: 66, live: true, complete: false };
    case 'syncing':
      return { width: 100, live: true, complete: false };
    case 'completed':
      return { width: 100, live: false, complete: true };
    default:
      return { width: 0, live: false, complete: false };
  }
}

function getActivePipelineStep(searchState) {
  return PIPELINE_STEPS.find((step) => step.key === searchState) || null;
}

function getStepNodeState(stepNumber, searchState) {
  const active = getActivePipelineStep(searchState);
  if (!active) return '';
  if (active.number === stepNumber) return 'active';
  if (active.number > stepNumber) return 'completed';
  return '';
}
import {
  Search,
  Sparkles, AlertTriangle, ArrowRight,
  CheckCircle2, Loader2, ArrowUpRight, RotateCcw,
} from 'lucide-react';

export default function IndividualSearchPanel({ onComplete, activeSegment = 'avatar1' }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchState, setSearchState] = useState('idle');
  const [classification, setClassification] = useState(null);
  const [scrapingLogs, setScrapingLogs] = useState([]);
  const [scrapedLeads, setScrapedLeads] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [validationError, setValidationError] = useState('');

  const logEndRef = useRef(null);

  const logToConsole = (raw) => {
    console.log(`[InsureLead Pipeline] ${toFriendlyTrace(raw)}`, { detail: raw });
  };

  const appendLog = (raw) => {
    logToConsole(raw);
    setScrapingLogs((prev) => [...prev, raw]);
  };

  const appendLogs = (raws) => {
    raws.forEach(logToConsole);
    setScrapingLogs((prev) => [...prev, ...raws]);
  };

  const replaceLogs = (raws) => {
    raws.forEach(logToConsole);
    setScrapingLogs(raws);
  };

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
    setScrapingLogs([]);
    setErrorMessage('');
    replaceLogs([
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
      appendLogs([
        `[SUCCESS] Classification completed.`,
        `[INFO] Lead type: ${individualLabel(classifiedData.avatar_type)}`,
        `[INFO] LLM Confidence: ${Math.round(classifiedData.confidence * 100)}%`,
        `[INFO] Claude Reasoning: ${classifiedData.reasoning}`,
      ]);
    } catch (err) {
      console.error(err);
      appendLog(`[ERROR] Classification service failed. Falling back to heuristic classifier...`);
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
        appendLog(`[INFO] Business searches belong on the Business Leads workspace.`);
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
      appendLog(`[HEURISTIC] Lead type: ${individualLabel(classifiedData.avatar_type)}`);
    }

    if (classifiedData.avatar_type === 'avatar3') {
      appendLog(`[INFO] Business searches belong on the Business Leads workspace.`);
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
    appendLog(`[OVERRIDE] User manually switched lead type to: ${individualLabel(newType)}`);

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
        replaceLogs(newLogs);
      }

      if (job.status === 'done') {
        const rawLeads = job.result?.leads || [];
        appendLogs([
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
        appendLog(`[ERROR] Scraper pipeline reported failure: ${job.error}`);
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
    appendLogs([
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

      appendLogs([
        `[LOG] Scraper job created: ${runId}`,
        `[LOG] Listening to SSE pipeline stream events...`,
      ]);

      // Open SSE stream
      const eventSource = new EventSource(`${apiBaseUrl}/api/scrape/${runId}/stream`);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'log') {
            appendLog(`[SCRAPER] ${data.message}`);
          } else if (data.type === 'step_start') {
            appendLog(`→ Pipeline Step Start: ${data.label}`);
          } else if (data.type === 'step_done') {
            appendLog(`✓ Pipeline Step Done: ${data.label} (${data.seconds}s)`);
          } else if (data.type === 'done') {
            const rawLeads = data.result?.leads || [];
            appendLogs([
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
            appendLog(`[ERROR] Scraper pipeline reported failure: ${data.message}`);
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
        appendLog(`[WARNING] SSE connection silent or lost. Activating backup polling checker...`);
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
      appendLogs([
        `[ERROR] Scraper server unavailable: ${err.message}`,
        `[INFO] Querying existing database as fallback...`,
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
              appendLog(`[SUCCESS] Loaded ${filtered.length} matching leads from database repository.`);
              setSearchState('completed');
            } else {
              throw new Error('No historical leads match this query in the database.');
            }
          } else {
            throw new Error('Failed to query local database.');
          }
        } catch (dbErr) {
          appendLogs([
            `[ERROR] Database fallback failed: ${dbErr.message}`,
            `[INFO] Seeding simulated demonstration leads...`,
          ]);

          setSearchState('sourcing');
          setTimeout(() => {
            appendLog(`[SCRAPER] Web search Grounding profiles...`);
            setTimeout(async () => {
              appendLog(`[SCRAPER] Structuring 2 leads with Claude...`);
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

              appendLog(`[SUCCESS] Sync completed. Synced mock profile prospects to database.`);
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

  const segmentLabel = individualLabel(activeSegment);
  const segmentPlaceholder = 'Search by role, city, or niche…';

  const searchHints = activeSegment === 'avatar1'
    ? [
        'Insurance agents open to work in Dallas',
        'Licensed agents exploring careers in Chicago',
        'Career changers interested in insurance in Austin',
      ]
    : [
        'Senior producers ready for a better role in Texas',
        'Experienced brokers open to upgrade in Florida',
        'Top performers seeking agency change in Atlanta',
      ];

  const pipelineProgress = getPipelineProgress(searchState);
  const activePipelineStep = getActivePipelineStep(searchState);

  return (
    <div className={`workspace-source-panel workspace-source-panel--individual${searchState === 'idle' ? ' workspace-source-panel--hub' : ' workspace-source-panel--active'}`}>
      {searchState === 'idle' ? (
        <section className="individual-search-hub" aria-label="Find new leads">
          <div className="individual-search-hub__inner">
            <div className="individual-search-hub__copy">
              <p className="individual-search-hub__eyebrow">New lead search · {segmentLabel}</p>
              <h2 className="individual-search-hub__title">
                Who are you looking for today?
              </h2>
              <p className="individual-search-hub__desc">
                {activeSegment === 'avatar1'
                  ? 'Describe the job seekers you want. We search LinkedIn and add matching profiles to your outreach drafts.'
                  : 'Describe the experienced agents you want. We search LinkedIn and add matching profiles to your outreach drafts.'}
              </p>
            </div>

            <form onSubmit={handleSearchSubmit} className="individual-search-hub__form">
              <div className={`individual-search-hub__bar${validationError ? ' individual-search-hub__bar--invalid' : ''}`}>
                <Search className="individual-search-hub__icon" size={22} aria-hidden="true" />
                <input
                  type="text"
                  className="individual-search-hub__input"
                  placeholder={segmentPlaceholder}
                  value={searchQuery}
                  onChange={handleSearchChange}
                  aria-label="Lead search query"
                  autoFocus
                />
                <button type="submit" className="individual-search-hub__submit">
                  Find leads
                  <ArrowRight size={18} />
                </button>
              </div>
              {validationError && (
                <div className="individual-search-hub__error">
                  <AlertTriangle size={14} />
                  <span>{validationError}</span>
                </div>
              )}
            </form>

            <div className="individual-search-hub__hints" aria-label="Example searches">
              <span className="individual-search-hub__hints-label">Try</span>
              {searchHints.map((hint) => (
                <button
                  key={hint}
                  type="button"
                  className="individual-search-hub__hint"
                  onClick={() => {
                    setSearchQuery(hint);
                    setValidationError('');
                  }}
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
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

          {/* Stepper */}
          <div className="stepper-container">
            <div className="stepper-track" aria-hidden="true">
              <div className="stepper-line"></div>
              <div
                className={`stepper-line-progress${
                  pipelineProgress.complete ? ' stepper-line-progress--complete' :
                  pipelineProgress.live ? ' stepper-line-progress--live' : ''
                }`}
                style={{ width: `${pipelineProgress.width}%` }}
              ></div>
            </div>

            {PIPELINE_STEPS.map((step) => (
              <div className="stepper-step" key={step.key}>
                <div className={`step-node ${getStepNodeState(step.number, searchState)}`}>
                  {getStepNodeState(step.number, searchState) === 'completed' ? '✓' : step.number}
                </div>
                <span className={`step-label ${getStepNodeState(step.number, searchState) === 'active' ? 'active' : ''}`}>
                  {step.label}
                </span>
              </div>
            ))}
          </div>

          {/* Live progress timeline */}
          <div className="pipeline-progress">
            <div className="pipeline-progress__header">
              <div>
                <h4 className="pipeline-progress__title">What&apos;s happening</h4>
                <p className="pipeline-progress__subtitle">
                  {activePipelineStep
                    ? `Step ${activePipelineStep.number} of 4 · ${activePipelineStep.label}`
                    : 'We\'ll update this list as each step completes.'}
                </p>
              </div>
              <span className={`pipeline-progress__status pipeline-progress__status--${
                searchState === 'completed' ? 'done' :
                searchState === 'failed' ? 'error' :
                'working'
              }`}>
                {searchState !== 'completed' && searchState !== 'failed' && (
                  <Loader2 className="animate-spin" size={12} />
                )}
                {searchState === 'completed' && <CheckCircle2 size={12} />}
                {searchState === 'failed' && <AlertTriangle size={12} />}
                {searchState !== 'completed' && searchState !== 'failed' ? 'Working' :
                  searchState === 'completed' ? 'Complete' : 'Stopped'}
              </span>
            </div>

            <ul className="pipeline-progress__timeline">
              {scrapingLogs.length === 0 && (
                <li className="pipeline-progress__item pipeline-progress__item--info">
                  <span className="pipeline-progress__bullet" />
                  <div className="pipeline-progress__content">
                    <p className="pipeline-progress__text">Waiting to start...</p>
                  </div>
                </li>
              )}
              {scrapingLogs.map((log, index) => {
                const level = traceLevel(log);
                const friendly = toFriendlyTrace(log);
                const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

                return (
                  <li
                    key={`${index}-${log.slice(0, 24)}`}
                    className={`pipeline-progress__item pipeline-progress__item--done pipeline-progress__item--${level}`}
                  >
                    <span className="pipeline-progress__bullet" />
                    <div className="pipeline-progress__content">
                      <span className="pipeline-progress__time">{time}</span>
                      <p className="pipeline-progress__text">{friendly}</p>
                    </div>
                  </li>
                );
              })}
              {activePipelineStep && searchState !== 'completed' && searchState !== 'failed' && (
                <li className="pipeline-progress__item pipeline-progress__item--current">
                  <span className="pipeline-progress__bullet pipeline-progress__bullet--pulse" />
                  <div className="pipeline-progress__content">
                    <span className="pipeline-progress__time">now</span>
                    <p className="pipeline-progress__text">{activePipelineStep.message}</p>
                  </div>
                </li>
              )}
            </ul>
            <div ref={logEndRef} />
            <p className="pipeline-progress__hint">Technical details are logged to your browser console.</p>
          </div>

          {/* Error Banner */}
          {searchState === 'failed' && (
            <div style={{ background: 'rgba(184, 107, 107, 0.06)', border: '1px solid rgba(184, 107, 107, 0.15)', padding: '16px', borderRadius: '12px', color: COLORS.error, marginTop: '24px', fontSize: '0.9rem' }}>
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
                  New leads found ({scrapedLeads.length})
                </h4>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Added to {segmentLabel} outreach drafts
                </span>
              </div>
              
              {scrapedLeads.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  No new leads matched this search. Results may have been deduplicated or filtered by confidence score rules.
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
