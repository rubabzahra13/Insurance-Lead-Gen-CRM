import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { runLeadPipeline } from './pipeline.js';
import { parseSearchPrompt } from './utils.js';
import { activeProvider } from './llm.js';
import { searchGooglePlaces } from './avatar3-places.js';
import { enrichBusinessWebsite } from './avatar3-enrich.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');

config({ path: join(rootDir, '.env'), override: true });

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
const jobs = new Map();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function emit(job, event) {
  job.events.push({ ...event, at: new Date().toISOString() });
  for (const res of job.subscribers) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

async function getJob(id) {
  const job = jobs.get(id);
  if (job) return job;

  const err = new Error('Run not found');
  err.status = 404;
  throw err;
}

// ── Health ────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, provider: activeProvider(), port: PORT });
});

app.post('/api/avatar3/search', async (req, res) => {
  try {
    const results = await searchGooglePlaces({
      query: req.body?.query,
      locationBias: req.body?.location_bias ?? null,
      apiKey: process.env.PLACES_API_KEY,
    });
    res.json({ preview: results });
  } catch (error) {
    if (error.status === 429) {
      if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
      return res.status(429).json({
        error: error.message,
        retry_after: error.retryAfter ?? null,
      });
    }
    return res.status(error.status ?? 500).json({ error: error.message });
  }
});

app.post('/api/avatar3/enrich', async (req, res) => {
  try {
    const result = await enrichBusinessWebsite({
      website: req.body?.website,
      businessName: req.body?.business_name,
    });
    res.json(result);
  } catch (error) {
    return res.status(error.status ?? 500).json({ error: error.message });
  }
});

// ── Scrape ────────────────────────────────────────────────────────────────
app.post('/api/scrape', async (req, res) => {
  const rawQuery = String(req.body?.query ?? '').trim();
  const maxResults = Number(req.body?.maxResults ?? process.env.MAX_RESULTS ?? 25);

  const searchPrompt = parseSearchPrompt(rawQuery);
  if (!searchPrompt) {
    return res.status(400).json({ error: 'Enter a search query, e.g. "CEOs in marketing"' });
  }

  const id = randomUUID();
  const startedAt = new Date().toISOString();
  const job = {
    id,
    status: 'running',
    query: rawQuery,
    searchPrompt,
    maxResults,
    events: [],
    result: null,
    error: null,
    subscribers: new Set(),
    startedAt,
  };
  jobs.set(id, job);

  res.status(202).json({ runId: id, searchPrompt, maxResults });

  try {
    const result = await runLeadPipeline(searchPrompt, {
      maxResults,
      onProgress: (event) => emit(job, event),
    });
    job.status = 'done';
    job.result = result;
    job.finishedAt = new Date().toISOString();
    emit(job, { type: 'done', result });
  } catch (error) {
    job.status = 'error';
    job.error = error.message;
    job.finishedAt = new Date().toISOString();
    emit(job, { type: 'error', message: error.message });
  } finally {
    for (const subscriber of job.subscribers) {
      subscriber.end();
    }
    job.subscribers.clear();
  }
});

app.get('/api/scrape/:id', async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    res.json({
      id: job.id,
      status: job.status,
      query: job.query,
      searchPrompt: job.searchPrompt,
      maxResults: job.maxResults,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      error: job.error,
      events: job.events,
      result: job.result,
    });
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

app.get('/api/scrape/:id/stream', async (req, res) => {
  let job;
  try {
    job = await getJob(req.params.id);
  } catch (error) {
    return res.status(error.status ?? 500).json({ error: error.message });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': keepalive\n\n');
    }
  }, 15000);

  for (const event of job.events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  if (job.status !== 'running') {
    clearInterval(heartbeat);
    return res.end();
  }

  job.subscribers.add(res);
  req.on('close', () => {
    clearInterval(heartbeat);
    job.subscribers.delete(res);
  });
});

// ── Error handling ────────────────────────────────────────────────────────
app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.status ?? 500;
  const exposeMessage = status < 500 || process.env.NODE_ENV !== 'production';
  res.status(status).json({
    error: exposeMessage ? (error.message ?? 'Request failed') : 'Internal server error',
  });
});

app.use('*', (_req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`LeadGen API → http://localhost:${PORT}`);
    console.log(`LLM provider: ${activeProvider()}`);
  });
}
