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

/** Role classifiers for individual leads (role text is free-form from LinkedIn). */
const LICENSED_ROLE_RE = /agent|broker|licensed|underwrit|adjuster|claims/i;
const DECISION_MAKER_RE = /ceo|chief|founder|owner|president|principal|partner|director|\bvp\b|vice president|head|manager/i;

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

  const businessStats = useMemo(() => {
    const newLeads = businessLeads.filter((l) => (l.pipeline_stage || 'new') === 'new').length;
    return { newLeads };
  }, [businessLeads]);

  // Role composition of the sourced individuals (who did we actually find?).
  const individualRoles = useMemo(() => {
    const roleOf = (l) => l.role || '';
    const licensed = individualLeads.filter((l) => LICENSED_ROLE_RE.test(roleOf(l))).length;
    const decisionMakers = individualLeads.filter((l) => DECISION_MAKER_RE.test(roleOf(l))).length;
    const companies = new Set(
      individualLeads.map((l) => (l.company || '').trim().toLowerCase()).filter(Boolean)
    ).size;
    return { licensed, decisionMakers, companies };
  }, [individualLeads]);

  // Quality signals on the sourced businesses.
  const businessMetrics = useMemo(() => {
    const rated = businessLeads
      .map((l) => parseFloat(l.rating))
      .filter((n) => !Number.isNaN(n));
    const avgRating = rated.length ? rated.reduce((sum, n) => sum + n, 0) / rated.length : null;
    const enriched = businessLeads.filter(
      (l) => l.website || l.contact_email || l.contact_linkedin || l.phone
    ).length;
    return { avgRating, enriched };
  }, [businessLeads]);

  if (loading) {
    return (
      <section className="home-dashboard">
        <div className="dash-launch-row">
          <div className="dash-launch-panel skeleton-shimmer" style={{ height: 140 }} />
          <div className="dash-launch-panel skeleton-shimmer" style={{ height: 140 }} />
        </div>
        <div className="dash-charts-grid">
          <div className="dash-chart-card skeleton-shimmer" style={{ height: 320 }} />
          <div className="dash-chart-card skeleton-shimmer" style={{ height: 320 }} />
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

      <div className="dash-workflow-row">
        <MetricCard
          href="/recruitment"
          icon={<Users size={18} />}
          iconBg="var(--accent-primary-subtle)"
          iconColor={COLORS.oldRose}
          title="Individual outreach"
          desc="LinkedIn profiles → AI drafts → email/SMS"
          kpis={[
            { label: 'Licensed agents', value: individualRoles.licensed, hint: 'agents & brokers' },
            { label: 'Decision-makers', value: individualRoles.decisionMakers, hint: 'owners, partners, directors' },
            { label: 'Companies', value: individualRoles.companies, hint: 'distinct employers' },
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
              label: 'Avg rating',
              value:
                businessMetrics.avgRating != null ? (
                  <span className="dash-kpi__rating">
                    {businessMetrics.avgRating.toFixed(1)}
                    <Star className="dash-kpi__star" fill="currentColor" strokeWidth={0} aria-hidden="true" />
                  </span>
                ) : (
                  '—'
                ),
              hint: 'Google score',
            },
            { label: 'Enriched', value: businessMetrics.enriched, hint: 'website or contact found' },
            { label: 'New leads', value: businessStats.newLeads, hint: 'on the board' },
          ]}
        />
      </div>

      <div className="dash-charts-grid">
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
            <div className="dash-chart-split">
              <ResponsiveContainer width="100%" height={220}>
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

              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={individualChart}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={52}
                    outerRadius={78}
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
            <ResponsiveContainer width="100%" height={260}>
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
          )}
        </article>
      </div>
    </section>
  );
}
