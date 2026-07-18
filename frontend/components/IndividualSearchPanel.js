'use client';

import React, { useState, useEffect, useRef } from 'react';
import { individualLabel } from '../lib/avatar-labels';
import { refreshDashboard } from '../lib/dashboard-events';
import { toFriendlyTrace } from '../lib/pipeline-trace';
import { COLORS } from '../lib/colors';

const PIPELINE_STEPS = [
  {
    key: 'planning',
    number: 1,
    label: 'Plan search',
    message: 'AI is turning your query into a search checklist',
    match: /checklist|building search/i,
  },
  {
    key: 'searching',
    number: 2,
    label: 'Google search',
    message: 'Searching Google for matching LinkedIn profiles',
    match: /google search|serp/i,
  },
  {
    key: 'structuring',
    number: 3,
    label: 'Filter matches',
    message: 'Structuring profiles and filtering against the checklist',
    match: /structur|reading|quality filter/i,
  },
  {
    key: 'verifying',
    number: 4,
    label: 'Verify & save',
    message: 'Checking profile links and saving to outreach drafts',
    match: /verif|scor|export|sync/i,
  },
];

function pipelineStepFromLabel(label) {
  if (!label) return null;
  return PIPELINE_STEPS.find((step) => step.match.test(label)) || null;
}

