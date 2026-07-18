// Avatar 2 (Job Upgraders): employees at small firms OR upskilling talk — never CEOs/founders.

export const OWNER_TITLE_RE =
  /\b(ceo|c\.e\.o|chief executive|founder|co-?founder|owner|proprietor|managing director|chairman|chairwoman|president|principal owner|principal\b|partner\b|vice president|\bvp\b)\b/i;

export const PRODUCER_ROLE_RE =
  /\b(producer|insurance agent|agent|advisor|broker|account manager|sales (rep|representative|associate|executive)|relationship manager|insurance sales|underwriter)\b/i;

export const SMALL_FIRM_RE =
  /\b(2\s*[-–]\s*10|11\s*[-–]\s*50|independent(ly)?\s+(owned\s+)?(agency|firm|brokerage)|family[ -]?owned|small (agency|firm|brokerage|office)|boutique (agency|firm)|local agency)\b/i;

export const UPSKILL_RE =
  /\b(upskill|upskilling|career growth|looking to grow|grow my (book|career)|join a (larger|bigger|growing)|ready for (more|the next)|want to (grow|advance|level up)|seeking (growth|advancement)|open to (opportunities|a new (role|team)))\b/i;

export const OFF_ROLE_RE =
  /\b(actuary|actuarial|attorney|lawyer|counsel|solicitor|consulate|ambassador|head of marketing|marketing director|fractional legal|trade development|chief advisor)\b/i;

export function isOwnerOrFounderTitle(text) {
  return OWNER_TITLE_RE.test(String(text ?? ''));
}

export function hasProducerRole(text) {
  return PRODUCER_ROLE_RE.test(String(text ?? ''));
}

export function isOffRole(text) {
  return OFF_ROLE_RE.test(String(text ?? ''));
}

export function hasUpgraderFitSignal(blob, lead = {}) {
  return (
    SMALL_FIRM_RE.test(blob)
    || UPSKILL_RE.test(blob)
    || lead.fit_source === 'company_page'
    || /small firm/i.test(String(lead.fit_evidence || ''))
  );
}

export function isAvatar2Upgrader(lead) {
  const title = String(lead.title || lead.headline || lead.role || '');
  const blob = [
    lead.title,
    lead.headline,
    lead.role,
    lead.company,
    lead.snippet,
    lead.evidence,
    lead.fit_evidence,
    lead.past_experience,
    lead.location,
  ]
    .filter(Boolean)
    .join(' ');

  if (isOwnerOrFounderTitle(title)) return false;
  if (isOwnerOrFounderTitle(blob) && !hasProducerRole(title)) return false;
  if (isOffRole(title) || (isOffRole(blob) && !hasProducerRole(title))) return false;
  if (!hasProducerRole(title) && !hasProducerRole(blob)) return false;
  const fitOk =
    hasUpgraderFitSignal(blob, lead)
    || (hasProducerRole(title) && Boolean(String(lead.company ?? '').trim()) && !isOwnerOrFounderTitle(title));
  return fitOk;
}

export function filterAvatar2Leads(leads, { onDrop } = {}) {
  const kept = [];
  const dropped = [];
  for (const lead of leads) {
    if (isAvatar2Upgrader(lead)) kept.push(lead);
    else {
      dropped.push(lead);
      onDrop?.(lead);
    }
  }
  return { leads: kept, dropped };
}
