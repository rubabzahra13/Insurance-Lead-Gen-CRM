import { normalizePersonName } from './utils.js';

function corpusText(rawItems) {
  return rawItems.map((item) => `${item.title ?? ''} ${item.snippet ?? ''} ${item.url ?? ''}`).join('\n');
}

function tokens(value) {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function hasOverlap(value, haystack, minTokens = 1) {
  if (!value?.trim()) return { ok: true, reason: 'empty' };
  const hay = haystack.toLowerCase();
  if (hay.includes(value.trim().toLowerCase())) return { ok: true, reason: 'exact' };

  const valueTokens = tokens(value).filter((t) => !['inc', 'llc', 'ltd', 'corp', 'the', 'and'].includes(t));
  if (valueTokens.length === 0) return { ok: true, reason: 'short' };

  const hits = valueTokens.filter((t) => hay.includes(t));
  return hits.length >= minTokens
    ? { ok: true, reason: `tokens:${hits.slice(0, 3).join(',')}` }
    : { ok: false, reason: `missing tokens from "${value}"` };
}

function checkName(name, haystack) {
  if (!name?.trim()) return { ok: false, reason: 'no name' };
  const parts = normalizePersonName(name).split(' ').filter(Boolean);
  if (parts.length === 0) return { ok: false, reason: 'no name' };
  const hay = haystack.toLowerCase();
  const last = parts[parts.length - 1];
  const first = parts[0];
  if (hay.includes(name.toLowerCase())) return { ok: true, reason: 'exact' };
  if (hay.includes(first) && hay.includes(last)) return { ok: true, reason: 'first+last' };
  return { ok: false, reason: 'name not in corpus' };
}

function checkLink(link, haystack) {
  if (!link) return { ok: true, reason: 'empty' };
  const slug = link.split('/in/')[1]?.replace(/\/$/, '') ?? '';
  if (!slug) return { ok: false, reason: 'bad link' };
  return haystack.toLowerCase().includes(slug.toLowerCase())
    ? { ok: true, reason: 'slug in corpus' }
    : { ok: false, reason: 'link not in corpus' };
}

export function validateLeadFields(lead, rawItems, searchPrompt) {
  const haystack = corpusText(rawItems);

  return {
    name: checkName(lead.name, haystack),
    title: hasOverlap(lead.title, haystack, 1),
    company: hasOverlap(lead.company, haystack, 1),
    location: hasOverlap(lead.location, haystack, 1),
    link: checkLink(lead.link, haystack),
  };
}

export function summarizeValidation(leads, rawItems, searchPrompt) {
  const rows = leads.map((lead) => ({
    name: lead.name,
    fields: validateLeadFields(lead, rawItems, searchPrompt),
  }));

  const fields = ['name', 'title', 'company', 'location', 'link'];
  const totals = Object.fromEntries(fields.map((f) => [f, { pass: 0, fail: 0 }]));

  for (const row of rows) {
    for (const field of fields) {
      if (row.fields[field].ok) totals[field].pass += 1;
      else totals[field].fail += 1;
    }
  }

  return { rows, totals };
}

export function printValidationReport(leads, rawItems, searchPrompt) {
  const { rows, totals } = summarizeValidation(leads, rawItems, searchPrompt);

  console.log('\nField accuracy (value supported by raw search corpus):\n');
  for (const [field, { pass, fail }] of Object.entries(totals)) {
    const total = pass + fail;
    const pct = total ? Math.round((pass / total) * 100) : 0;
    console.log(`  ${field.padEnd(10)} ${pass}/${total} (${pct}%)`);
  }

  console.log('\nPer-lead detail:\n');
  for (const row of rows) {
    const flags = ['name', 'title', 'company', 'location', 'link']
      .map((f) => `${f[0].toUpperCase()}${row.fields[f].ok ? '✓' : '✗'}`)
      .join(' ');
    const lead = leads.find((l) => l.name === row.name);
    console.log(`${flags}  ${lead.name}`);
    console.log(
      `       title: ${lead.title ?? '—'} | company: ${lead.company ?? '—'} | location: ${lead.location ?? '—'}`,
    );
    for (const field of ['name', 'title', 'company', 'location', 'link']) {
      if (!row.fields[field].ok) {
        console.log(`       ⚠ ${field}: ${row.fields[field].reason}`);
      }
    }
  }

  return { rows, totals };
}
