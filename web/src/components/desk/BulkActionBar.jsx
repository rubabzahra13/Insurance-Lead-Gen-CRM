function StarIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M10 2.5l1.76 3.57 3.94.57-2.85 2.78.67 3.92L10 11.9l-3.52 1.85.67-3.92-2.85-2.78 3.94-.57L10 2.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 6h11M8 6V4.5h4V6M7 6v8.5h6V6" />
    </svg>
  );
}

function ActionButton({ onClick, tone = 'default', children }) {
  const tones = {
    default: 'desk-bulk-btn-default',
    danger: 'desk-bulk-btn-danger',
  };

  return (
    <button type="button" onClick={onClick} className={`desk-bulk-btn ${tones[tone]}`}>
      {children}
    </button>
  );
}

export default function BulkActionBar({
  selectedCount,
  totalCount,
  pageCount,
  scope,
  onSelectAllMatching,
  onStar,
  onUnstar,
  onDelete,
  onClear,
}) {
  if (selectedCount === 0 && scope !== 'all') return null;

  const effectiveCount = scope === 'all' ? totalCount : selectedCount;
  const allOnPageSelected = scope === 'page' && selectedCount === pageCount;
  const canSelectAllMatching = allOnPageSelected && totalCount > pageCount;

  return (
    <div className="animate-slide-up space-y-2">
      {canSelectAllMatching && (
        <div className="desk-notice-accent px-3 py-2 text-[var(--desk-text-meta)]">
          All {pageCount} on this page selected.{' '}
          <button
            type="button"
            onClick={onSelectAllMatching}
            className="desk-notice-accent-link"
          >
            Select all {totalCount.toLocaleString()} matching
          </button>
        </div>
      )}

      <div className="desk-bulk-bar">
        <span className="text-[var(--desk-text)] font-semibold tabular-nums">
          {effectiveCount.toLocaleString()} selected
          {scope === 'all' && (
            <span className="ml-1.5 font-normal text-stone-400">(all matching)</span>
          )}
        </span>

        <div className="mx-1 hidden h-4 w-px bg-white/20 sm:block" />

        <div className="flex flex-wrap items-center gap-1">
          <ActionButton onClick={onStar}>
            <StarIcon />
            Star
          </ActionButton>
          <ActionButton onClick={onUnstar}>
            <StarIcon />
            Unstar
          </ActionButton>
          <ActionButton onClick={onDelete} tone="danger">
            <TrashIcon />
            Delete
          </ActionButton>
        </div>

        <button type="button" onClick={onClear} className="desk-link ml-auto !text-stone-400 hover:!text-white">
          Clear
        </button>
      </div>
    </div>
  );
}
