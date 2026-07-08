import { useMemo } from 'react';
import { colorAt } from '../../lib/chart-theme.js';

function truncate(value, max = 34) {
  if (!value) return '';
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function buildCompanyInsight(rows) {
  if (rows.length === 0) return null;
  const top = rows[0];
  const topThree = rows.slice(0, 3).reduce((sum, row) => sum + row.share, 0);
  if (rows.length === 1) {
    return `${top.label} is your only employer group in this view.`;
  }
  if (topThree >= 75) {
    return `Highly concentrated — top 3 employers account for ${topThree}% of leads shown.`;
  }
  return `${top.label} leads with ${top.count} lead${top.count === 1 ? '' : 's'} (${top.share}% of top ${rows.length}).`;
}

export default function RankedLeaderboard({
  data,
  totalItems,
  itemLabel = 'items',
  onClick,
  limit = 10,
  insight,
  header,
}) {
  const rows = useMemo(() => {
    const sliced = data.slice(0, limit);
    const total = sliced.reduce((sum, row) => sum + row.count, 0) || 1;
    return sliced.map((row, i) => ({
      ...row,
      fill: row.fill ?? colorAt(i),
      share: Math.round((row.count / total) * 100),
    }));
  }, [data, limit]);

  const resolvedInsight = insight ?? buildCompanyInsight(rows);
  const total = totalItems ?? data.length;

  if (rows.length === 0) return null;

  return (
    <div className="ranked-leaderboard">
      {header}
      {resolvedInsight && <p className="ranked-leaderboard-insight">{resolvedInsight}</p>}

      <ol className="ranked-leaderboard-list">
        {rows.map((row, index) => (
          <li key={row.value ?? row.label}>
            <button
              type="button"
              className="ranked-leaderboard-row"
              onClick={() => onClick?.(row)}
              title={row.value === 'Other' ? `Other ${itemLabel}` : row.label}
            >
              <span className="ranked-leaderboard-rank" aria-hidden="true">
                {index + 1}
              </span>
              <span className="ranked-leaderboard-body">
                <span className="ranked-leaderboard-head">
                  <span className="ranked-leaderboard-name">{truncate(row.label)}</span>
                  <span className="ranked-leaderboard-count">{row.count.toLocaleString()}</span>
                </span>
                <span className="ranked-leaderboard-track" aria-hidden="true">
                  <span
                    className="ranked-leaderboard-fill"
                    style={{ width: `${row.share}%`, background: row.fill }}
                  />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      {total > rows.length && (
        <p className="ranked-leaderboard-footnote">
          Showing top {rows.length} of {total.toLocaleString()} {itemLabel} — click a row to filter leads.
        </p>
      )}
    </div>
  );
}