function getPipelineProgress(searchState) {
  switch (searchState) {
    case 'planning':
      return { width: 25, live: true, complete: false };
    case 'searching':
      return { width: 50, live: true, complete: false };
    case 'structuring':
      return { width: 75, live: true, complete: false };
    case 'verifying':
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

// Pipeline leads use `title` for the person's headline and `link` for the
// profile URL. Never invent placeholder values — show only real scraped data.
// Job-status phrases ("Open to work") are valid headlines but not companies.
const STATUS_PHRASES = ['open to work', 'opentowork', 'seeking new opportunities', 'looking for opportunities'];

function withoutStatusPhrase(value) {
  if (typeof value === 'string' && STATUS_PHRASES.some((p) => value.toLowerCase().includes(p))) {
    return null;
  }
  return value;
}

const FIT_SOURCE_LABELS = {
  profile: 'From their profile',
  own_post: 'From their own post',
  company_page: 'From company page',
  other: 'Other source — weak evidence',
};

function mapPipelineLeads(rawLeads) {
  return rawLeads.map((lead) => ({
    name: lead.name,
    company: withoutStatusPhrase(lead.company) || null,
    location: lead.location || null,
    headline: lead.title || lead.headline || null,
    linkedin_url: lead.link || null,
    fit_evidence: lead.fit_evidence || null,
    fit_source: lead.fit_source || null,
    weak_fields: Array.isArray(lead.weak_fields) ? lead.weak_fields : [],
  }));
}

function getStepNodeState(stepNumber, searchState) {
  if (searchState === 'completed') return 'completed';
  if (searchState === 'failed') {
    const active = getActivePipelineStep(searchState);
    if (!active) return '';
    if (active.number > stepNumber) return 'completed';
    if (active.number === stepNumber) return 'active';
    return '';
  }
  const active = getActivePipelineStep(searchState);
  if (!active) return '';
  if (active.number === stepNumber) return 'active';
  if (active.number > stepNumber) return 'completed';
  return '';
}
import {
  Search,
  AlertTriangle, ArrowRight,
  CheckCircle2, Loader2, ArrowUpRight, RotateCcw,
} from 'lucide-react';
import LocationPicker from './LocationPicker';

export default function IndividualSearchPanel({ onComplete, activeSegment = 'avatar1' }) {
  const [roleQuery, setRoleQuery] = useState('');
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [searchState, setSearchState] = useState('idle');
  const [scrapingLogs, setScrapingLogs] = useState([]);
  const [scrapedLeads, setScrapedLeads] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [validationError, setValidationError] = useState('');

  const displayQuery = selectedLocation?.label
    ? `${roleQuery.trim()} in ${selectedLocation.label}`
    : roleQuery.trim();

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

  // Elapsed Timer
  useEffect(() => {
    let timer;
    const running = searchState === 'planning'
      || searchState === 'searching'
      || searchState === 'structuring'
      || searchState === 'verifying';
    if (running) {
      timer = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => clearInterval(timer);
  }, [searchState]);

  const advancePipelineStep = (label) => {
    const step = pipelineStepFromLabel(label);
    if (step) setSearchState(step.key);
  };

  const handleRoleChange = (e) => {
    setRoleQuery(e.target.value);
    if (e.target.value.trim()) {
      setValidationError('');
    }
  };

  // Main Sourcing Flow Trigger
  const handleSearchSubmit = async (e) => {
    e.preventDefault();
    const role = roleQuery.trim();

    if (!role) {
      setValidationError('Please enter a role (e.g. "Insurance producers").');
      return;
    }

    // Location must come from the Places dropdown (placeId), never free text.
    if (selectedLocation && !selectedLocation.placeId) {
      setValidationError('Please pick a location from the dropdown list.');
      return;
    }

    setSearchState('planning');
    setScrapedLeads([]);
    setErrorMessage('');
    replaceLogs([
      `[INIT] Lead search started for role: "${role}"` +
        (selectedLocation?.label ? `, location: "${selectedLocation.label}"` : ' (no location)'),
      `[INFO] Lead type: ${individualLabel(activeSegment)} (selected workspace)`,
      `[INFO] Engine: Google search (SERP) + AI filtering`,
    ]);

    await runRecruitmentScraper(role, activeSegment, selectedLocation);
  };

  // Poll Job Status (Fallback / Backup Poller)
  const pollJobStatus = async (runId) => {
    try {
      const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000');
      const pollRes = await fetch(`${apiBaseUrl}/api/scrape/${runId}`);
      if (!pollRes.ok) return false;
      const job = await pollRes.json();

      // Update terminal logs with missed events
      if (job.events && job.events.length > 0) {
        const newLogs = [
          `[INIT] Lead search started for role: "${roleQuery}"` +
            (selectedLocation?.label ? `, location: "${selectedLocation.label}"` : ''),
          `[INFO] Lead type: ${individualLabel(activeSegment)} (selected workspace)`,
          `[INFO] Engine: Google search (SERP) + AI filtering`,
          `[LOG] Search job created: ${runId}`,
        ];

        job.events.forEach((evt) => {
          if (evt.type === 'log') {
            newLogs.push(`[SCRAPER] ${evt.message}`);
          } else if (evt.type === 'step_start') {
            newLogs.push(`→ Pipeline Step Start: ${evt.label}`);
            advancePipelineStep(evt.label);
          } else if (evt.type === 'step_done') {
            newLogs.push(`✓ Pipeline Step Done: ${evt.label} (${evt.seconds}s)`);
          }
        });
        replaceLogs(newLogs);
      }

      if (job.status === 'done') {
        const rawLeads = job.result?.leads || [];
        appendLogs([
          `[SUCCESS] Lead search finished.`,
          `[LOG] Synced & imported ${rawLeads.length} individual leads to the database.`,
        ]);
        refreshDashboard();
        setScrapedLeads(mapPipelineLeads(rawLeads));
        setSearchState('completed');
        reportCompletion(rawLeads, displayQuery);
        return true; // Polling finished
      } else if (job.status === 'error') {
        appendLog(`[ERROR] Lead search failed: ${job.error}`);
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

  // Run Avatar 1/2 via the SERP experimental engine (same as Compare page).
  const runRecruitmentScraper = async (role, avatarType, location) => {
    const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000');
    appendLogs([
      `[STEP] Starting Google search for matching profiles...`,
      `[LOG] Submitting search request...`,
    ]);

    try {
      const triggerRes = await fetch(`${apiBaseUrl}/api/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          location: location || null,
          maxResults: 25,
          avatarType,
          provider: 'serpapi',
        }),
      });

      if (!triggerRes.ok) {
        throw new Error('Lead search server is offline or returned an error.');
      }

      const triggerData = await triggerRes.json();
      const runId = triggerData.runId;

      appendLogs([
        `[LOG] Search job created: ${runId}`,
        `[LOG] Listening for live progress...`,
      ]);

      // Open SSE stream
      const eventSource = new EventSource(`${apiBaseUrl}/api/scrape/${runId}/stream`);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'log') {
            appendLog(`[SCRAPER] ${data.message}`);
          } else if (data.type === 'leads_preview') {
            // Preview event only advances the step — table shows after search completes.
            const previewLeads = data.leads || [];
            if (previewLeads.length > 0) {
              setSearchState('verifying');
              appendLog(`[LOG] Found ${previewLeads.length} candidates — verifying profiles...`);
            }
          } else if (data.type === 'step_start') {
            advancePipelineStep(data.label);
            appendLog(`→ Pipeline Step Start: ${data.label}`);
          } else if (data.type === 'step_done') {
            appendLog(`✓ Pipeline Step Done: ${data.label} (${data.seconds}s)`);
          } else if (data.type === 'done') {
            const rawLeads = data.result?.leads || [];
            appendLogs([
              `[SUCCESS] Lead search finished.`,
              `[LOG] Synced & imported ${rawLeads.length} individual leads to the database.`,
            ]);

            refreshDashboard();
            setScrapedLeads(mapPipelineLeads(rawLeads));
            setSearchState('completed');
            reportCompletion(rawLeads, displayQuery);
            eventSource.close();
          } else if (data.type === 'error') {
            appendLog(`[ERROR] Lead search failed: ${data.message}`);
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
        appendLog(`[WARNING] Live progress paused — checking job status instead...`);
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
      // No fallbacks: a failed run must never show old or invented leads.
      console.error(err);
      appendLog(`[ERROR] Lead search server unavailable: ${err.message}`);
      setErrorMessage(err.message);
      setSearchState('failed');
    }
  };

  // Reported to the parent when a run finishes so the drafts list can mark which
  // rows this search produced. Sorting by created_at cannot do that: a person we
  // already had is UPDATED, not inserted, so they keep an old timestamp and sink
  // hundreds of rows down even though this search just returned them.
  const reportCompletion = (rawLeads, query) => {
    onComplete?.({
      query,
      role: roleQuery.trim() || null,
      location: selectedLocation?.label || selectedLocation?.mainText || null,
      leads: (rawLeads || []).map((lead) => ({
        name: lead.name || null,
        linkedin_url: lead.link || null,
      })),
    });
  };

  const handleReset = () => {
    setSearchState('idle');
    setRoleQuery('');
    setSelectedLocation(null);
    setScrapedLeads([]);
    setScrapingLogs([]);
  };

  const segmentLabel = individualLabel(activeSegment);
  const rolePlaceholder = activeSegment === 'avatar1'
    ? 'Role or major (e.g. Finance graduates)'
    : 'Role (e.g. Insurance producers)';

  const searchHints = activeSegment === 'avatar1'
    ? [
        { role: 'Insurance graduates' },
        { role: 'Finance students' },
        { role: 'Sales majors' },
      ]
    : [
        { role: 'Insurance producers' },
        { role: 'Insurance brokers' },
        { role: 'Agency producers' },
      ];

  const pipelineProgress = getPipelineProgress(searchState);

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
                  ? 'Enter a role or major, then pick a city or country. We add recent-graduate filters, search Google, and save matches to your outreach drafts.'
                  : 'Enter a role, then pick a city or country. We look for producers/agents at small agencies (or upskilling talk)—not CEOs or founders.'}
              </p>
            </div>

            <form onSubmit={handleSearchSubmit} className="individual-search-hub__form">
              <div className={`individual-search-hub__fields${validationError ? ' individual-search-hub__fields--invalid' : ''}`}>
                <div className="individual-search-hub__role">
                  <label className="individual-search-hub__label" htmlFor="lead-role-input">Role</label>
                  <div className="individual-search-hub__bar">
                    <Search className="individual-search-hub__icon" size={20} aria-hidden="true" />
                    <input
                      id="lead-role-input"
                      type="text"
                      className="individual-search-hub__input"
                      placeholder={rolePlaceholder}
                      value={roleQuery}
                      onChange={handleRoleChange}
                      aria-label="Role"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="individual-search-hub__location">
                  <label className="individual-search-hub__label" htmlFor="lead-location-input">Location</label>
                  <LocationPicker
                    value={selectedLocation}
                    onChange={setSelectedLocation}
                    invalid={Boolean(validationError)}
                  />
                </div>
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
                  key={hint.role}
                  type="button"
                  className="individual-search-hub__hint"
                  onClick={() => {
                    setRoleQuery(hint.role);
                    setSelectedLocation(null);
                    setValidationError('');
                  }}
                >
                  {hint.role}
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <section className="search-track" aria-live="polite">
          <header className="search-track__header">
            <div className="search-track__heading">
              <p className="search-track__eyebrow">
                {searchState === 'completed'
                  ? 'Search finished'
                  : searchState === 'failed'
                    ? 'Search stopped'
                    : 'Searching now'}
              </p>
              <h3 className="search-track__query">&ldquo;{displayQuery}&rdquo;</h3>
              <p className="search-track__meta">
                {segmentLabel}
                {searchState !== 'completed' && searchState !== 'failed' && (
                  <> · {elapsedSeconds}s</>
                )}
              </p>
            </div>

            {(searchState === 'completed' || searchState === 'failed') ? (
              <button type="button" onClick={handleReset} className="search-track__again">
                <RotateCcw size={14} />
                Search again
              </button>
            ) : (
              <div className="search-track__live">
                <Loader2 className="animate-spin" size={16} />
                <span>In progress</span>
              </div>
            )}
          </header>

          <div className="search-track__bar" aria-hidden="true">
            <div
              className={`search-track__bar-fill${
                searchState === 'completed' ? ' search-track__bar-fill--done' :
                searchState === 'failed' ? ' search-track__bar-fill--error' : ''
              }`}
              style={{ width: `${pipelineProgress.width}%` }}
            />
          </div>

          <ol className="search-track__steps">
            {PIPELINE_STEPS.map((step) => {
              const state = getStepNodeState(step.number, searchState);
              const isActive = state === 'active';
              const isDone = state === 'completed';
              return (
                <li
                  key={step.key}
                  className={`search-track__step search-track__step--${state || 'pending'}`}
                >
                  <span className="search-track__step-mark" aria-hidden="true">
                    {isDone ? <CheckCircle2 size={18} /> : isActive ? (
                      <Loader2 className="animate-spin" size={18} />
                    ) : (
                      <span className="search-track__step-num">{step.number}</span>
                    )}
                  </span>
                  <div className="search-track__step-body">
                    <div className="search-track__step-row">
                      <span className="search-track__step-label">{step.label}</span>
                      <span className="search-track__step-state">
                        {isDone ? 'Done' : isActive ? 'Now' : 'Waiting'}
                      </span>
                    </div>
                    {isActive && searchState !== 'failed' && (
                      <p className="search-track__step-detail">{step.message}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          {searchState !== 'completed' && searchState !== 'failed' && (
            <p className="search-track__note">
              Do not leave this page until the search is complete. Results save to Outreach Drafts automatically.
            </p>
          )}

          {searchState === 'failed' && (
            <div className="search-track__error">
              <AlertTriangle size={16} />
              <div>
                <strong>Search interrupted</strong>
                <p>{errorMessage || 'The search could not finish. Please try again.'}</p>
              </div>
            </div>
          )}

          {searchState === 'completed' && (
            <div className="results-table-container search-track__results">
              <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {`New leads found (${scrapedLeads.length})`}
                </h4>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {`Added to ${segmentLabel} outreach drafts`}
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
                        <th>Why they fit</th>
                        <th>Location</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scrapedLeads.map((lead, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: 600 }}>{lead.name}</td>
                          <td style={{ color: 'var(--text-secondary)' }}>{lead.headline || '—'}</td>
                          <td style={{ maxWidth: '260px' }}>
                            {lead.fit_evidence ? (
                              <>
                                <span style={{ fontSize: '0.85rem' }}>&ldquo;{lead.fit_evidence}&rdquo;</span>
                                {lead.fit_source && (
                                  <div style={{
                                    fontSize: '0.7rem',
                                    marginTop: '4px',
                                    color: lead.fit_source === 'other' ? COLORS.error : 'var(--text-muted)',
                                  }}>
                                    {FIT_SOURCE_LABELS[lead.fit_source] || lead.fit_source}
                                  </div>
                                )}
                              </>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                          <td>{lead.location || '—'}</td>
                          <td>
                            {lead.linkedin_url ? (
                              <a
                                href={lead.linkedin_url}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: COLORS.oldRose, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem' }}
                              >
                                Open Profile
                                <ArrowUpRight size={12} />
                              </a>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No profile link</span>
                            )}
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
