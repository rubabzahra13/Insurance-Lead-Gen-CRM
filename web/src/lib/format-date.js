export function formatDate(value, options) {
  if (value == null || value === '') return '—';

  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';

  return d.toLocaleDateString(undefined, options);
}
