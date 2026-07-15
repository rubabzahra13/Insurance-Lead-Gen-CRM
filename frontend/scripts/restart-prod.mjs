#!/usr/bin/env node
/**
 * Production preview: kill stale servers, clean build, start on a fixed port.
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

console.log('\nBuilding production bundle...\n');
execSync('npm run build', { cwd: root, stdio: 'inherit' });

const startedAt = new Date().toISOString();
writeFileSync(
  join(root, '.dev-session.json'),
  JSON.stringify({ mode: 'production', startedAt, port }, null, 2)
);

console.log('\n-------------------------------------------');
console.log(`  InsureLead production preview`);
console.log(`  http://localhost:${port}`);
console.log(`  Built: ${startedAt}`);
console.log('-------------------------------------------\n');

const child = spawn('npx', ['next', 'start', '-p', port], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => process.exit(code ?? 0));
