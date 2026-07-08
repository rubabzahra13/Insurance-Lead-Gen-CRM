import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const PANEL_WIDTH = 480;
const VIEWPORT_MARGIN = 16;

const FACET_TABS = [
  { id: 'title', label: 'Role', facetKey: 'titles', filterKey: 'title' },
  { id: 'company', label: 'Company', facetKey: 'companies', filterKey: 'company' },
  { id: 'location', label: 'Location', facetKey: 'locations', filterKey: 'location' },
  { id: 'tag', label: 'Tags', facetKey: 'tags', filterKey: 'tag' },
];

function FilterIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" d="M3 5h14M5 10h10M8 15h4" />
    </svg>
  );
}

function FacetOptionList({ items, activeValue, onSelect, placeholder }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items ?? [];
    return (items ?? []).filter((item) => item.value.toLowerCase().includes(q));
  }, [items, query]);

  if (!items?.length) {
    return <p className="desk-subheading px-1 py-6 text-center text-zinc-400">No options in current view</p>;
  }

  return (
    <div className="flex h-full flex-col">
      {items.length > 6 && (
        <div className="mb-2 shrink-0">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="desk-control desk-input w-full px-2.5"
          />
        </div>
      )}
      <div className="desk-scroll min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="desk-subheading py-4 text-center text-zinc-400">No matches</p>
        ) : (
          filtered.map((item) => {
            const active = activeValue === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => onSelect(active ? '' : item.value)}
                className={`desk-filter-option ${active ? 'desk-filter-option-active' : ''}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      active ? 'border-accent bg-accent text-white' : 'border-border bg-white'
                    }`}
                  >
                    {active && (
                      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" d="M2.5 6l2.5 2.5 4.5-4.5" />
                      </svg>
                    )}
                  </span>
                  <span className="truncate">{item.value}</span>
                </span>
                <span className="desk-menu-meta">{item.count}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function FilterPanel({
  open,
  onClose,
  facets,
  filters,
  onFilterChange,
  onClearFilters,
  onSaveView,
  hasActiveFilters,
  savedViews,
  onApplySavedView,
  onDeleteSavedView,
  anchorRef,
}) {
  const panelRef = useRef(null);
  const [activeTab, setActiveTab] = useState('title');
  const [panelStyle, setPanelStyle] = useState(null);

  const updatePanelPosition = useCallback(() => {
    const anchor = anchorRef?.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const width = Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);

    let left = rect.right - width;
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - width - VIEWPORT_MARGIN));

    const top = rect.bottom + 6;
    const maxHeight = Math.min(400, window.innerHeight - top - VIEWPORT_MARGIN);

    setPanelStyle({
      position: 'fixed',
      top,
      left,
      width,
      maxHeight: Math.max(maxHeight, 220),
      zIndex: 1000,
    });
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) {
      setPanelStyle(null);
      return;
    }

    updatePanelPosition();
    window.addEventListener('resize', updatePanelPosition);
    window.addEventListener('scroll', updatePanelPosition, true);

    return () => {
      window.removeEventListener('resize', updatePanelPosition);
      window.removeEventListener('scroll', updatePanelPosition, true);
    };
  }, [open, updatePanelPosition]);

  const facetTabs = useMemo(
    () => FACET_TABS.filter((tab) => tab.facetKey !== 'tags' || facets.tags?.length > 0),
    [facets.tags],
  );

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (panelRef.current?.contains(e.target) || anchorRef?.current?.contains(e.target)) return;
      onClose();
    }
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  useEffect(() => {
    if (open && activeTab === 'tag' && !facets.tags?.length) {
      setActiveTab('title');
    }
  }, [open, activeTab, facets.tags]);

  if (!open || !panelStyle) return null;

  const activeFacetCount = [
    filters.title,
    filters.company,
    filters.location,
    filters.tag,
  ].filter(Boolean).length;

  const currentFacet = FACET_TABS.find((t) => t.id === activeTab);

  const panel = (
    <div
      ref={panelRef}
      style={panelStyle}
      className="desk-filter-panel animate-slide-up flex flex-col overflow-hidden"
      role="dialog"
      aria-label="Filters"
    >
      <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2.5">
        <div className="min-w-0">
          <p className="desk-heading">Filters</p>
          <p className="desk-subheading truncate">
            {activeFacetCount > 0
              ? `${activeFacetCount} active · counts match your current view`
              : 'Filter by role, company, location, or tags'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasActiveFilters && (
            <button type="button" onClick={onClearFilters} className="desk-link">
              Clear all
            </button>
          )}
          <button type="button" onClick={onSaveView} className="desk-link !text-zinc-700">
            Save view
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden" style={{ minHeight: 220 }}>
        <nav className="desk-filter-nav shrink-0 border-r border-zinc-100 py-2">
          {facetTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const hasFilter = Boolean(filters[tab.filterKey]);
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`desk-nav-item flex w-full items-center justify-between rounded-none px-3 ${
                  isActive ? 'desk-nav-item-active' : ''
                }`}
              >
                <span>{tab.label}</span>
                {hasFilter && <span className="desk-menu-meta text-zinc-900">●</span>}
              </button>
            );
          })}
          {savedViews?.length > 0 && (
            <>
              <div className="my-1.5 mx-2 border-t border-zinc-100" />
              <button
                type="button"
                onClick={() => setActiveTab('saved')}
                className={`desk-nav-item flex w-full items-center justify-between rounded-none px-3 ${
                  activeTab === 'saved' ? 'desk-nav-item-active' : ''
                }`}
              >
                <span>Saved</span>
                <span className="desk-menu-meta">{savedViews.length}</span>
              </button>
            </>
          )}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col p-3">
          {activeTab === 'saved' ? (
            <>
              <p className="desk-section-heading mb-2 shrink-0">Saved views</p>
              <div className="desk-scroll min-h-0 flex-1 overflow-y-auto">
                {savedViews.map((sv) => (
                  <div key={sv.id} className="mb-0.5 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        onApplySavedView(sv);
                        onClose();
                      }}
                      className="desk-nav-item flex-1 !h-auto min-h-[var(--desk-control-h)] justify-start rounded-md py-1.5"
                    >
                      <span className="truncate">{sv.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSavedView(sv.id)}
                      className="desk-link shrink-0 px-2"
                      aria-label="Delete saved view"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : currentFacet ? (
            <>
              <p className="desk-section-heading mb-2 shrink-0">
                {currentFacet.label}
                {filters[currentFacet.filterKey] && (
                  <button
                    type="button"
                    onClick={() => onFilterChange(currentFacet.filterKey, '')}
                    className="ml-2 font-normal text-sky-600 hover:text-sky-800"
                  >
                    Clear
                  </button>
                )}
              </p>
              <FacetOptionList
                items={facets[currentFacet.facetKey]}
                activeValue={filters[currentFacet.filterKey]}
                onSelect={(value) => onFilterChange(currentFacet.filterKey, value)}
                placeholder={`Search ${currentFacet.label.toLowerCase()}…`}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

export { FilterIcon };
