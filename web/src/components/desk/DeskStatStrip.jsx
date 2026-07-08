function formatStatValue(value) {
  return Number(value ?? 0).toLocaleString();
}

export default function DeskStatStrip({ items, refreshing = false }) {
  if (!items?.length) return null;

  return (
    <div className={`desk-stat-strip${refreshing ? ' is-refreshing' : ''}`} aria-label="Lead statistics">
      {items.map((item) => (
        <div
          key={item.label}
          className={`desk-stat${item.primary ? ' is-primary' : ''}${item.accent ? ' is-accent' : ''}`}
        >
          <span className="desk-stat-value">{formatStatValue(item.value)}</span>
          <span className="desk-stat-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export function buildHeaderStats({
  view,
  matchingTotal,
  libraryTotal,
  starredCount,
  newThisWeek,
  pendingReview,
  hasActiveFilters,
}) {
  const library = libraryTotal ?? 0;
  const matching = matchingTotal ?? 0;
  const starred = starredCount ?? 0;
  const fresh = newThisWeek ?? 0;
  const review = pendingReview ?? 0;
  const scoped = hasActiveFilters || (view !== 'all' && view !== 'review');

  if (view === 'review') {
    return [
      { label: 'Pending', value: matching, primary: true },
      { label: 'In library', value: library },
    ];
  }

  const stats = [];

  if (view === 'starred') {
    stats.push({ label: 'Starred', value: matching, primary: true });
  } else if (view === 'new') {
    stats.push({ label: 'New', value: matching, primary: true });
  } else if (scoped) {
    stats.push({ label: 'Matching', value: matching, primary: true });
  } else {
    stats.push({ label: 'Total', value: matching, primary: true });
  }

  if (scoped && matching !== library) {
    stats.push({ label: 'In library', value: library });
  }

  if (view !== 'starred' && starred > 0) {
    stats.push({ label: 'Starred', value: starred });
  }

  if (view !== 'new' && fresh > 0) {
    stats.push({ label: 'New', value: fresh });
  }

  if (review > 0) {
    stats.push({ label: 'To review', value: review, accent: true });
  }

  return stats.slice(0, 4);
}
