import { useMemo } from 'react';
import { paletteAt } from '../../lib/chart-theme.js';
import { aggregateRegions, buildRegionInsight } from '../../lib/location-regions.js';

const UNFILTERABLE = new Set(['Other regions', 'Unknown']);

export default function LocationDistribution({ data, totalLocations, maxRegions = 8, onClick, compact = false }) {
  const regions = useMemo(() => aggregateRegions(data), [data]);
  const regionInsight = useMemo(() => buildRegionInsight(regions), [regions]);
  const regionTotal = useMemo(() => regions.reduce((sum, row) => sum + row.count, 0) || 1, [regions]);

  const rows = useMemo(
    () =>
      regions.slice(0, maxRegions).map((region, i) => ({
        ...region,
        fill: paletteAt(i).fill,
        border: paletteAt(i).solid,
        share: Math.round((region.count / regionTotal) * 100),
        filterable: onClick && !UNFILTERABLE.has(region.region),
      })),
    [regions, maxRegions, regionTotal, onClick],
  );

  if (rows.length === 0) return null;

  const top = rows[0];

  return (
    <div className={`location-distribution${compact ? ' is-compact' : ''}`}>
      {!compact && (
        <div className="location-hero">
          <div className="location-hero-flag" aria-hidden="true">
            {top.flag}
          </div>
          <div className="location-hero-copy">
            <span className="location-hero-eyebrow">Leading region</span>
            <span className="location-hero-name">{top.region}</span>
          </div>
          <div className="location-hero-stat">
            <span className="location-hero-pct">{top.share}%</span>
            <span className="location-hero-count">
              {top.count.toLocaleString()} lead{top.count === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      )}

      {regionInsight && <p className="location-distribution-insight">{regionInsight}</p>}

      <ol className="location-region-list" aria-label="Lead regions">
        {rows.map((region) => {
          const RowTag = region.filterable ? 'button' : 'div';
          return (
            <li key={region.region}>
              <RowTag
                type={region.filterable ? 'button' : undefined}
                className={`location-region-row${region.filterable ? ' is-clickable' : ''}`}
                onClick={region.filterable ? () => onClick(region) : undefined}
                title={region.filterable ? `Filter leads in ${region.region}` : region.region}
              >
                <span className="location-region-avatar" aria-hidden="true">
                  {region.flag}
                </span>
                <span className="location-region-body">
                  <span className="location-region-head">
                    <span className="location-region-name">{region.region}</span>
                    <span className="location-region-meta">
                      {region.count.toLocaleString()} · {region.share}%
                    </span>
                  </span>
                  <span className="location-region-track" aria-hidden="true">
                    <span
                      className="location-region-fill"
                      style={{ width: `${region.share}%`, background: region.border ?? region.fill }}
                    />
                  </span>
                </span>
              </RowTag>
            </li>
          );
        })}
      </ol>

      {totalLocations > rows.length && !compact && (
        <p className="location-distribution-footnote">
          {rows.length} regions from {totalLocations.toLocaleString()} location strings — click a region to filter leads.
        </p>
      )}
    </div>
  );
}
