'use client';

import React from 'react';
import { matchTierStyle } from '../lib/match-tier';

export default function MatchTierBadge({ label, size = 'sm' }) {
  if (!label) return null;
  const style = matchTierStyle(label);
  const fontSize = size === 'md' ? '0.78rem' : '0.7rem';
  const padding = size === 'md' ? '3px 10px' : '2px 8px';

  return (
    <span
      className="match-tier-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize,
        fontWeight: 600,
        padding,
        borderRadius: '999px',
        background: style.bg,
        color: style.color,
        border: `1px solid ${style.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}
