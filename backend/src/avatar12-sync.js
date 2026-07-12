import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function runPythonSync(payload) {
  const pythonBin = existsSync(join(process.cwd(), 'venv', 'bin', 'python'))
    ? join(process.cwd(), 'venv', 'bin', 'python')
    : 'python';

  const { stdout } = await execFileAsync(pythonBin, ['-m', 'app.scripts.sync_avatar12_leads'], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      AVATAR12_PAYLOAD: JSON.stringify(payload),
      PYTHONPATH: `${process.cwd()}${process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ''}`,
    },
  });
  return JSON.parse(stdout.trim() || '[]');
}

export async function syncAvatar12Leads(
  leads,
  { avatarType = 'avatar1', runner = runPythonSync } = {},
) {
  const payload = leads.map((lead) => ({
    ...lead,
    avatar_type: avatarType,
  }));
  return runner(payload);
}
