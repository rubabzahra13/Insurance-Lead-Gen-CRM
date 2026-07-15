#!/usr/bin/env node
/**
 * Keeps a single FastAPI dev server running:
 * - frees port 8000 before start
 * - reloads only app/ and src/ (not venv or node_modules)
 * - restarts automatically if uvicorn exits (e.g. stuck reload)
 */
import { execSync, spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const port = String(process.env.API_PORT || process.env.PORT || '8000');
const uvicorn = join(root, 'venv', 'bin', 'uvicorn');

const STALE_PORTS = ['8000', '8001', '8002'];

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startUvicorn() {
  return new Promise((resolve) => {
    const child = spawn(
      uvicorn,
      [
        'app.main:app',
        '--reload',
        '--port',
        port,
        '--reload-dir',
        'app',
        '--reload-dir',
        'src',
        '--timeout-graceful-shutdown',
        '3',
      ],
      {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, PORT: port },
      }
    );

    child.on('exit', (code, signal) => {
      resolve({ code: code ?? 0, signal });
    });
  });
}

async function main() {
  for (const p of new Set([port, ...STALE_PORTS])) {
    killPort(p);
  }

  const startedAt = new Date().toISOString();
  writeFileSync(
    join(root, '.dev-session.json'),
    JSON.stringify({ mode: 'development', startedAt, port }, null, 2)
  );

  console.log('\n-------------------------------------------');
  console.log('  InsureLead API (fresh start)');
  console.log(`  http://localhost:${port}`);
  console.log(`  Started: ${startedAt}`);
  console.log('  Auto-restarts if the server stops');
  console.log('-------------------------------------------\n');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { code, signal } = await startUvicorn();
    if (signal === 'SIGINT' || signal === 'SIGTERM') {
      process.exit(code);
    }
    console.log(`\nAPI exited (code ${code}). Restarting in 1s...\n`);
    killPort(port);
    await sleep(1000);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
