export function toIsoOrNull(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? value.toISOString() : null;
  }

  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }

  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
