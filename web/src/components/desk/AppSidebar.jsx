import { useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { formatDate } from '../../lib/format-date.js';
import {
  ROUTES,
  VIEW_ROUTES,
  isSearchNavActive,
  isWorkspaceNavActive,
} from '../../lib/desk-routes.js';
import { useDesk } from '../../context/DeskContext.jsx';

const NAV_ITEMS = [
  { to: ROUTES.dashboard, label: 'Dashboard', end: true, icon: '◆' },
  { to: ROUTES.leads, label: 'All leads', view: 'all' },
  { to: ROUTES.leadsNew, label: 'New this week', view: 'new' },
  { to: ROUTES.leadsStarred, label: 'Starred', view: 'starred' },
  { to: ROUTES.leadsReview, label: 'Needs review', view: 'review' },
];

function viewCount(view, stats) {
  if (view === 'all') return stats?.totalLeads ?? 0;
  if (view === 'new') return stats?.newThisWeek ?? 0;
  if (view === 'starred') return stats?.starredCount ?? 0;
  if (view === 'review') return stats?.pendingDuplicates ?? 0;
  return 0;
}

export default function AppSidebar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { view, dashboard, navStats, filters, handleRunSelect } = useDesk();
  const [runQuery, setRunQuery] = useState('');

  const stats = navStats;
  const runs = dashboard?.recentRuns ?? [];
  const runId = filters.runId ?? '';

  const filteredRuns = useMemo(() => {
    const q = runQuery.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter((run) => run.searchPrompt?.toLowerCase().includes(q));
  }, [runs, runQuery]);

  function onRunClick(searchRunId) {
    const active = isSearchNavActive(view, runId, searchRunId);
    const nextRunId = active ? '' : searchRunId;

    if (view !== 'all' || pathname !== ROUTES.leads) {
      navigate(VIEW_ROUTES.all);
    }
    handleRunSelect(nextRunId);
  }

  return (
    <aside className="desk-sidebar flex min-h-0 shrink-0 flex-col">
      <nav className="desk-sidebar-nav shrink-0">
        <p className="desk-nav-label mb-2.5 px-2">Workspace</p>
        <div className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const count = item.view ? viewCount(item.view, stats) : null;
            const active = isWorkspaceNavActive(item, pathname);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end ?? item.view === 'all'}
                isActive={() => active}
                className={() =>
                  `desk-nav-item flex w-full items-center justify-between text-left no-underline ${
                    active ? 'desk-nav-item-active' : 'text-fg-secondary hover:bg-surface-elevated'
                  }`
                }
              >
                <span className="flex items-center gap-2">
                  {item.icon && (
                    <span className="text-[10px] opacity-60" aria-hidden>
                      {item.icon}
                    </span>
                  )}
                  {item.label}
                </span>
                {count != null && count > 0 && (
                  <span
                    className={`desk-menu-meta ${
                      item.view === 'review'
                        ? 'rounded-md bg-sky-500/20 px-1.5 py-0.5 font-semibold text-sky-300'
                        : ''
                    }`}
                  >
                    {count.toLocaleString()}
                  </span>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>

      <section className="desk-sidebar-section flex min-h-0 flex-1 flex-col border-t border-border">
        <div className="mb-2 flex items-center justify-between px-2 pt-3.5">
          <p className="desk-nav-label">Searches</p>
          {runs.length > 0 && <span className="desk-menu-meta">{runs.length}</span>}
        </div>

        {runs.length > 5 && (
          <div className="mb-2 shrink-0 px-2">
            <input
              value={runQuery}
              onChange={(e) => setRunQuery(e.target.value)}
              placeholder="Filter searches…"
              className="desk-control desk-input w-full px-2.5"
            />
          </div>
        )}

        <div className="desk-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {!runs.length ? (
            <p className="desk-subheading px-2 py-6 text-center text-muted">
              Run a search to see history here
            </p>
          ) : filteredRuns.length === 0 ? (
            <p className="desk-subheading px-2 py-6 text-center text-muted">
              No matching searches
            </p>
          ) : (
            filteredRuns.map((run) => {
              const active = isSearchNavActive(view, runId, run.id);
              return (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => onRunClick(run.id)}
                  className={`desk-sidebar-run w-full text-left ${
                    active ? 'desk-sidebar-run-active' : 'text-fg-secondary hover:bg-surface-elevated'
                  }`}
                  title={run.searchPrompt}
                >
                  <span
                    className={`desk-sidebar-run-text block ${
                      active ? 'font-medium text-white' : 'font-medium text-fg'
                    }`}
                  >
                    {run.searchPrompt}
                  </span>
                  <span
                    className={`desk-subheading mt-1 block ${
                      active ? 'text-white/70' : 'text-muted'
                    }`}
                  >
                    +{run.leadsAdded ?? 0} leads · {formatDate(run.startedAt)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>
    </aside>
  );
}
