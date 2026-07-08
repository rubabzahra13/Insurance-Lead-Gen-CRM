import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { fetchAnalytics } from '../lib/api.js';
import { readAnalyticsCache, writeAnalyticsCache } from '../lib/analytics-cache.js';
import { ROUTES } from '../lib/desk-routes.js';
import { useDesk } from '../context/DeskContext.jsx';
import { formatDate } from '../lib/format-date.js';
import { withPaletteColors } from '../lib/chart-theme.js';
import { buildFallbackAnalytics } from '../lib/build-fallback-analytics.js';
import ChartCard from '../components/analytics/ChartCard.jsx';
import CompanyLeaderboard from '../components/analytics/CompanyLeaderboard.jsx';
import DashboardKpiStrip from '../components/analytics/DashboardKpiStrip.jsx';
import LocationDistribution from '../components/analytics/LocationDistribution.jsx';
import {
  AreaTrendChart,
  DonutChart,
  DonutLegend,
  MonthBarChart,
} from '../components/analytics/ChartViews.jsx';

const TIME_RANGES = [
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
  { id: 'all', label: 'All' },
];

function EmptyChart({ message }) {
  return (
    <div className="analytics-empty">
      <p>{message}</p>
    </div>
  );
}

function formatAxisDate(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function withColors(rows) {
  return withPaletteColors(rows);
}

function toBarRows(rows, labelKey = 'value') {
  return rows.map((row) => ({
    ...row,
    label: row.label ?? (row[labelKey]?.length > 36 ? `${row[labelKey].slice(0, 35)}…` : row[labelKey]),
  }));
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { setSearchOpen, handleFilterChange, dashboard, facets } = useDesk();
  const [since, setSince] = useState('all');
  const [data, setData] = useState(() => readAnalyticsCache('all'));
  const [loading, setLoading] = useState(() => !readAnalyticsCache('all'));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [usingFallback, setUsingFallback] = useState(false);

  const applyPartial = useCallback(
    (partial, { fallback = false } = {}) => {
      if ((partial.summary?.totalLeads ?? 0) > 0) {
        setData(partial);
        setUsingFallback(fallback);
        setLoading(false);
        return true;
      }
      return false;
    },
    [],
  );

  const load = useCallback(async () => {
    const cached = readAnalyticsCache(since);
    if (cached) {
      setData(cached);
      setUsingFallback(false);
      setLoading(false);
    } else {
      applyPartial(
        buildFallbackAnalytics({
          stats: dashboard?.stats,
          recentRuns: dashboard?.recentRuns,
          facets,
          since,
        }),
        { fallback: true },
      );
    }

    setRefreshing(true);
    setError(null);

    try {
      const fresh = await fetchAnalytics(since);
      writeAnalyticsCache(since, fresh);
      setData(fresh);
      setUsingFallback(false);
      setError(null);
    } catch (err) {
      const fallback = buildFallbackAnalytics({
        stats: dashboard?.stats,
        recentRuns: dashboard?.recentRuns,
        facets,
        since,
      });
      if (!applyPartial(fallback, { fallback: true })) {
        setError(err.message ?? 'Failed to load stats');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [since, dashboard?.stats, dashboard?.recentRuns, facets, applyPartial]);

  useEffect(() => {
    if (pathname !== '/') return;
    load();
  }, [load, pathname, dashboard?.stats?.totalLeads]);

  const summary = data?.summary ?? {};
  const groupCounts = data?.groupCounts ?? {};
  const hasLeads = (summary.totalLeads ?? 0) > 0;

  const goToLeads = useCallback(
    (patch) => {
      for (const [key, val] of Object.entries(patch)) {
        if (val) handleFilterChange(key, val);
      }
      navigate(ROUTES.leads);
    },
    [handleFilterChange, navigate],
  );

  const companyPie = useMemo(
    () => withColors((data?.byCompany ?? []).map((row) => ({ ...row, label: row.value }))),
    [data?.byCompany],
  );
  const locationBars = useMemo(
    () => withColors(toBarRows(data?.byLocation ?? [])),
    [data?.byLocation],
  );
  const rolePie = useMemo(
    () => withColors(data?.byRoleGroup ?? []),
    [data?.byRoleGroup],
  );

  const handleRoleClick = useCallback(
    (row) => {
      if (!row?.filterToken) return;
      goToLeads({ title: row.filterToken });
    },
    [goToLeads],
  );

  const tagDonut = useMemo(
    () =>
      withColors(
        (data?.byTag ?? []).slice(0, 8).map((row) => ({
          ...row,
          label: row.value,
        })),
      ),
    [data?.byTag],
  );

  const useMonthly = (data?.byMonth?.length ?? 0) > 1;
  const hasTimeline = (useMonthly ? data?.byMonth : data?.overTime)?.length > 0;

  return (
    <div className="dash-stats-page desk-scroll overflow-y-auto">
      <header className="dash-stats-header">
        <div className="dash-stats-header-copy">
          <h1 className="dash-stats-title">Dashboard</h1>
          <p className="dash-stats-lede">
            How your {Number(summary.totalLeads ?? 0).toLocaleString()} leads break down by time, role, company, and region.
          </p>
        </div>
        <div className="dash-stats-toolbar">
          <div className="analytics-range" role="group" aria-label="Time range">
            {TIME_RANGES.map((range) => (
              <button
                key={range.id}
                type="button"
                className={`analytics-range-btn${since === range.id ? ' is-active' : ''}`}
                onClick={() => setSince(range.id)}
              >
                {range.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setSearchOpen(true)} className="desk-btn desk-btn-primary">
            New search
            <kbd className="desk-kbd">⌘K</kbd>
          </button>
        </div>
      </header>

      {error && (
        <div className="analytics-error">
          <p>{error}</p>
          <button type="button" className="desk-btn desk-btn-ghost" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {usingFallback && !error && (
        <div className="analytics-fallback">
          {refreshing
            ? 'Loading latest charts…'
            : 'Showing saved summary — full charts will refresh when the server responds.'}
        </div>
      )}

      {!loading && !hasLeads ? (
        <section className="analytics-zero">
          <div className="analytics-zero-inner">
            <h2>No leads yet</h2>
            <p>Run a search to start capturing leads. Your dashboard will populate automatically.</p>
            <button type="button" onClick={() => setSearchOpen(true)} className="desk-btn desk-btn-primary">
              Start a search
            </button>
          </div>
        </section>
      ) : (
        <div className={`dash-stats-body${loading ? ' is-loading' : ''}${refreshing ? ' is-refreshing' : ''}`}>
          <DashboardKpiStrip summary={summary} groupCounts={groupCounts} />

          <div className="dash-bento">
            <div className="dash-bento-hero">
              <ChartCard
                title="Capture timeline"
                subtitle={useMonthly ? 'Leads per month' : 'Leads per day'}
                className="dash-panel dash-panel-wide"
              >
                {hasTimeline ? (
                  useMonthly ? (
                    <MonthBarChart data={data.byMonth} />
                  ) : (
                    <AreaTrendChart data={data.overTime} formatLabel={formatAxisDate} />
                  )
                ) : (
                  <EmptyChart message="Timeline fills in as leads are saved." />
                )}
              </ChartCard>

              <ChartCard
                title="By role"
                subtitle={`${groupCounts.title ?? 0} titles grouped`}
                className="dash-panel dash-panel-role"
              >
                {rolePie.length === 0 ? (
                  <EmptyChart message="Role groups appear when leads have title data." />
                ) : (
                  <div className="dash-role-split">
                    <DonutChart
                      data={rolePie}
                      cutout="62%"
                      onClick={handleRoleClick}
                    />
                    <DonutLegend data={rolePie} onClick={handleRoleClick} />
                  </div>
                )}
              </ChartCard>
            </div>

            <div className="dash-bento-split">
              <ChartCard
                title="Top companies"
                subtitle={`${groupCounts.company ?? 0} employers`}
                className="dash-panel"
              >
                {companyPie.length === 0 ? (
                  <EmptyChart message="Company groups appear when leads have employer data." />
                ) : (
                  <CompanyLeaderboard
                    data={companyPie}
                    totalCompanies={groupCounts.company ?? companyPie.length}
                    onClick={(row) => row?.value && row.value !== 'Other' && goToLeads({ company: row.value })}
                    limit={6}
                    insight={null}
                  />
                )}
              </ChartCard>

              <ChartCard
                title="By region"
                subtitle={`${groupCounts.location ?? 0} locations mapped`}
                className="dash-panel"
              >
                {locationBars.length === 0 ? (
                  <EmptyChart message="Location groups appear when leads have place data." />
                ) : (
                  <LocationDistribution
                    data={locationBars}
                    totalLocations={groupCounts.location ?? locationBars.length}
                    maxRegions={5}
                    compact
                    onClick={(region) => goToLeads({ location: region.region })}
                  />
                )}
              </ChartCard>
            </div>

            {tagDonut.length > 0 && (
              <ChartCard
                title="By tag"
                subtitle={`${groupCounts.tag ?? 0} custom labels`}
                className="dash-panel dash-panel-tags"
              >
                <div className="dash-role-split">
                  <DonutChart
                    data={tagDonut}
                    cutout="62%"
                    onClick={(row) => row?.value && goToLeads({ tag: row.value })}
                  />
                  <DonutLegend data={tagDonut} onClick={(row) => row?.value && goToLeads({ tag: row.value })} />
                </div>
              </ChartCard>
            )}

            {(data?.recentLeads?.length ?? 0) > 0 && (
              <ChartCard
                title="Latest captured"
                subtitle="Most recently saved leads"
                className="dash-panel dash-panel-table"
                action={
                  <Link to={ROUTES.leads} className="dash-view-all">
                    View all
                  </Link>
                }
              >
                <div className="dash-recent-table-wrap">
                  <table className="dash-recent-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Company</th>
                        <th>Role</th>
                        <th>Location</th>
                        <th>Search</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentLeads.map((lead) => (
                        <tr
                          key={lead.id}
                          className="dash-recent-row"
                          onClick={() => navigate(ROUTES.leads)}
                        >
                          <td>
                            <span className="dash-recent-name">
                              {lead.starred && <span className="dash-recent-star">★</span>}
                              {lead.name}
                            </span>
                          </td>
                          <td>{lead.company || '—'}</td>
                          <td>{lead.title || '—'}</td>
                          <td>{lead.location || '—'}</td>
                          <td>
                            <span className="dash-recent-source" title={lead.searchPrompt ?? ''}>
                              {lead.searchLabel || '—'}
                            </span>
                          </td>
                          <td className="dash-recent-date">{formatDate(lead.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ChartCard>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
