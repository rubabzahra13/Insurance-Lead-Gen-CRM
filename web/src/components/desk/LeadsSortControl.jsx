import { DUPLICATE_SORT_OPTIONS, SORT_OPTIONS } from '../../lib/lead-sort.js';

function SortIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" d="M6 4v12M6 16l-2.5-2.5M6 16l2.5-2.5M14 16V4M14 4l2.5 2.5M14 4l-2.5 2.5" />
    </svg>
  );
}

export default function LeadsSortControl({ value, onChange, variant = 'leads' }) {
  const options = variant === 'review' ? DUPLICATE_SORT_OPTIONS : SORT_OPTIONS;

  return (
    <label className="desk-sort-control">
      <span className="desk-sort-icon" aria-hidden>
        <SortIcon />
      </span>
      <span className="sr-only">Sort by</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="desk-sort-select"
        aria-label="Sort leads"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
