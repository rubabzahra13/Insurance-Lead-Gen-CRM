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
import { AlertTriangle, ArrowRight, Building2, Search, Users } from 'lucide-react';
import { AVATAR_LABELS, LEAD_PATH, pipelineStageLabel, WORKSPACE_LABELS } from '../lib/avatar-labels';
import { DASHBOARD_REFRESH_EVENT } from '../lib/dashboard-events';
import { BUSINESS_COLORS, COLORS, INDIVIDUAL_COLORS, RGBA } from '../lib/colors';

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

export default function HomeDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [individualLeads, setIndividualLeads] = useState([]);
  const [businessLeads, setBusinessLeads] = useState([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(false);
      try {
        const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
        const [individualsRes, businessRes] = await Promise.all([
          fetch(`${apiBaseUrl}/api/avatar12/leads`),
          fetch(`${apiBaseUrl}/api/avatar3/leads`),
        ]);
        if (!individualsRes.ok || !businessRes.ok) throw new Error('Dashboard fetch failed');
        const individualsData = await individualsRes.json();
        const businessData = await businessRes.json();
        setIndividualLeads(individualsData.items || []);
        setBusinessLeads(businessData.items || []);
      } catch (err) {
        console.error(err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };
    load();

    const onRefresh = () => load();
    window.addEventListener(DASHBOARD_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(DASHBOARD_REFRESH_EVENT, onRefresh);
  }, []);

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

  if (loading) {
    return (
      <section className="home-dashboard">
        <div className="dash-summary-row">
          <div className="dash-summary-card skeleton-shimmer" style={{ height: 88 }} />
          <div className="dash-summary-card skeleton-shimmer" style={{ height: 88 }} />
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
      <header className="dash-page-header">
        <div>
          <h2 className="dash-page-title">Overview</h2>
          <p className="dash-page-subtitle">
            Track both pipelines at a glance. Source new leads from each workspace.
          </p>
        </div>
      </header>

      {error && (
        <div className="dash-error-banner">
          <AlertTriangle size={16} />
          <span>Could not load dashboard data. Search and sourcing still work.</span>
        </div>
      )}

      <div className="dash-summary-row">
        <Link href="/recruitment" className="dash-summary-card dash-summary-card-link">
          <div className="dash-summary-icon" style={{ background: 'var(--accent-primary-subtle)', color: COLORS.oldRose }}>
            <Users size={20} />
          </div>
          <div>
            <p className="dash-summary-label">{WORKSPACE_LABELS.individuals.title}</p>
            <p className="dash-summary-value">{totalIndividuals}</p>
            <p className="dash-summary-meta">{LEAD_PATH.people.label}</p>
          </div>
          <ArrowRight size={16} className="dash-summary-arrow" />
        </Link>

        <Link href="/business" className="dash-summary-card dash-summary-card-link">
          <div className="dash-summary-icon" style={{ background: 'var(--bg-secondary)', color: COLORS.text }}>
            <Building2 size={20} />
          </div>
          <div>
            <p className="dash-summary-label">{WORKSPACE_LABELS.businesses.title}</p>
            <p className="dash-summary-value">{totalBusinesses}</p>
            <p className="dash-summary-meta">{LEAD_PATH.business.label}</p>
          </div>
          <ArrowRight size={16} className="dash-summary-arrow" />
        </Link>
      </div>

      <div className="workspace-hub">
        <Link href="/recruitment" className="workspace-hub-card workspace-hub-card--individual">
          <div className="workspace-hub-icon" style={{ background: 'var(--accent-primary-subtle)', color: COLORS.oldRose }}>
            <Search size={22} />
          </div>
          <div className="workspace-hub-body">
            <p className="workspace-hub-eyebrow">{WORKSPACE_LABELS.individuals.nav}</p>
            <h3 className="workspace-hub-title">Source {WORKSPACE_LABELS.individuals.title.toLowerCase()}</h3>
            <p className="workspace-hub-desc">{LEAD_PATH.people.description}</p>
          </div>
          <span className="workspace-hub-cta">
            Open workspace
            <ArrowRight size={16} />
          </span>
        </Link>

        <Link href="/business" className="workspace-hub-card workspace-hub-card--business">
          <div className="workspace-hub-icon" style={{ background: 'var(--bg-secondary)', color: COLORS.text }}>
            <Search size={22} />
          </div>
          <div className="workspace-hub-body">
            <p className="workspace-hub-eyebrow">{WORKSPACE_LABELS.businesses.nav}</p>
            <h3 className="workspace-hub-title">Source {WORKSPACE_LABELS.businesses.title.toLowerCase()}</h3>
            <p className="workspace-hub-desc">{LEAD_PATH.business.description}</p>
          </div>
          <span className="workspace-hub-cta">
            Open workspace
            <ArrowRight size={16} />
          </span>
        </Link>
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
