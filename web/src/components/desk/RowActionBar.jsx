function StarIcon({ filled, className = 'h-3.5 w-3.5' }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75">
      <path d="M10 2.5l1.76 3.57 3.94.57-2.85 2.78.67 3.92L10 11.9l-3.52 1.85.67-3.92-2.85-2.78 3.94-.57L10 2.5z" />
    </svg>
  );
}

function EditIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 14.5V16h1.5L14 7.5 12.5 6 4 14.5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.5 4.5l2 2" />
    </svg>
  );
}

function TrashIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 6h11M8 6V4.5h4V6M7 6v8.5h6V6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 9v4M10 9v4M12.5 9v4" />
    </svg>
  );
}

export default function RowActionBar({
  lead,
  persisted,
  onToggleStar,
  onEdit,
  onDelete,
}) {
  return (
    <div className="row-action-bar" onClick={(e) => e.stopPropagation()} role="group" aria-label="Row actions">
      <button
        type="button"
        aria-label={lead.starred ? 'Unstar' : 'Star'}
        title={lead.starred ? 'Unstar' : 'Star'}
        disabled={!persisted}
        onClick={() => onToggleStar(lead)}
        className={`row-action-btn row-action-btn-star ${lead.starred ? 'is-active' : ''}`}
      >
        <StarIcon filled={lead.starred} />
      </button>
      <button
        type="button"
        aria-label="Edit lead"
        title="Edit"
        disabled={!persisted}
        onClick={() => onEdit(lead)}
        className="row-action-btn row-action-btn-edit"
      >
        <EditIcon />
      </button>
      <button
        type="button"
        aria-label="Delete lead"
        title="Delete"
        disabled={!persisted}
        onClick={() => onDelete(lead)}
        className="row-action-btn row-action-btn-delete"
      >
        <TrashIcon />
      </button>
    </div>
  );
}
