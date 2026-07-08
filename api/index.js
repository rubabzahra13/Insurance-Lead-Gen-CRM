import app from '../src/server.js';
import { initDb } from '../src/db/index.js';

if (process.env.VERCEL) {
  initDb().catch(() => {});
}

export default app;
