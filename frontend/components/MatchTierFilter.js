'use client';

import React from 'react';
import MatchTierBadge from './MatchTierBadge';
import { MATCH_TIER_FILTER_OPTIONS } from '../lib/match-tier';

import { MATCH_TIER_FROM_KEY } from '../lib/match-tier';

/** Clickable priority filter chips — Best / Good / Possible Match */
export default function MatchTierFilter({ value = 'all', onChange, counts = {} }) {
  return (
    <div className="match-tier-filter" role="group" aria-label="Filter by match priority">
      {MATCH_TIER_FILTER_OPTIONS.map((opt) => {
        const isActive = value === opt.value;
        const countKey = opt.value === 'all' ? null : opt.value;
        const count = countKey ? counts[countKey] : null;
        const showCount = countKey && typeof count === 'number';

        return (
          <button
            key={opt.value}
            type="button"
            className={`match-tier-filter__chip${isActive ? ' is-active' : ''}`}
            onClick={() => onChange?.(opt.value)}
            aria-pressed={isActive}
          >
            {opt.value === 'all' ? (
              <span>All matches{showCount ? ` (${(counts.perfect || 0) + (counts.strong || 0) + (counts.near || 0)})` : ''}</span>
            ) : (
              <>
                <MatchTierBadge label={opt.label} />
                {showCount ? <span className="match-tier-filter__count">{count}</span> : null}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function MatchTierSummary({ counts }) {
  if (!counts) return null;
  const parts = [];
  if (counts.perfect) parts.push({ label: MATCH_TIER_FROM_KEY.perfect, n: counts.perfect });
  if (counts.strong) parts.push({ label: MATCH_TIER_FROM_KEY.strong, n: counts.strong });
  if (counts.near) parts.push({ label: MATCH_TIER_FROM_KEY.near, n: counts.near });
  if (!parts.length) return null;

  return (
    <div className="match-tier-summary" aria-label="Match tier breakdown">
      {parts.map((p) => (
        <span key={p.label} className="match-tier-summary__item">
          <MatchTierBadge label={p.label} />
          <span className="match-tier-summary__count">{p.n}</span>
        </span>
      ))}
    </div>
  );
}
