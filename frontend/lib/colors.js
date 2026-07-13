/** InsureLead brand palette — use sparingly; default UI stays white/neutral */
export const PALETTE = {
  white: '#ffffff',
  pastelPink: '#ffcad4',
  lightBlue: '#b0d0d3',
  oldRose: '#c08497',
  powderBlush: '#f7af9d',
};

export const COLORS = {
  ...PALETTE,
  /** Readable neutrals (not brand swatches) */
  text: '#3d3538',
  textMuted: '#7a6e72',
  accentDark: '#a06d7f',
  success: '#5a7a6e',
  error: '#b86b6b',
  warning: '#c9a06a',
};

export const INDIVIDUAL_COLORS = {
  avatar1: PALETTE.oldRose,
  avatar2: PALETTE.powderBlush,
};

export const BUSINESS_COLORS = [
  PALETTE.oldRose,
  PALETTE.powderBlush,
  PALETTE.lightBlue,
  COLORS.accentDark,
  PALETTE.pastelPink,
  '#9aabb0',
  COLORS.textMuted,
];

/** Reserved for primary buttons only */
export const GRADIENT = PALETTE.oldRose;

export const RGBA = {
  accent04: 'rgba(192, 132, 151, 0.04)',
  accent06: 'rgba(192, 132, 151, 0.06)',
  accent08: 'rgba(192, 132, 151, 0.08)',
  accent12: 'rgba(192, 132, 151, 0.12)',
  accent15: 'rgba(192, 132, 151, 0.15)',
  accent20: 'rgba(192, 132, 151, 0.2)',
  accent25: 'rgba(192, 132, 151, 0.25)',
  pink08: 'rgba(255, 202, 212, 0.35)',
  pink20: 'rgba(255, 202, 212, 0.5)',
  blush05: 'rgba(247, 175, 157, 0.12)',
  blush20: 'rgba(247, 175, 157, 0.22)',
  blue08: 'rgba(176, 208, 211, 0.25)',
  success06: 'rgba(90, 122, 110, 0.08)',
  success20: 'rgba(90, 122, 110, 0.2)',
};
