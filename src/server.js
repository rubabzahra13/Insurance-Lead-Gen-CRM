import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { runLeadPipeline } from './pipeline.js';
import { leadsToXlsxBuffer } from './xlsx.js';
import { parseSearchPrompt } from './utils.js';
import { activeProvider } from './llm.js';
import { getConnectionInfo, getSql, initDb, resetDb } from './db/index.js';
import { attachDb } from './middleware/db.js';
import { asyncHandler } from './middleware/async.js';
import { apiTimeout, securityHeaders, sendCachedJson } from './middleware/http.js';
import { getAnalytics } from './db/analytics.js';
import { getBootstrapData } from './db/bootstrap.js';
import { getDeskSnapshot } from './db/desk.js';
import { insertRun, completeRun, getRun, listRuns } from './db/runs.js';
import {
  bulkLeadsAction,
  bulkLeadsActionByFilter,
  deleteLead,
  getDashboardStats,
  getLeadById,
  getLeadFacets,
  getLeadRunHistory,
  getLeadsForRun,
  listLeads,
  updateLead,
} from './db/leads.js';
import {
  getDuplicateReview,
  listDuplicateReviews,
  resolveDuplicateReview,
} from './db/duplicates.js';
import {
  addIncomingAsNewLead,
  importRunLeadsToKb,
  mergeDuplicateIntoExisting,
} from './db/import-run.js';
import { persistPipelineToKb } from './db/persist-run.js';
import { createSavedView, deleteSavedView, listSavedViews } from './db/saved-views.js';
import { invalidateCache, invalidateTags, getCached, setCached } from './db/query-cache.js';

