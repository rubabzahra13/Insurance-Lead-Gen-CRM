/** InsureLead palette — accent fills only; default UI stays white/neutral */
export const PALETTE = {
  white: '#ffffff',
  base: '#FAF9F6',
  neutral: '#4B5563',
  emerald: '#0F766E',
  amber: '#B45309',
  powderBlush: '#f7af9d',
  /** UI chrome accent — tabs, links, icons (not brand emerald) */
  oldRose: '#4B5563',
  lightBlue: '#b0d0d3',
  pastelPink: '#FAF9F6',
};

export const COLORS = {
  ...PALETTE,
  /** Readable neutrals (not brand swatches) */
  text: '#3d3538',
  textMuted: '#7a6e72',
  accentDark: '#374151',
  success: '#4B5563',
  error: '#b86b6b',
  warning: '#B45309',
};

export const INDIVIDUAL_COLORS = {
  avatar1: PALETTE.neutral,
  avatar2: PALETTE.powderBlush,
};

export const BUSINESS_COLORS = [
  PALETTE.emerald,
  PALETTE.neutral,
  PALETTE.powderBlush,
  PALETTE.amber,
  PALETTE.emerald,
  COLORS.error,
  COLORS.textMuted,
];

/** Kanban stages — color on lead cards; buckets stay white */
export const BUSINESS_STAGES = [
  { id: 'new', label: 'New', color: PALETTE.emerald, bg: 'rgba(15, 118, 110, 0.05)' },
  { id: 'qualified', label: 'Qualified', color: PALETTE.neutral, bg: 'rgba(75, 85, 99, 0.04)' },
  { id: 'warm', label: 'Warm', color: PALETTE.powderBlush, bg: 'rgba(247, 175, 157, 0.12)' },
  { id: 'follow_up_later', label: 'Follow Up Later', color: PALETTE.amber, bg: 'rgba(180, 83, 9, 0.06)' },
  { id: 'sealed_won', label: 'Won', color: PALETTE.emerald, bg: 'rgba(15, 118, 110, 0.07)' },
  { id: 'lost', label: 'Lost', color: COLORS.error, bg: 'rgba(184, 107, 107, 0.06)' },
  { id: 'not_interested', label: 'Not Interested', color: COLORS.textMuted, bg: 'rgba(75, 85, 99, 0.03)' },
];

/** Reserved for primary buttons only */
export const GRADIENT = PALETTE.emerald;

export const RGBA = {
  accent04: 'rgba(15, 118, 110, 0.04)',
  accent06: 'rgba(15, 118, 110, 0.06)',
  accent08: 'rgba(15, 118, 110, 0.08)',
  accent12: 'rgba(15, 118, 110, 0.12)',
  accent15: 'rgba(15, 118, 110, 0.15)',
  accent20: 'rgba(15, 118, 110, 0.2)',
  accent25: 'rgba(15, 118, 110, 0.25)',
  pink08: 'rgba(15, 118, 110, 0.08)',
  pink20: 'rgba(15, 118, 110, 0.14)',
  blush05: 'rgba(247, 175, 157, 0.12)',
  blush20: 'rgba(247, 175, 157, 0.22)',
  blue08: 'rgba(176, 208, 211, 0.25)',
  success06: 'rgba(75, 85, 99, 0.06)',
  success20: 'rgba(75, 85, 99, 0.14)',
  neutral06: 'rgba(75, 85, 99, 0.06)',
  amber08: 'rgba(180, 83, 9, 0.08)',
  error08: 'rgba(184, 107, 107, 0.06)',
  baseFill: '#FAF9F6',
};
