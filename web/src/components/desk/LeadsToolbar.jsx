import { useMemo, useRef, useState } from 'react';
import FilterPanel, { FilterIcon } from './FilterPanel.jsx';
import LeadsSortControl from './LeadsSortControl.jsx';

const FILTER_LABELS = {
  title: 'Role',
  company: 'Company',
  location: 'Location',
  tag: 'Tag',
  runId: 'Search',
};

export default function LeadsToolbar({
  searchInput,
  onSearchInputChange,
  exportUrl,
  facets,
  filters,
  onFilterChange,
  onClearFilters,
  onSaveView,
  hasActiveFilters,
  savedViews,
  activeRunId,
  activeRunLabel,
  onApplySavedView,
  onDeleteSavedView,
  sortValue,
  onSortChange,
  sortVariant = 'leads',
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterBtnRef = useRef(null);

  const activeFilterChips = useMemo(() => {
    const chips = [];
    if (filters.title) chips.push({ key: 'title', label: `${FILTER_LABELS.title}: ${filters.title}` });
    if (filters.company) chips.push({ key: 'company', label: `${FILTER_LABELS.company}: ${filters.company}` });
    if (filters.location) chips.push({ key: 'location', label: `${FILTER_LABELS.location}: ${filters.location}` });
    if (filters.tag) chips.push({ key: 'tag', label: `${FILTER_LABELS.tag}: ${filters.tag}` });
    if (activeRunId) {
      chips.push({
        key: 'runId',
        label: activeRunLabel ? `${FILTER_LABELS.runId}: ${activeRunLabel}` : FILTER_LABELS.runId,
      });
    }
    return chips;
  }, [filters, activeRunId, activeRunLabel]);

  const filterCount = activeFilterChips.length;

  return (
    <div className="leads-toolbar">
      <div className="leads-toolbar-row">
        <div className="desk-search-wrap leads-toolbar-search">
          <svg
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.target.value)}
            placeholder="Search leads by name, title, company…"
            className="desk-search-input"
          />
        </div>

        <LeadsSortControl value={sortValue} onChange={onSortChange} variant={sortVariant} />

        <div className="relative shrink-0">
          <button
            ref={filterBtnRef}
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className={`desk-btn gap-1.5 ${
              filtersOpen || filterCount > 0 ? 'desk-btn-primary' : 'desk-btn-secondary'
            }`}
            aria-expanded={filtersOpen}
            aria-haspopup="dialog"
          >
            <FilterIcon />
            <span>Filters</span>
            {filterCount > 0 && (
              <span
                className={`rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums ${
                  filtersOpen || filterCount > 0 ? 'bg-white/25 text-white' : 'desk-accent-badge'
                }`}
              >
                {filterCount}
              </span>
            )}
          </button>

          <FilterPanel
            open={filtersOpen}
            onClose={() => setFiltersOpen(false)}
            facets={facets}
            filters={filters}
            onFilterChange={onFilterChange}
            onClearFilters={onClearFilters}
            onSaveView={onSaveView}
            hasActiveFilters={hasActiveFilters}
            savedViews={savedViews}
            onApplySavedView={onApplySavedView}
            onDeleteSavedView={onDeleteSavedView}
            anchorRef={filterBtnRef}
          />
        </div>

        <a href={exportUrl} className="desk-btn desk-btn-secondary shrink-0">
          Export
        </a>
      </div>

      {activeFilterChips.length > 0 && (
        <div className="leads-toolbar-chips">
          <div className="desk-scroll flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {activeFilterChips.map((chip) => (
              <span
                key={chip.key}
                className={`desk-chip shrink-0 ${chip.key === 'runId' ? 'desk-chip-info max-w-[240px]' : 'desk-chip-neutral max-w-[200px]'}`}
              >
                <span className="truncate">{chip.label}</span>
                <button
                  type="button"
                  onClick={() => onFilterChange(chip.key, '')}
                  className="opacity-50 hover:opacity-100"
                  aria-label={`Remove ${chip.label}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <button type="button" onClick={onClearFilters} className="desk-link shrink-0">
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
