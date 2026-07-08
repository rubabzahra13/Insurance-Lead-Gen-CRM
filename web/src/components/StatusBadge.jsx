export default function StatusBadge({ status, wrap = false }) {
  const text = status ?? 'unknown';
  const lower = text.toLowerCase();

  let className = 'bg-slate-100 text-slate-600 ring-1 ring-slate-200';
  if (lower.includes('link checked') || lower.includes('verified')) {
    className = 'bg-teal-50 text-teal-700 ring-1 ring-teal-200';
  } else if (lower.includes('needs review') || lower.includes('not checked')) {
    className = 'bg-amber-50 text-amber-700 ring-1 ring-amber-200';
  } else if (lower.includes('rejected')) {
    className = 'bg-slate-100 text-slate-500 line-through';
  }

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${wrap ? 'max-w-none whitespace-normal text-left leading-snug' : 'max-w-[220px] truncate'} ${className}`}
      title={text}
    >
      {text}
    </span>
  );
}
