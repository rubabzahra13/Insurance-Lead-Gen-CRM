import { useEffect, useRef } from 'react';
import { isPersistedLead, normalizeLeadId, sameLeadId } from '../../lib/lead-utils.js';
import { confidencePercent, confidenceToneClass } from '../../lib/confidence-tone.js';
import RowActionBar from './RowActionBar.jsx';

function ConfidencePill({ value }) {
  const pct = confidencePercent(value);

  return (
    <span
      className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums ${confidenceToneClass(pct)}`}
    >
      {pct}
    </span>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 3h6v6M9 11l8-8M7 7H4.5A1.5 1.5 0 003 8.5v8A1.5 1.5 0 004.5 18h8a1.5 1.5 0 001.5-1.5V15" />
    </svg>
  );
}

function MetaCell({ children }) {
  const text = children == null ? '' : String(children).trim();
  if (!text) {
    return <span className="lead-grid-cell-empty" aria-hidden="true" />;
  }

  return <span className="lead-grid-cell-meta block">{text}</span>;
}

const GRID_COLS = ['', 'Name', 'Title', 'Company', 'Location', 'Score', 'Link', ''];

export default function LeadDataTable({
  leads,
  selectedId,
  selectedIds,
  selectionScope = 'none',
  onSelect,
  onToggleSelect,
  onToggleSelectAll,
  onToggleStar,
  onEdit,
  onDelete,
  loading,
  emptyMessage = 'No leads yet. Run a search to find people.',
}) {
  const selectAllRef = useRef(null);
  const persistedLeads = leads.filter(isPersistedLead);
  const isChecked = (leadId) => {
    const id = normalizeLeadId(leadId);
    return id != null && selectedIds.has(id);
  };
  const allSelected =
    selectionScope === 'all' ||
    (persistedLeads.length > 0 && persistedLeads.every((l) => isChecked(l.id)));
  const someSelected =
    selectionScope !== 'all' &&
    selectedIds.size > 0 &&
    persistedLeads.some((l) => isChecked(l.id)) &&
    !allSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  return (
    <div className="desk-panel flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="desk-scroll flex-1 overflow-y-auto overflow-x-hidden">
        <div className="lead-grid" role="table" aria-label="Leads">
          <div className="lead-grid-header" role="row">
            <div className="lead-grid-cell-center" role="columnheader">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={(e) => onToggleSelectAll(e.target.checked)}
                className="desk-checkbox focus:ring-2"
                aria-label="Select all on page"
              />
            </div>
            {GRID_COLS.slice(1, -1).map((label) => (
              <div key={label} role="columnheader">
                {label}
              </div>
            ))}
            <div role="columnheader" aria-hidden />
          </div>

          {loading && leads.length === 0 ? (
            <div className="lead-grid-empty text-stone-400">
              Loading…
            </div>
          ) : leads.length === 0 ? (
            <div className="lead-grid-empty">
              <p className="desk-heading text-stone-600">{emptyMessage}</p>
              <p className="desk-subheading mt-1.5">Press ⌘K to run a search</p>
            </div>
          ) : (
            leads.map((lead) => {
              const selected = sameLeadId(selectedId, lead.id);
              const checked = selectionScope === 'all' || isChecked(lead.id);
              const persisted = isPersistedLead(lead);

              const rowClass = [
                'lead-grid-row group',
                selected ? 'is-selected' : '',
                checked && !selected ? 'is-checked' : '',
                lead._preview ? 'is-preview' : '',
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <div
                  key={lead.id}
                  role="row"
                  onClick={() => onSelect(lead)}
                  className={rowClass}
                >
                  <div
                    className="lead-grid-cell lead-grid-cell-center"
                    role="cell"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!persisted}
                      onChange={() => onToggleSelect(lead.id)}
                      className="desk-checkbox focus:ring-2 disabled:opacity-40"
                      aria-label={`Select ${lead.name}`}
                    />
                  </div>

                  <div className="lead-grid-cell" role="cell">
                    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                      <span className="lead-grid-cell-name">{lead.name}</span>
                      {lead._preview && (
                        <span className="shrink-0 rounded-md bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                          New
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="lead-grid-cell" role="cell">
                    <MetaCell>{lead.title}</MetaCell>
                  </div>

                  <div className="lead-grid-cell" role="cell">
                    <MetaCell>{lead.company}</MetaCell>
                  </div>

                  <div className="lead-grid-cell" role="cell">
                    <MetaCell>{lead.location}</MetaCell>
                  </div>

                  <div className="lead-grid-cell lead-grid-cell-center" role="cell">
                    <ConfidencePill value={lead.confidence} />
                  </div>

                  <div className="lead-grid-cell lead-grid-cell-center" role="cell">
                    {lead.link ? (
                      <a
                        href={lead.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="desk-link-btn"
                        aria-label={`Open ${lead.name} on LinkedIn`}
                        title="Open profile"
                      >
                        <LinkIcon />
                      </a>
                    ) : (
                      <span className="lead-grid-cell-empty" aria-hidden="true" />
                    )}
                  </div>

                  <div className="lead-grid-cell lead-grid-cell-actions" role="cell">
                    <RowActionBar
                      lead={lead}
                      persisted={persisted}
                      onToggleStar={onToggleStar}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      compact
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
