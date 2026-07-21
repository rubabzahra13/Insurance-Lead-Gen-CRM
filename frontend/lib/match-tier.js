export const MATCH_TIER_STYLES = {
  'Best Match': {
    bg: 'rgba(34, 139, 84, 0.12)',
    color: '#1a7a42',
    border: 'rgba(34, 139, 84, 0.35)',
  },
  'Good Match': {
    bg: 'rgba(59, 130, 246, 0.12)',
    color: '#2563eb',
    border: 'rgba(59, 130, 246, 0.35)',
  },
  'Possible Match': {
    bg: 'rgba(245, 158, 11, 0.12)',
    color: '#b45309',
    border: 'rgba(245, 158, 11, 0.35)',
  },
};

/** UI labels — best → good → possible (internal tiers stay perfect/strong/near). */
export const MATCH_TIER_FROM_KEY = {
  perfect: 'Best Match',
  strong: 'Good Match',
  near: 'Possible Match',
};

/** Older searches stored previous label text — map for display. */
export const LEGACY_MATCH_LABELS = {
  'Perfect Match': 'Best Match',
  'Strong Match': 'Good Match',
  'Near Match': 'Possible Match',
};

export const MATCH_TIER_FILTER_OPTIONS = [
  { value: 'all', label: 'All matches' },
  { value: 'perfect', label: 'Best Match' },
  { value: 'strong', label: 'Good Match' },
  { value: 'near', label: 'Possible Match' },
];

function parseSnapshot(lead) {
  if (!lead?.source_snapshot) return null;
  try {
    return typeof lead.source_snapshot === 'string'
      ? JSON.parse(lead.source_snapshot)
      : lead.source_snapshot;
  } catch {
    return null;
  }
}

export function normalizeMatchLabel(label) {
  if (!label) return null;
  const trimmed = String(label).trim();
  return LEGACY_MATCH_LABELS[trimmed] || trimmed;
}

export function resolveLeadMatchTier(lead) {
  if (lead?.match_tier) return lead.match_tier;
  const snap = parseSnapshot(lead);
  return snap?.match_tier || null;
}

export function resolveLeadMatchReason(lead) {
  if (lead?.match_reason) return lead.match_reason;
  const snap = parseSnapshot(lead);
  return snap?.match_reason || null;
}

export function resolveLeadMatchLabel(lead) {
  const tier = resolveLeadMatchTier(lead);
  if (tier && MATCH_TIER_FROM_KEY[tier]) return MATCH_TIER_FROM_KEY[tier];
  const raw = lead?.match_label || parseSnapshot(lead)?.match_label;
  return normalizeMatchLabel(raw);
}

export function matchTierStyle(label) {
  const normalized = normalizeMatchLabel(label);
  return MATCH_TIER_STYLES[normalized] || MATCH_TIER_STYLES['Possible Match'];
}

const MATCH_TIER_SORT = {
  perfect: 0,
  strong: 1,
  near: 2,
};

const LABEL_SORT = {
  'Best Match': 0,
  'Good Match': 1,
  'Possible Match': 2,
  'Perfect Match': 0,
  'Strong Match': 1,
  'Near Match': 2,
};

export function matchTierSortKey(lead) {
  const tier = resolveLeadMatchTier(lead);
  if (tier && MATCH_TIER_SORT[tier] !== undefined) return MATCH_TIER_SORT[tier];
  const label = resolveLeadMatchLabel(lead);
  if (label && LABEL_SORT[label] !== undefined) return LABEL_SORT[label];
  return 50;
}

export function leadMatchesTierFilter(lead, filter) {
  if (!filter || filter === 'all') return true;
  const tier = resolveLeadMatchTier(lead);
  if (tier) return tier === filter;
  const label = resolveLeadMatchLabel(lead);
  return label === MATCH_TIER_FROM_KEY[filter];
}

export function countMatchTiers(leads) {
  const counts = { perfect: 0, strong: 0, near: 0 };
  for (const lead of leads || []) {
    const tier = resolveLeadMatchTier(lead);
    if (tier && counts[tier] !== undefined) counts[tier] += 1;
    else {
      const label = resolveLeadMatchLabel(lead);
      if (label === 'Best Match') counts.perfect += 1;
      else if (label === 'Good Match') counts.strong += 1;
      else if (label === 'Possible Match') counts.near += 1;
    }
  }
  return counts;
}
