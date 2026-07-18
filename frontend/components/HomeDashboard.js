'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, ArrowRight, Building2, Star, Users } from 'lucide-react';
import { AVATAR_LABELS, LEAD_PATH, pipelineStageLabel } from '../lib/avatar-labels';
import { DASHBOARD_REFRESH_EVENT } from '../lib/dashboard-events';
import { BUSINESS_COLORS, COLORS, INDIVIDUAL_COLORS, RGBA } from '../lib/colors';
import { useIndividualSegment } from '../context/IndividualSegmentContext';
import { API_CACHE_KEYS, fetchCachedJson, getApiCache, invalidateApiCache } from '../lib/api-cache';
import { getApiBaseUrl } from '../lib/apiBaseUrl';

const INDIVIDUAL_CHART_COLORS = {
  [AVATAR_LABELS.avatar1]: INDIVIDUAL_COLORS.avatar1,
  [AVATAR_LABELS.avatar2]: INDIVIDUAL_COLORS.avatar2,
};

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="dash-tooltip">
      <p className="dash-tooltip-label">{label}</p>
      <p className="dash-tooltip-value">{payload[0].value} leads</p>
    </div>
  );
}

function MetricCard({ href, icon, iconBg, iconColor, title, desc, kpis }) {
  return (
    <article className="dash-metric-card">
      <Link href={href} className="dash-workflow-card__header dash-workflow-card__header--link">
        <div className="dash-workflow-card__icon" style={{ background: iconBg, color: iconColor }}>
          {icon}
        </div>
        <div className="dash-workflow-card__intro">
          <h3 className="dash-workflow-card__title">{title}</h3>
          <p className="dash-workflow-card__desc">{desc}</p>
        </div>
        <ArrowRight size={16} className="dash-workflow-card__arrow" />
      </Link>

      <div className="dash-kpi-row">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="dash-kpi">
            <span className="dash-kpi__value">{kpi.value}</span>
            <span className="dash-kpi__label">{kpi.label}</span>
            {kpi.hint ? <span className="dash-kpi__hint">{kpi.hint}</span> : null}
          </div>
        ))}
      </div>
    </article>
  );
}

