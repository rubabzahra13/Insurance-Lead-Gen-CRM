import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Writable directory for debug exports. Uses /tmp on Vercel serverless. */
export function resolveOutputDir() {
  const configured = process.env.OUTPUT_DIR?.trim();
  if (configured) return configured;
  if (process.env.VERCEL) return join(tmpdir(), 'leadscout');
  return './output';
}
