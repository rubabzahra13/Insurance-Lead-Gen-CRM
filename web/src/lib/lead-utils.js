export function normalizeLeadId(id) {
  if (id == null || id === '') return null;
  const n = typeof id === 'bigint' ? Number(id) : Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function sameLeadId(a, b) {
  const left = normalizeLeadId(a);
  const right = normalizeLeadId(b);
  return left != null && left === right;
}

export function normalizeLead(lead) {
  if (!lead) return lead;
  const id = normalizeLeadId(lead.id);
  return id == null ? lead : { ...lead, id };
}

export function isPersistedLead(lead) {
  if (!lead || lead._preview) return false;
  return normalizeLeadId(lead.id) != null;
}
