import { useMemo, useState } from 'react';
import { formatDate } from '../../lib/format-date.js';

const VIEWS = [
  { id: 'all', label: 'All leads' },
  { id: 'new', label: 'New this week' },
  { id: 'starred', label: 'Starred' },
  { id: 'review', label: 'Needs review' },
];

export default function FilterSidebar({
  view,
  onViewChange,
  pendingCount,
  totalLeads,
  newThisWeek,
  starredCount,
  runs,
  activeRunId,
  onRunSelect,
}) {
  const [runQuery, setRunQuery] = useState('');

  const filteredRuns = useMemo(() => {
    const q = runQuery.trim().toLowerCase();
    if (!q) return runs ?? [];
    return (runs ?? []).filter((run) => run.searchPrompt?.toLowerCase().includes(q));
  }, [runs, runQuery]);

  function viewCount(id) {
    if (id === 'all') return totalLeads;
    if (id === 'new') return newThisWeek;
    if (id === 'starred') return starredCount;
    if (id === 'review') return pendingCount;
    return 0;
  }

  return (
    <aside className="desk-sidebar flex min-h-0 shrink-0 flex-col">
      <nav className="desk-sidebar-nav shrink-0">
        <p className="desk-nav-label mb-2.5 px-2">Views</p>
        <div className="space-y-0.5">
          {VIEWS.map((v) => {
            const active = view === v.id;
            const count = viewCount(v.id);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => onViewChange(v.id)}
                className={`desk-nav-item flex w-full items-center justify-between text-left ${
                  active ? 'desk-nav-item-active' : 'text-stone-600 hover:bg-stone-50'
                }`}
              >
                <span>{v.label}</span>
                {count > 0 && (
                  <span
                    className={`desk-menu-meta ${
                      v.id === 'review'
                        ? 'rounded-md bg-sky-100 px-1.5 py-0.5 font-semibold text-sky-700'
                        : ''
                    }`}
                  >
                    {count.toLocaleString()}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <section className="desk-sidebar-section flex min-h-0 flex-1 flex-col border-t border-stone-100">
        <div className="mb-2 flex items-center justify-between px-2 pt-3.5">
          <p className="desk-nav-label">Searches</p>
          {runs?.length > 0 && (
            <span className="desk-menu-meta">{runs.length}</span>
          )}
        </div>

        {runs?.length > 5 && (
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
          {!runs?.length ? (
            <p className="desk-subheading px-2 py-6 text-center text-stone-400">
              Run a search to see history here
            </p>
          ) : filteredRuns.length === 0 ? (
            <p className="desk-subheading px-2 py-6 text-center text-stone-400">
              No matching searches
            </p>
          ) : (
            filteredRuns.map((run) => {
              const active = activeRunId === run.id;
              return (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => onRunSelect(active ? '' : run.id)}
                  className={`desk-sidebar-run w-full text-left ${
                    active ? 'desk-sidebar-run-active' : 'text-stone-600 hover:bg-stone-50'
                  }`}
                  title={run.searchPrompt}
                >
                  <span
                    className={`desk-sidebar-run-text block ${
                      active ? 'font-medium text-white' : 'font-medium text-stone-800'
                    }`}
                  >
                    {run.searchPrompt}
                  </span>
                  <span
                    className={`desk-subheading mt-1 block ${
                      active ? 'text-stone-400' : 'text-stone-500'
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
