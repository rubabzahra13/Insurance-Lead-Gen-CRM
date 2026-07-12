#!/usr/bin/env node
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLeadPipeline } from './pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');

config({ path: join(rootDir, '.env'), override: true });

const query = process.argv[2] ?? '';
const maxResults = Number(process.argv[3] ?? process.env.MAX_RESULTS ?? 25);

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function main() {
  if (!query.trim()) {
    throw new Error('query is required');
  }

  const result = await runLeadPipeline(query, {
    maxResults,
    onProgress: emit,
  });

  emit({ type: 'done', result });
}

main().catch((error) => {
  emit({ type: 'error', message: error.message });
  process.exitCode = 1;
});
