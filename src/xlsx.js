import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import XLSX from 'xlsx';

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

const SHEET_NAME = 'Leads';

function leadToRow(lead) {
  return COLUMNS.map((col) => lead[col] ?? '');
}

const LINK_IDX = COLUMNS.indexOf('link');
const NAME_IDX = COLUMNS.indexOf('name');
const COMPANY_IDX = COLUMNS.indexOf('company');

// Dedupe key: the LinkedIn URL when present, otherwise name + company.
function rowKey(row) {
  const link = String(row[LINK_IDX] ?? '').trim().toLowerCase().replace(/\/$/, '');
  if (link) return `link:${link}`;
  const name = String(row[NAME_IDX] ?? '').trim().toLowerCase();
  const company = String(row[COMPANY_IDX] ?? '').trim().toLowerCase();
  return `person:${name}|${company}`;
}

function dedupeRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    byKey.set(rowKey(row), row); // later rows (newer scrapes) replace earlier ones
  }
  return [...byKey.values()];
}

function readExistingRows(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [COLUMNS];

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (rows.length === 0) return [COLUMNS];

  const [header, ...data] = rows;
  const hasHeader = Array.isArray(header) && header[0] === COLUMNS[0];
  return hasHeader ? [header, ...data] : [COLUMNS, ...rows];
}

export function leadsToXlsxBuffer(leads) {
  const rows = [COLUMNS, ...leads.map(leadToRow)];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, SHEET_NAME);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

export function writeLeadsToXlsx(leads, filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const [header, ...existing] = existsSync(filePath) ? readExistingRows(filePath) : [COLUMNS];
  const deduped = dedupeRows([...existing, ...leads.map(leadToRow)]);

  const worksheet = XLSX.utils.aoa_to_sheet([header, ...deduped]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, SHEET_NAME);
  XLSX.writeFile(workbook, filePath);

  return { filePath, count: leads.length, total: deduped.length };
}
