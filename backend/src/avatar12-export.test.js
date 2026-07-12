import test from 'node:test';
import assert from 'node:assert/strict';
import { exportAndSyncAvatar12Leads } from './avatar12-export.js';

test('export still succeeds when avatar draft sync fails', async () => {
  const leads = [
    { name: 'Jane Doe', title: 'Sales Manager', company: 'Acme Insurance', location: 'Dallas, TX' },
  ];
  const writes = [];

  const result = await exportAndSyncAvatar12Leads(leads, {
    avatarType: 'avatar1',
    writeFn: (rows, filePath) => {
      writes.push({ rows, filePath });
      return { filePath, count: rows.length, total: rows.length };
    },
    syncFn: async () => {
      throw new Error('Claude unavailable');
    },
  });

  assert.equal(result.count, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].rows[0].name, 'Jane Doe');
});
