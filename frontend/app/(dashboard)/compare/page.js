'use client';

// Side-by-side test bench: run the same query through the current engine
// (Claude web search) and the experimental engine (SERP API) and compare
// speed + result quality. If SERP wins consistently, we swap it into the
// main search. This page does not affect the live recruitment flow.

import React, { useState } from 'react';
import { Sparkles, Loader2, CheckCircle2, AlertTriangle, Clock, Users, ArrowUpRight } from 'lucide-react';
import { getApiBaseUrl } from '../../../lib/apiBaseUrl';
import { API_CACHE_KEYS, invalidateApiCache } from '../../../lib/api-cache';
import { refreshDashboard } from '../../../lib/dashboard-events';
import { COLORS } from '../../../lib/colors';

const AVATARS = [
  { id: 'avatar1', label: 'Recent graduates (entry-level)' },
  { id: 'avatar2', label: 'Upgraders (small-firm agents)' },
];

const ENGINES = [
  { key: 'current', title: 'Current engine', subtitle: 'Claude web search', provider: undefined },
  { key: 'serpapi', title: 'Experimental engine', subtitle: 'SERP API (fast Google)', provider: 'serpapi' },
];

function emptyRun() {
  return { status: 'idle', seconds: 0, leads: [], error: null };
}

export default function ComparePage() {
  const [query, setQuery] = useState('');
  const [avatar, setAvatar] = useState('avatar1');
  const [runs, setRuns] = useState({ current: emptyRun(), serpapi: emptyRun() });
  const [busy, setBusy] = useState(false);

  const apiBase = getApiBaseUrl();

  const pollJob = async (runId) => {
    // Poll until the job finishes; return the final job object.
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const res = await fetch(`${apiBase}/api/scrape/${runId}`);
      if (!res.ok) continue;
      const job = await res.json();
      if (job.status === 'done' || job.status === 'error') return job;
    }
    return { status: 'error', error: 'Timed out after 4.5 minutes' };
  };

  const runEngine = async (engine) => {
    const startedAt = Date.now();
    const tick = setInterval(() => {
      setRuns((prev) => ({
        ...prev,
        [engine.key]: { ...prev[engine.key], seconds: Math.round((Date.now() - startedAt) / 1000) },
      }));
    }, 1000);

    try {
      const body = { query, maxResults: 25, avatarType: avatar };
      if (engine.provider) body.provider = engine.provider;
      const res = await fetch(`${apiBase}/api/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Could not start job');
      const { runId } = await res.json();
      const job = await pollJob(runId);
      clearInterval(tick);

      if (job.status === 'error') {
        setRuns((prev) => ({
          ...prev,
          [engine.key]: { ...prev[engine.key], status: 'error', error: job.error || 'Failed' },
        }));
        return;
      }
      const leads = job.result?.leads || [];
      setRuns((prev) => ({
        ...prev,
        [engine.key]: {
          status: 'done',
          seconds: Math.round((Date.now() - startedAt) / 1000),
          leads,
          error: null,
        },
      }));
    } catch (err) {
      clearInterval(tick);
      setRuns((prev) => ({
        ...prev,
        [engine.key]: { ...prev[engine.key], status: 'error', error: err.message },
      }));
    }
  };

  const runBoth = async (e) => {
    e.preventDefault();
    if (!query.trim() || busy) return;
    setBusy(true);
    setRuns({
      current: { ...emptyRun(), status: 'running' },
      serpapi: { ...emptyRun(), status: 'running' },
    });
    await Promise.all(ENGINES.map(runEngine));
    // Leads from these runs are saved like any other search — clear the cached
    // lead list so the Outreach Drafts tab shows them immediately.
    invalidateApiCache([API_CACHE_KEYS.avatar12Leads, API_CACHE_KEYS.funnel]);
    refreshDashboard();
    setBusy(false);
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
        <Sparkles size={22} style={{ color: COLORS.oldRose }} />
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Search Engine Comparison</h2>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', fontSize: '0.9rem' }}>
        Run the same search two ways and compare speed and results. Leads from both are saved to
        your Outreach Drafts as usual. This is a test bench — your normal search is unchanged.
      </p>

      <form onSubmit={runBoth} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <select
          value={avatar}
          onChange={(e) => setAvatar(e.target.value)}
          style={{ padding: '12px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}
        >
          {AVATARS.map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </select>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. insurance agents in Chicago"
          style={{ flex: 1, minWidth: '240px', padding: '12px 16px', borderRadius: '10px', border: '1px solid var(--border-color)' }}
        />
        <button
          type="submit"
          disabled={busy || !query.trim()}
          className="btn-primary"
          style={{ padding: '12px 24px', opacity: busy || !query.trim() ? 0.6 : 1 }}
        >
          {busy ? <Loader2 className="animate-spin" size={16} /> : 'Run both engines'}
        </button>
      </form>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '20px' }}>
        {ENGINES.map((engine) => {
          const run = runs[engine.key];
          return (
            <div key={engine.key} className="glass-card" style={{ padding: '18px', border: '1px solid var(--border-color)', borderRadius: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                <div>
                  <h3 style={{ fontWeight: 700, fontSize: '1.05rem' }}>{engine.title}</h3>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{engine.subtitle}</span>
                </div>
                {run.status === 'running' && <Loader2 className="animate-spin" size={18} style={{ color: COLORS.oldRose }} />}
                {run.status === 'done' && <CheckCircle2 size={18} style={{ color: COLORS.success }} />}
                {run.status === 'error' && <AlertTriangle size={18} style={{ color: COLORS.error }} />}
              </div>

              <div style={{ display: 'flex', gap: '18px', marginBottom: '14px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
                  <Clock size={14} /> {run.seconds}s
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
                  <Users size={14} /> {run.leads.length} leads
                </span>
              </div>

              {run.status === 'error' && (
                <p style={{ color: COLORS.error, fontSize: '0.85rem' }}>{run.error}</p>
              )}

              {run.status === 'idle' && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Waiting to run…</p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '460px', overflowY: 'auto' }}>
                {run.leads.map((lead, idx) => (
                  <div key={idx} style={{ padding: '10px', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                      <strong style={{ fontSize: '0.9rem' }}>{lead.name}</strong>
                      {lead.link && (
                        <a href={lead.link} target="_blank" rel="noreferrer" style={{ color: COLORS.oldRose, fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                          Profile <ArrowUpRight size={11} />
                        </a>
                      )}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {lead.title || '—'}{lead.company ? ` · ${lead.company}` : ''}
                    </div>
                    {lead.fit_evidence && (
                      <div style={{ fontSize: '0.72rem', color: lead.fit_source === 'other' ? COLORS.error : 'var(--text-muted)', marginTop: '4px' }}>
                        &ldquo;{lead.fit_evidence}&rdquo;
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
