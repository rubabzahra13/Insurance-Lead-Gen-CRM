// Runtime match tiers — labels shown in UI; ordering for export rank.

export const MATCH_TIER_ORDER = {
  perfect: 0,
  strong: 1,
  near: 2,
  drop: 99,
};

export const MATCH_TIER_LABELS = {
  perfect: 'Best Match',
  strong: 'Good Match',
  near: 'Possible Match',
};

/** @param {string | undefined | null} tier */
export function normalizeMatchTier(tier) {
  const key = String(tier || '').trim().toLowerCase();
  if (key === 'perfect' || key === 'strong' || key === 'near') return key;
  if (key === 'drop' || key === 'dropped' || key === 'reject' || key === 'rejected') return 'drop';
  return 'near';
}

export function matchTierLabel(tier) {
  const key = normalizeMatchTier(tier);
  return MATCH_TIER_LABELS[key] || null;
}

export function isExportableTier(tier) {
  return normalizeMatchTier(tier) !== 'drop';
}

export function annotateLeadMatchTier(lead, tier, reason = '') {
  const key = normalizeMatchTier(tier);
  return {
    ...lead,
    match_tier: key,
    match_label: matchTierLabel(key),
    match_reason: String(reason || '').trim() || lead.match_reason || '',
  };
}

export function compareMatchTier(a, b) {
  const ta = MATCH_TIER_ORDER[normalizeMatchTier(a?.match_tier)] ?? 50;
  const tb = MATCH_TIER_ORDER[normalizeMatchTier(b?.match_tier)] ?? 50;
  if (ta !== tb) return ta - tb;
  return (b?.confidence ?? 0) - (a?.confidence ?? 0);
}

export function rankLeadsByMatchTier(leads) {
  return [...leads].sort(compareMatchTier);
}
