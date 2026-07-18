#!/usr/bin/env node
// Applies the shared company/location rules to rows piped in as JSON, so the
// backfill reuses lead-fields.js instead of reimplementing it in Python. A
// second copy of these rules in another language is precisely the drift that put
// the bad values in the table to begin with.
//
// stdin : [{ "id": "...", "company": "...", "location": "..." }, ...]
// stdout: [{ "id": "...", "company": <string|null>, "location": <string|null> }, ...]

import { sanitizeLeadFields } from './lead-fields.js';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const raw = await readStdin();
const rows = JSON.parse(raw || '[]');

const cleaned = rows.map((row) => {
  const { company, location } = sanitizeLeadFields({
    company: row.company ?? null,
    location: row.location ?? null,
  });
  return { id: row.id, company: company ?? null, location: location ?? null };
});

process.stdout.write(JSON.stringify(cleaned));
