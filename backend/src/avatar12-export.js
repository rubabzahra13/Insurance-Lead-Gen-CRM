import { join } from 'node:path';
import { resolveOutputDir } from './output-dir.js';
import { writeLeadsToXlsx } from './xlsx.js';
import { syncAvatar12Leads } from './avatar12-sync.js';

function resolveXlsxPath() {
  const configured = (process.env.OUTPUT_XLSX || '').trim();
  if (!configured) {
    return join(resolveOutputDir(), 'leads.xlsx');
  }
  if (
    process.env.VERCEL &&
    !configured.startsWith('/') &&
    !configured.startsWith(resolveOutputDir())
  ) {
    return join(resolveOutputDir(), configured.replace(/^\.?\//, ''));
  }
  return configured;
}

export async function exportAndSyncAvatar12Leads(
  leads,
  {
    xlsxPath = resolveXlsxPath(),
    avatarType = process.env.AVATAR_TYPE ?? 'avatar2',
    writeFn = writeLeadsToXlsx,
    syncFn = syncAvatar12Leads,
    onSyncError = null,
  } = {},
) {
  const result = writeFn(leads, xlsxPath);
  try {
    await syncFn(leads, { avatarType });
  } catch (error) {
    onSyncError?.(error);
  }
  return result;
}
