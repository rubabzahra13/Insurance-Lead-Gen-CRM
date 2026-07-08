import { useEffect, useState } from 'react';
import PipelineSteps from '../PipelineSteps.jsx';
import SearchTips from '../SearchTips.jsx';
import { exportUrl, fetchRun, startScrape, streamScrape } from '../../lib/api.js';
import { confidencePercent, confidenceToneClass } from '../../lib/confidence-tone.js';

const EXAMPLES = [
  'CEOs in marketing in San Francisco',
  'founders of AI startups in New York',
  'VP Sales at SaaS companies',
];

const DEFAULT_MAX_RESULTS = 25;

export default function SearchDialog({ open, onClose, onComplete, onLeadsPreview }) {
  const [query, setQuery] = useState('');
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState(null);
  const [events, setEvents] = useState([]);
  const [result, setResult] = useState(null);
  const [kbImport, setKbImport] = useState(null);
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setRunning(false);
      setRunId(null);
      setEvents([]);
      setResult(null);
      setKbImport(null);
      setError(null);
      setLogs([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape' && !running) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, running, onClose]);

  useEffect(() => {
    if (!runId || !running) return undefined;

    let pollTimer;
    let stopped = false;

    function applyJob(job) {
      if (job.events?.length) {
        setEvents((prev) => {
          const seen = new Set(prev.map((e) => JSON.stringify(e)));
          const merged = [...prev];
          for (const event of job.events) {
            const key = JSON.stringify(event);
            if (!seen.has(key)) merged.push(event);
          }
          return merged;
        });
      }
      if (job.status === 'done' && job.result) {
        setResult(job.result);
        setRunning(false);
        onComplete?.(job.result, job.kb, query, runId);
        return true;
      }
      if (job.status === 'error') {
        setError(job.error ?? 'Search failed');
        setRunning(false);
        return true;
      }
      return false;
    }

    function startPolling() {
      if (pollTimer) return;
      pollTimer = setInterval(async () => {
        if (stopped) return;
        try {
          const job = await fetchRun(runId);
          if (applyJob(job)) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
        } catch {
          /* keep polling */
        }
      }, 3000);
    }

    const stopStream = streamScrape(runId, (event) => {
      setEvents((prev) => [...prev, event]);
      if (event.type === 'log') setLogs((prev) => [...prev.slice(-60), event.message]);
      if (event.type === 'leads_preview' || event.type === 'leads_ready') {
        onLeadsPreview?.(event.leads ?? [], runId, query, event.stage ?? event.type);
      }
      if (event.type === 'complete' || event.type === 'done') {
        setResult(event.result);
        setKbImport(event.kb ?? null);
        setRunning(false);
        onComplete?.(event.result, event.kb, query, runId);
      }
      if (event.type === 'error') {
        setError(event.message);
        setRunning(false);
      }
    }, { onDisconnect: startPolling });

    return () => {
      stopped = true;
      stopStream();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [runId, running, onComplete, onLeadsPreview, query]);

  const stats = result?.stats;
  const leads = result?.leads ?? [];

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setKbImport(null);
    setEvents([]);
    setLogs([]);
    setRunning(true);

    try {
      const { runId: id } = await startScrape(
        query.startsWith('scrape') ? query : `scrape linkedin ${query}`,
        DEFAULT_MAX_RESULTS,
      );
      setRunId(id);
    } catch (err) {
      setError(err.message);
      setRunning(false);
    }
  }

  if (!open) return null;

  return (
    <div className="desk-modal-backdrop animate-fade-in fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh] backdrop-blur-sm">
      <div
        className="desk-modal animate-slide-up flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="New search"
      >
        <div className="desk-modal-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="desk-brand-mark">L</div>
            <div>
              <h2 className="desk-modal-title">New search</h2>
              <p className="desk-modal-subtitle">Find leads and add them to your KB</p>
            </div>
          </div>
          {!running && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-muted transition hover:bg-surface hover:text-fg-secondary"
            >
              ✕
            </button>
          )}
        </div>

        <div className="desk-scroll flex-1 overflow-y-auto p-5">
          {!result ? (
            <>
              <div className="desk-notice-accent mb-4 px-4 py-3 text-sm">
                <p className="font-medium">Lead generation takes up to 2 minutes</p>
                <p className="mt-1 opacity-90">
                  The full process — web search, AI structuring, and verification — runs in the
                  background. Keep this window open until it completes.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="desk-modal-search-row">
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="e.g. founders of AI startups in New York"
                    disabled={running}
                    className="desk-modal-input desk-modal-search-input"
                  />
                  <button
                    type="submit"
                    disabled={running || !query.trim()}
                    className="desk-btn desk-btn-primary desk-modal-search-btn"
                  >
                    {running ? 'Searching…' : 'Run search'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      disabled={running}
                      onClick={() => setQuery(ex)}
                      className="desk-modal-chip"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </form>

              {!running && (
                <div className="mt-4">
                  <SearchTips />
                </div>
              )}

              {error && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {error}
                </div>
              )}

              {(running || events.length > 0) && (
                <div className="mt-6 space-y-4">
                  <PipelineSteps events={events} running={running} />
                  <div className="desk-modal-log max-h-32 overflow-y-auto p-3">
                    {logs.length === 0 ? 'Starting…' : logs.map((line, i) => <div key={i}>{line}</div>)}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="desk-modal-panel px-4 py-4">
                <p className="font-semibold text-fg">
                  {stats?.exported ?? leads.length} leads found
                </p>
                <p className="mt-1 text-sm text-fg-secondary">
                  {kbImport
                    ? `${kbImport.leadsAdded} added to KB${
                        kbImport.duplicatesFound
                          ? ` · ${kbImport.duplicatesFound} need review`
                          : ''
                      }`
                    : 'Saved to knowledge base'}
                </p>
              </div>
              <ul className="divide-y divide-border rounded-xl border border-border bg-panel">
                {leads.slice(0, 8).map((lead) => (
                  <li key={`${lead.name}-${lead.link}`} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="font-medium text-fg">{lead.name}</p>
                      <p className="text-sm text-muted">
                        {[lead.title, lead.company].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${confidenceToneClass(confidencePercent(lead.confidence))}`}
                    >
                      {confidencePercent(lead.confidence)}%
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                {runId && leads.length > 0 && (
                  <a href={exportUrl(runId)} className="desk-btn desk-btn-secondary">
                    Download .xlsx
                  </a>
                )}
                <button type="button" onClick={onClose} className="desk-btn desk-btn-primary">
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
