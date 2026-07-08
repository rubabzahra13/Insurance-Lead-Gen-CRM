import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const COLUMNS = [
  'name',
  'title',
  'company',
  'location',
  'link',
  'snippet',
  'confidence',
  'status',
  'verificationNotes',
  'searchPrompt',
  'scrapedAt',
];

function escapeCsv(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsvRow(lead) {
  return COLUMNS.map((col) => escapeCsv(lead[col])).join(',');
}

export function writeLeadsToCsv(leads, filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const header = COLUMNS.join(',');
  const rows = leads.map(toCsvRow).join('\n');

  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${header}\n${rows}\n`, 'utf8');
  } else {
    appendFileSync(filePath, `${rows}\n`, 'utf8');
  }

  return { filePath, count: leads.length };
}
