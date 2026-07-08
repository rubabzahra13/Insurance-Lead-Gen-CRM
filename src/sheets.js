import { existsSync } from 'node:fs';
import { google } from 'googleapis';

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

export function isSheetsConfigured() {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  return Boolean(
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID &&
      credentialsPath &&
      existsSync(credentialsPath),
  );
}

export async function appendLeadsToSheet(leads) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const sheetName = process.env.GOOGLE_SHEETS_SHEET_NAME ?? 'Sheet1';

  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const values = leads.map((lead) => COLUMNS.map((col) => lead[col] ?? ''));

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:K`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });

  return { spreadsheetId, sheetName, count: leads.length };
}
