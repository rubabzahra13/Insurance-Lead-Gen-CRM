/** Internal keys (avatar1/2/3) — not shown in the UI. */
export const AVATAR_LABELS = {
  avatar1: 'Job Seekers',
  avatar2: 'Job Upgraders',
  avatar3: 'Founder-Led & Small Businesses',
};

/** Two lead paths users choose between (individuals together vs businesses separately). */
export const LEAD_PATH = {
  people: {
    label: 'Job seekers & job upgraders',
    shortLabel: 'Individual leads',
    description: 'Individuals open to insurance careers or ready to upgrade their role',
  },
  business: {
    label: 'Founder-led & small businesses',
    shortLabel: 'Business leads',
    description: 'Local founders and small business owners',
  },
};

export const WORKSPACE_LABELS = {
  individuals: {
    nav: 'Individual Leads',
    title: 'Individual Leads',
    board: 'Individual Leads Board',
    description: LEAD_PATH.people.description,
  },
  businesses: {
    nav: 'Business Leads',
    title: 'Business Leads',
    board: 'Business Pipeline Board',
    description: LEAD_PATH.business.description,
  },
};

export function individualLabel(avatarType) {
  if (avatarType === 'avatar1') return AVATAR_LABELS.avatar1;
  if (avatarType === 'avatar2') return AVATAR_LABELS.avatar2;
  return 'Individual leads';
}

export function individualShortLabel(avatarType) {
  if (avatarType === 'avatar1') return 'Job seekers';
  if (avatarType === 'avatar2') return 'Job upgraders';
  return 'Individual';
}

export function leadPathLabel(avatarType) {
  if (avatarType === 'avatar3') return LEAD_PATH.business.label;
  return LEAD_PATH.people.label;
}

export function individualOverrideLabel(avatarType) {
  if (avatarType === 'avatar1') return AVATAR_LABELS.avatar2;
  return AVATAR_LABELS.avatar1;
}

/** @deprecated Use leadPathLabel — kept for any legacy imports */
export function routingLabel(avatarType) {
  return leadPathLabel(avatarType);
}

const STAGE_LABELS = {
  new: 'New',
  qualified: 'Qualified',
  warm: 'Warm',
  follow_up_later: 'Follow up',
  sealed_won: 'Won',
  lost: 'Lost',
  not_interested: 'Not interested',
};

export function pipelineStageLabel(stage) {
  return STAGE_LABELS[stage] || stage || 'Unknown';
}