export default function HomeDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [individualLeads, setIndividualLeads] = useState([]);
  const [businessLeads, setBusinessLeads] = useState([]);
  const { setSegmentCounts } = useIndividualSegment();

  useEffect(() => {
    const applySegmentCounts = (items) => {
      setSegmentCounts({
        avatar1: items.filter((lead) => lead.avatar_type === 'avatar1').length,
        avatar2: items.filter((lead) => lead.avatar_type === 'avatar2').length,
      });
    };

    const load = async ({ force = false } = {}) => {
      if (!force) {
        const cachedIndividuals = getApiCache(API_CACHE_KEYS.avatar12Leads);
        const cachedBusiness = getApiCache(API_CACHE_KEYS.avatar3Leads);
        if (cachedIndividuals && cachedBusiness) {
          setIndividualLeads(cachedIndividuals.items || []);
          setBusinessLeads(cachedBusiness.items || []);
          applySegmentCounts(cachedIndividuals.items || []);
          setLoading(false);
          // Quiet background refresh
          void load({ force: true });
          return;
        }
        setLoading(true);
      }
      setError(false);
      try {
        const apiBaseUrl = getApiBaseUrl();
        const [individualsResult, businessResult] = await Promise.all([
          fetchCachedJson(`${apiBaseUrl}/api/avatar12/leads`, {
            cacheKey: API_CACHE_KEYS.avatar12Leads,
            force: true,
          }),
          fetchCachedJson(`${apiBaseUrl}/api/avatar3/leads`, {
            cacheKey: API_CACHE_KEYS.avatar3Leads,
            force: true,
          }),
        ]);
        setIndividualLeads(individualsResult.data.items || []);
        setBusinessLeads(businessResult.data.items || []);
        applySegmentCounts(individualsResult.data.items || []);
      } catch (err) {
        console.error(err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };
    load();

    const onRefresh = () => {
      invalidateApiCache([API_CACHE_KEYS.avatar12Leads, API_CACHE_KEYS.avatar3Leads]);
      load({ force: true });
    };
    window.addEventListener(DASHBOARD_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(DASHBOARD_REFRESH_EVENT, onRefresh);
  }, [setSegmentCounts]);

  const individualChart = useMemo(() => {
    const jobSeekers = individualLeads.filter((l) => l.avatar_type === 'avatar1').length;
    const jobUpgraders = individualLeads.filter((l) => l.avatar_type === 'avatar2').length;
    return [
      { name: AVATAR_LABELS.avatar1, value: jobSeekers, key: 'avatar1' },
      { name: AVATAR_LABELS.avatar2, value: jobUpgraders, key: 'avatar2' },
    ];
  }, [individualLeads]);

  const businessChart = useMemo(() => {
    const counts = {};
    for (const lead of businessLeads) {
      const stage = lead.pipeline_stage || 'new';
      counts[stage] = (counts[stage] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([stage, value]) => ({
        name: pipelineStageLabel(stage),
        value,
        stage,
      }))
      .sort((a, b) => b.value - a.value);
  }, [businessLeads]);

  const totalIndividuals = individualChart.reduce((sum, row) => sum + row.value, 0);
  const totalBusinesses = businessChart.reduce((sum, row) => sum + row.value, 0);

  // Align with Individual Leads: Sent filter, unsent drafts, contacts on file.
  const individualOutreach = useMemo(() => {
    const hasContact = (l) => Boolean(
      String(l.contact_email || '').trim() || String(l.contact_phone || '').trim(),
    );
    const status = (l) => l.latest_draft?.status || null;

    const sent = individualLeads.filter((l) => status(l) === 'sent').length;
    // Unsent leads that already have a draft message (same pool you open in Outreach).
    const drafts = individualLeads.filter((l) => status(l) === 'draft').length;
    const reachable = individualLeads.filter(hasContact).length;

    return { sent, drafts, reachable };
  }, [individualLeads]);

  // Coverage insights from businesses currently on the board (live from API data).
  const businessInsights = useMemo(() => {
    const parseRating = (value) => {
      const n = parseFloat(value);
      return Number.isFinite(n) ? n : null;
    };
    const cityOf = (lead) => {
      const address = String(lead.address || '').trim();
      if (!address) return '';
      const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return parts[parts.length - 2].replace(/\s+\d{5}(?:-\d{4})?$/i, '').trim();
      }
      return parts[0] || '';
    };

    const highRated = businessLeads.filter((l) => {
      const rating = parseRating(l.rating);
      return rating != null && rating >= 4;
    }).length;
    const reachable = businessLeads.filter((l) => l.phone || l.contact_email).length;
    const markets = new Set(
      businessLeads.map(cityOf).map((c) => c.toLowerCase()).filter(Boolean),
    ).size;

    return { highRated, reachable, markets };
  }, [businessLeads]);

  if (loading) {
    return (
      <section className="home-dashboard">
        <div className="dash-paths-grid">
          <div className="dash-metric-card skeleton-shimmer" style={{ minHeight: 168 }} />
          <div className="dash-metric-card skeleton-shimmer" style={{ minHeight: 168 }} />
          <div className="dash-chart-card skeleton-shimmer" style={{ minHeight: 280 }} />
          <div className="dash-chart-card skeleton-shimmer" style={{ minHeight: 280 }} />
        </div>
      </section>
    );
  }

  return (
    <section className="home-dashboard">
      {error && (
        <div className="dash-error-banner">
          <AlertTriangle size={16} />
          <span>Could not load dashboard data. Make sure the API is running on port 8000, then refresh.</span>
          <button type="button" className="chip-fallback-btn" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      )}

      <div className="dash-paths-grid">
        <MetricCard
          href="/recruitment"
          icon={<Users size={18} />}
          iconBg="var(--accent-primary-subtle)"
          iconColor={COLORS.oldRose}
          title="Individual outreach"
          desc="LinkedIn profiles → AI drafts → send message"
          kpis={[
            { label: 'Sent', value: individualOutreach.sent, hint: 'marked as sent' },
            { label: 'Drafts', value: individualOutreach.drafts, hint: 'ready to copy' },
            { label: 'Reachable', value: individualOutreach.reachable, hint: 'email or phone on file' },
          ]}
        />

        <MetricCard
          href="/business"
          icon={<Building2 size={18} />}
          iconBg="var(--bg-secondary)"
          iconColor={COLORS.text}
          title="Business pipeline"
          desc="Find local businesses → kanban stages → follow-ups"
          kpis={[
            {
              label: 'High rated',
              value: businessInsights.highRated,
              hint: (
                <span className="dash-kpi__hint-rating">
                  4
                  <Star className="dash-kpi__star" fill="currentColor" strokeWidth={0} aria-hidden="true" />
                  + on Google
                </span>
              ),
            },
            { label: 'Reachable', value: businessInsights.reachable, hint: 'phone or email on file' },
            { label: 'Markets', value: businessInsights.markets, hint: 'cities on the board' },
          ]}
        />

        <article className="dash-chart-card">
          <header className="dash-chart-header">
            <div>
              <h2 className="dash-chart-title">Individual leads</h2>
              <p className="dash-chart-subtitle">{AVATAR_LABELS.avatar1} vs {AVATAR_LABELS.avatar2}</p>
            </div>
            <span className="dash-chart-total">{totalIndividuals} total</span>
          </header>

          {totalIndividuals === 0 ? (
            <p className="dash-empty">No individual leads yet. Run a search for job seekers or job upgraders to populate this chart.</p>
          ) : (
            <div className="dash-chart-body dash-chart-split">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={individualChart} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.lightBlue} vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: COLORS.text, fontSize: 12, opacity: 0.55 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: COLORS.text, fontSize: 12, opacity: 0.55 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: RGBA.accent06 }} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]} maxBarSize={72}>
                    {individualChart.map((entry) => (
                      <Cell key={entry.key} fill={INDIVIDUAL_CHART_COLORS[entry.name]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={individualChart}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="42%"
                    outerRadius="68%"
                    paddingAngle={3}
                  >
                    {individualChart.map((entry) => (
                      <Cell key={entry.key} fill={INDIVIDUAL_CHART_COLORS[entry.name]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </article>

        <article className="dash-chart-card">
          <header className="dash-chart-header">
            <div>
              <h2 className="dash-chart-title">Business leads</h2>
              <p className="dash-chart-subtitle">{LEAD_PATH.business.label}</p>
            </div>
            <span className="dash-chart-total">{totalBusinesses} total</span>
          </header>

          {totalBusinesses === 0 ? (
            <p className="dash-empty">No business leads yet. Search for founder-led or small businesses to populate this chart.</p>
          ) : (
            <div className="dash-chart-body">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={businessChart}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.lightBlue} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fill: COLORS.text, fontSize: 12, opacity: 0.55 }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={96}
                    tick={{ fill: COLORS.text, fontSize: 12, opacity: 0.55 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: RGBA.blush05 }} />
                  <Bar dataKey="value" radius={[0, 8, 8, 0]} maxBarSize={28}>
                    {businessChart.map((entry, index) => (
                      <Cell key={entry.stage} fill={BUSINESS_COLORS[index % BUSINESS_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
