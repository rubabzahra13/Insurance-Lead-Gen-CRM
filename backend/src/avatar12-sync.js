import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { apiBaseUrl } from './api-base-url.js';

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

async function runHttpSync(payload) {
  const base = apiBaseUrl();
  const results = [];
  for (const lead of payload) {
    const body = {
      avatar_type: lead.avatar_type,
      name: lead.name,
      headline: lead.headline || lead.title || null,
      role: lead.role || lead.title || null,
      company: lead.company || null,
      school: lead.school || null,
      past_experience: lead.past_experience || lead.snippet || lead.evidence || null,
      location: lead.location || null,
      linkedin_url: lead.link || lead.linkedin_url || null,
      search_prompt: lead.searchPrompt || process.env.SOURCE_QUERY || null,
      source_snapshot: JSON.stringify(lead),
      source_query: process.env.SOURCE_QUERY || lead.searchPrompt || null,
    };
    const res = await fetch(`${base}/api/avatar12/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      results.push({ ok: false, error: text.slice(0, 200) });
      continue;
    }
    results.push({ ok: true, ...(await res.json()) });
  }
  return results;
}

export async function syncAvatar12Leads(
  leads,
  { avatarType = 'avatar1', runner } = {},
) {
  const payload = leads.map((lead) => ({
    ...lead,
    avatar_type: avatarType,
  }));
  const syncRunner = runner || (process.env.VERCEL ? runHttpSync : runPythonSync);
  return syncRunner(payload);
}
