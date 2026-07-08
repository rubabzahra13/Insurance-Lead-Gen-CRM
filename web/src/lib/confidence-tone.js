export function confidenceToneClass(pct) {
  if (pct >= 75) return 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200';
  if (pct >= 55) return 'bg-amber-100 text-amber-700 ring-1 ring-amber-200';
  return 'bg-red-100 text-red-700 ring-1 ring-red-200';
}

export function confidencePercent(value) {
  return Math.round((value ?? 0) * 100);
}
