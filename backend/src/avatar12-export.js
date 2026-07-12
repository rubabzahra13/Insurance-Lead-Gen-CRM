import { writeLeadsToXlsx } from './xlsx.js';
import { syncAvatar12Leads } from './avatar12-sync.js';

export async function exportAndSyncAvatar12Leads(
  leads,
  {
    xlsxPath = process.env.OUTPUT_XLSX ?? './output/leads.xlsx',
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
