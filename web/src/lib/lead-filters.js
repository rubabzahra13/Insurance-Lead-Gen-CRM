const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function includes(haystack, needle) {
  if (!needle) return true;
  return (haystack ?? '').toLowerCase().includes(needle.toLowerCase());
}

function matchesSearch(lead, q) {
  if (!q) return true;
  const blob = [
    lead.name,
    lead.title,
    lead.company,
    lead.location,
    lead.snippet,
    lead.searchPrompt,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return blob.includes(q.toLowerCase());
}

export function leadMatchesDeskFilters(lead, { view, filters, runId }) {
  if (view === 'review') return false;
  if (view === 'starred' && !lead.starred) return false;

  if (view === 'new') {
    const created = lead.createdAt ? new Date(lead.createdAt).getTime() : Date.now();
    if (!Number.isFinite(created) || Date.now() - created > WEEK_MS) return false;
  }

  const activeRunId = runId ?? filters?.runId;
  if (activeRunId) {
    const linkedRuns = lead._runIds ?? (lead._runId ? [lead._runId] : []);
    if (linkedRuns.length && !linkedRuns.includes(activeRunId)) return false;
  }

  if (!matchesSearch(lead, filters?.q)) return false;
  if (!includes(lead.company, filters?.company)) return false;
  if (!includes(lead.location, filters?.location)) return false;
  if (!includes(lead.title, filters?.title)) return false;

  const tag = filters?.tag?.trim();
  if (tag) {
    const tags = lead.tags ?? [];
    const tagBlob = tags.join(' ').toLowerCase();
    if (!tagBlob.includes(tag.toLowerCase())) return false;
  }

  return true;
}

export function mergeDeskLeads(existing, incoming, { prepend = true } = {}) {
  const seen = new Set();
  const merged = [];

  function key(lead) {
    if (lead.id != null) return `id:${lead.id}`;
    if (lead.link) return `link:${lead.link}`;
    return `name:${lead.name}|${lead.company ?? ''}`;
  }

  const ordered = prepend ? [...incoming, ...existing] : [...existing, ...incoming];
  for (const lead of ordered) {
    const k = key(lead);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(lead);
  }

  return merged;
}
