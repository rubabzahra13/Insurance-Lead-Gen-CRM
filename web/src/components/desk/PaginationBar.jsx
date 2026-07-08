export default function PaginationBar({ page, totalPages, range, onPrev, onNext }) {
  if (totalPages <= 1) return null;

  return (
    <div className="desk-pagination">
      <span className="desk-pagination-range hidden sm:inline">
        {range.start.toLocaleString()}–{range.end.toLocaleString()}
      </span>
      <div className="desk-pagination-controls">
        <button
          type="button"
          disabled={page <= 1}
          onClick={onPrev}
          className="desk-pagination-btn"
        >
          Prev
        </button>
        <span className="desk-pagination-page">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={onNext}
          className="desk-pagination-btn"
        >
          Next
        </button>
      </div>
    </div>
  );
}