function bustDataCaches() {
  invalidateTags('desk', 'leads', 'analytics', 'facets');
  invalidateCache('bootstrap');
  invalidateCache('dashboard');
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

config({ path: join(rootDir, '.env'), override: true });

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
const jobs = new Map();

app.use(cors());
app.use(securityHeaders);
app.use(express.json({ limit: '1mb' }));
app.use('/api', attachDb());
app.use('/api', apiTimeout());

const webDist = join(rootDir, 'dist');
if (existsSync(webDist)) {
  app.use(
    express.static(webDist, {
      maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
      etag: true,
      index: false,
    }),
  );
}

function emit(job, event) {
  job.events.push({ ...event, at: new Date().toISOString() });
  for (const res of job.subscribers) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

async function getJob(id) {
  const job = jobs.get(id);
  if (job) return job;

  const stored = await getRun(id);
  if (!stored) {
    const err = new Error('Run not found');
    err.status = 404;
    throw err;
  }

  return {
    id: stored.id,
    status: stored.status,
    query: stored.query,
    searchPrompt: stored.searchPrompt,
    maxResults: stored.maxResults,
    events: [],
    result: stored.result,
    error: stored.error,
    subscribers: new Set(),
    startedAt: stored.startedAt,
    finishedAt: stored.finishedAt,
    kb:
      stored.leadsAdded != null
        ? { leadsAdded: stored.leadsAdded, duplicatesFound: stored.duplicatesFound ?? 0 }
        : null,
    fromDb: true,
  };
}

async function persistRunCompletion(job, result, error) {
  return persistPipelineToKb({
    query: job.query,
    searchPrompt: job.searchPrompt,
    maxResults: job.maxResults,
    result,
    error: error ?? null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    runId: job.id,
  });
}

app.get('/api/health/live', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get(
  '/api/health',
  asyncHandler(async (_req, res) => {
    const sql = getSql();
    await sql`SELECT 1 AS ok`;
    res.json({
      ok: true,
      provider: activeProvider(),
      port: PORT,
      db: true,
      connection: getConnectionInfo(),
    });
  }),
);

app.get(
  '/api/dashboard',
  asyncHandler(async (req, res) => {
    const cacheKey = 'dashboard:summary';
    const skipCache = Boolean(req.query.bust);
    if (!skipCache) {
      const cached = getCached(cacheKey, 30_000);
      if (cached) {
        return sendCachedJson(req, res, cached, { maxAge: 30 });
      }
    }
    const [stats, recentRuns] = await Promise.all([
      getDashboardStats(),
      listRuns({ limit: 8 }),
    ]);
    const payload = { stats, recentRuns };
    setCached(cacheKey, payload, ['desk']);
    sendCachedJson(req, res, payload, { maxAge: skipCache ? 0 : 30 });
  }),
);

app.get(
  '/api/analytics',
  asyncHandler(async (req, res) => {
    sendCachedJson(req, res, await getAnalytics({ since: req.query.since ?? 'all' }), {
      maxAge: 45,
    });
  }),
);

app.get(
  '/api/desk',
  asyncHandler(async (req, res) => {
    const data = await getDeskSnapshot({
      view: req.query.view ?? 'all',
      q: req.query.q,
      company: req.query.company,
      location: req.query.location,
      title: req.query.title,
      tag: req.query.tag,
      runId: req.query.runId,
      createdSince: req.query.createdSince,
      sort: req.query.sort,
      order: req.query.order,
      limit: Number(req.query.limit ?? 50),
      offset: Number(req.query.offset ?? 0),
    });
    sendCachedJson(req, res, data, { maxAge: 15 });
  }),
);

app.get(
  '/api/bootstrap',
  asyncHandler(async (req, res) => {
    const data = await getBootstrapData({
      view: req.query.view ?? 'all',
      q: req.query.q,
      company: req.query.company,
      location: req.query.location,
      title: req.query.title,
      tag: req.query.tag,
      runId: req.query.runId,
      createdSince: req.query.createdSince,
      sort: req.query.sort,
      order: req.query.order,
      limit: Number(req.query.limit ?? 50),
      offset: Number(req.query.offset ?? 0),
    });
    sendCachedJson(req, res, data, { maxAge: 10 });
  }),
);

app.get('/api/runs', async (req, res, next) => {
  try {
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    res.json({ runs: await listRuns({ limit, offset }) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/runs/:id', async (req, res, next) => {
  try {
    const run = await getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json(run);
  } catch (error) {
    next(error);
  }
});

app.get('/api/leads', async (req, res, next) => {
  try {
    const params = {
      q: req.query.q,
      company: req.query.company,
      location: req.query.location,
      title: req.query.title,
      starred: req.query.starred,
      tag: req.query.tag,
      runId: req.query.runId,
      createdSince: req.query.createdSince,
      limit: Number(req.query.limit ?? 50),
      offset: Number(req.query.offset ?? 0),
      sort: req.query.sort,
      order: req.query.order,
    };
    const cacheKey = `leads:${JSON.stringify(params)}`;
    const cached = getCached(cacheKey, 30_000);
    if (cached) {
      return sendCachedJson(req, res, cached, { maxAge: 15 });
    }
    const data = await listLeads(params);
    setCached(cacheKey, data, ['leads']);
    sendCachedJson(req, res, data, { maxAge: 15 });
  } catch (error) {
    next(error);
  }
});

app.get('/api/leads/facets', async (req, res, next) => {
  try {
    const params = {
      q: req.query.q,
      company: req.query.company,
      location: req.query.location,
      title: req.query.title,
      starred: req.query.starred,
      tag: req.query.tag,
      runId: req.query.runId,
      createdSince: req.query.createdSince,
    };
    const cacheKey = `facets:${JSON.stringify(params)}`;
    const cached = getCached(cacheKey, 60_000);
    if (cached) {
      return sendCachedJson(req, res, cached, { maxAge: 30 });
    }
    const data = await getLeadFacets(params);
    setCached(cacheKey, data, ['facets']);
    sendCachedJson(req, res, data, { maxAge: 30 });
  } catch (error) {
    next(error);
  }
});

app.get('/api/leads/:id/runs', async (req, res, next) => {
  try {
    const lead = await getLeadById(Number(req.params.id));
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ runs: await getLeadRunHistory(lead.id) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/leads/:id', async (req, res, next) => {
  try {
    const lead = await getLeadById(Number(req.params.id));
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead);
  } catch (error) {
    next(error);
  }
});

app.post('/api/leads/bulk', async (req, res, next) => {
  try {
    const { ids, filter, action, tag } = req.body ?? {};
    if (!['star', 'unstar', 'add_tag', 'delete'].includes(action)) {
      return res.status(400).json({ error: 'action must be star, unstar, add_tag, or delete' });
    }

    if (filter && typeof filter === 'object') {
      const result = await bulkLeadsActionByFilter(filter, action, { tag });
      bustDataCaches();
      return res.json({ ok: true, ...result });
    }

    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'ids array or filter object is required' });
    }

    const result = await bulkLeadsAction(ids, action, { tag });
    bustDataCaches();
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.get('/api/saved-views', async (_req, res, next) => {
  try {
    res.json({ views: await listSavedViews() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/saved-views', async (req, res, next) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const view = await createSavedView({
      name,
      filterJson: req.body?.filterJson ?? {},
    });
    res.status(201).json(view);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/saved-views/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!(await deleteSavedView(id))) return res.status(404).json({ error: 'Saved view not found' });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/leads/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await getLeadById(id);
    if (!existing) return res.status(404).json({ error: 'Lead not found' });

    const patch = {};
    for (const key of [
      'name',
      'title',
      'company',
      'location',
      'link',
      'snippet',
      'evidence',
      'status',
      'notes',
      'starred',
      'tags',
    ]) {
      if (req.body?.[key] !== undefined) patch[key] = req.body[key];
    }
    if (req.body?.verificationNotes !== undefined) {
      patch.verificationNotes = req.body.verificationNotes;
    }

    const updated = await updateLead(id, patch);
    bustDataCaches();
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/leads/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!(await deleteLead(id))) return res.status(404).json({ error: 'Lead not found' });
    bustDataCaches();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/duplicates', async (req, res, next) => {
  try {
    res.json(
      await listDuplicateReviews({
        status: req.query.status ?? 'pending',
        limit: Number(req.query.limit ?? 50),
        offset: Number(req.query.offset ?? 0),
      }),
    );
  } catch (error) {
    next(error);
  }
});

app.post('/api/duplicates/:id/resolve', async (req, res, next) => {
  try {
    const review = await getDuplicateReview(Number(req.params.id));
    if (!review) return res.status(404).json({ error: 'Duplicate review not found' });
    if (review.status !== 'pending') {
      return res.status(400).json({ error: 'Duplicate review already resolved' });
    }

    const action = req.body?.action;
    if (!['merge', 'keep_both', 'dismiss'].includes(action)) {
      return res.status(400).json({ error: 'action must be merge, keep_both, or dismiss' });
    }

    let lead = review.existingLead;

    if (action === 'merge') {
      lead = await mergeDuplicateIntoExisting(review);
      await resolveDuplicateReview(review.id, 'merged');
    } else if (action === 'keep_both') {
      lead = await addIncomingAsNewLead(review);
      await resolveDuplicateReview(review.id, 'keep_both');
    } else {
      await resolveDuplicateReview(review.id, 'dismissed');
    }

    bustDataCaches();
    res.json({ ok: true, action, lead, review: await getDuplicateReview(review.id) });
  } catch (error) {
    next(error);
  }
});

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

  await insertRun({
    id,
    query: rawQuery,
    searchPrompt,
    maxResults,
    provider: activeProvider(),
    startedAt,
  });

  res.status(202).json({ runId: id, searchPrompt, maxResults });

  try {
    const result = await runLeadPipeline(searchPrompt, {
      maxResults,
      onProgress: (event) => emit(job, event),
    });
    job.status = 'done';
    job.result = result;
    job.finishedAt = new Date().toISOString();

    const importStats = await persistRunCompletion(job, result);
    job.kb = importStats;
    bustDataCaches();
    emit(job, {
      type: 'done',
      result,
      kb: importStats,
    });
  } catch (error) {
    job.status = 'error';
    job.error = error.message;
    job.finishedAt = new Date().toISOString();
    await persistRunCompletion(job, null, error.message);
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
      kb: job.kb ?? null,
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

  if (job.fromDb) {
    return res.status(410).json({ error: 'Live stream unavailable for archived run' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  for (const event of job.events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  if (job.status !== 'running') {
    return res.end();
  }

  job.subscribers.add(res);
  req.on('close', () => job.subscribers.delete(res));
});

app.get('/api/scrape/:id/export.xlsx', async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    const leads = job.result?.leads?.length ? job.result.leads : await getLeadsForRun(job.id);

    if (!leads?.length) {
      return res.status(400).json({ error: 'No leads available to export' });
    }

    const buffer = leadsToXlsxBuffer(leads);
    const filename = `leads-${job.searchPrompt.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

app.get('/api/kb/export.xlsx', async (req, res, next) => {
  try {
    const { leads } = await listLeads({
      q: req.query.q,
      company: req.query.company,
      location: req.query.location,
      title: req.query.title,
      starred: req.query.starred,
      tag: req.query.tag,
      runId: req.query.runId,
      createdSince: req.query.createdSince,
      limit: 5000,
      offset: 0,
    });

    if (!leads.length) {
      return res.status(400).json({ error: 'No leads in knowledge base to export' });
    }

    const buffer = leadsToXlsxBuffer(leads);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="leadscout-kb.xlsx"');
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const connectionLost =
    error?.code === 'ECONNRESET' ||
    error?.code === 'ECONNREFUSED' ||
    error?.code === 'ENOTFOUND' ||
    error?.code === '57P01' ||
    error?.code === '08006' ||
    error?.code === '08003';
  if (connectionLost) {
    resetDb().catch(() => {});
  }
  const status =
    error.status ??
    (error.code === '57014' ? 504 : undefined) ??
    (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' ? 503 : 500);
  const exposeMessage = status < 500 || process.env.NODE_ENV !== 'production';
  res.status(status).json({
    error: exposeMessage ? (error.message ?? 'Request failed') : 'Internal server error',
  });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  const indexHtml = join(webDist, 'index.html');
  if (existsSync(indexHtml)) return res.sendFile(indexHtml);
  res.status(404).json({
    error: 'Frontend not built. Run: npm run build:web',
  });
});

export default app;

if (!process.env.VERCEL) {
  initDb()
    .then(() => {
      const server = app.listen(PORT, () => {
        console.log(`LeadScout API → http://localhost:${PORT}`);
        console.log(`LLM provider: ${activeProvider()}`);
        console.log(`Database → ${getConnectionInfo().host ?? 'not configured'}`);
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`Port ${PORT} is already in use. Stop the other process first:`);
          console.error(`  lsof -ti :${PORT} | xargs kill`);
          process.exit(1);
        }
        throw err;
      });
    })
    .catch((error) => {
      console.error('Failed to initialize database:', error.message);
      process.exit(1);
    });
}
