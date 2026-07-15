#!/usr/bin/env node
/**
 * Always starts a single fresh Next.js dev server:
 * - stops stale processes on common ports
 * - deletes .next cache
 * - writes a session stamp so the UI can confirm you're on the live server
 */
import { execSync, spawn } from 'child_process';
import { rmSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const port = String(process.env.PORT || '3000');

const STALE_PORTS = ['3000', '3001', '3002', '3010', '3020', '3030', '3040', '3050'];

function killPort(p) {
  try {
    if (process.platform === 'win32') {
      execSync(`npx --yes kill-port ${p}`, { stdio: 'ignore', cwd: root });
      return;
    }
    execSync(`lsof -ti :${p} 2>/dev/null | xargs kill -9 2>/dev/null`, {
      stdio: 'ignore',
      shell: true,
    });
  } catch {
    // Port was already free.
  }
}

for (const p of new Set([port, ...STALE_PORTS])) {
  killPort(p);
}

try {
  rmSync(join(root, '.next'), { recursive: true, force: true });
} catch {
  // No cache to remove.
}

const startedAt = new Date().toISOString();
writeFileSync(
  join(root, '.dev-session.json'),
  JSON.stringify({ mode: 'development', startedAt, port }, null, 2)
);

console.log('\n-------------------------------------------');
console.log(`  InsureLead dev server (fresh start)`);
console.log(`  http://localhost:${port}`);
console.log(`  Started: ${startedAt}`);
console.log('-------------------------------------------\n');

const child = spawn('npx', ['next', 'dev', '-p', port], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PORT: port },
});

child.on('exit', (code) => process.exit(code ?? 0));
