import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSerpLeadPipeline } from './serp-pipeline.js';
import {
  appendScrapeEvent,
  claimScrapeJob,
  createScrapeJob,
  finishScrapeJob,
  getScrapeJob,
  waitForScrapeEvents,
} from './scrape-jobs-store.js';
import { fetchSerpQuota, invalidateSerpQuotaCache } from './serp-quota.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');
config({ path: join(rootDir, '.env'), override: true });

const runningJobs = new Set();

function initialLog(role, locationLabel) {
  return {
    type: 'log',
    message:
      `Sourcing pipeline initialized for role: "${role}"` +
      (locationLabel ? `, location: "${locationLabel}"` : ' (no location)'),
  };
}

function serializeJob(job) {
  return {
    id: job.id,
    status: job.status,
    query: job.query,
    maxResults: job.maxResults,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    events: job.events,
    result: job.result,
  };
}

async function emitAndPersist(jobId, event) {
  await appendScrapeEvent(jobId, event);
  return event;
}

async function runQueuedJob(job) {
  if (runningJobs.has(job.id)) return;
  runningJobs.add(job.id);

  const role = job.role || job.query;
  const location = job.location;
  const locationLabel = location?.label || location?.mainText || '';
  const displayQuery = locationLabel ? `${role} in ${locationLabel}` : role;

  process.env.SOURCE_QUERY = displayQuery;
  if (job.avatarType) process.env.AVATAR_TYPE = job.avatarType;
  if (job.provider) process.env.SEARCH_PROVIDER = job.provider;
  if (role) process.env.SEARCH_ROLE = role;
  if (location) process.env.SEARCH_LOCATION = JSON.stringify(location);

  const onProgress = async (event) => {
    await emitAndPersist(job.id, event);
  };

  try {
    const result = await runSerpLeadPipeline(role, {
      maxResults: job.maxResults,
      avatarType: job.avatarType || 'avatar1',
      uiLocation: location,
      role,
      onProgress,
    });
    await emitAndPersist(job.id, { type: 'done', result });
    await finishScrapeJob(job.id, { status: 'done', result });
    invalidateSerpQuotaCache();
  } catch (error) {
    const message = error?.message || String(error);
    await emitAndPersist(job.id, { type: 'error', message });
    await finishScrapeJob(job.id, { status: 'error', error: message });
    invalidateSerpQuotaCache();
  } finally {
    runningJobs.delete(job.id);
  }
}

export function mountScrapeRoutes(app) {
  app.get('/api/scrape/serp-quota', async (req, res) => {
    try {
      const force = String(req.query.force || '').toLowerCase() === 'true';
      res.json(await fetchSerpQuota({ force }));
    } catch (error) {
      res.status(500).json({ error: error?.message || 'Failed to load Serp quota' });
    }
  });

  app.post('/api/scrape', async (req, res) => {
    try {
      const role = String(req.body?.role || '').trim();
      const query = String(req.body?.query || '').trim();
      const location = req.body?.location && typeof req.body.location === 'object'
        ? { ...req.body.location }
        : null;
      if (location && !location.placeId) {
        delete location.placeId;
      }
      const locationPayload = location?.placeId ? location : null;
      const locationLabel =
        locationPayload?.label || locationPayload?.mainText || '';
      const avatarType = String(req.body?.avatarType || '').trim().toLowerCase();
      const provider = String(req.body?.provider || '').trim().toLowerCase() || null;

      if (!role && !query) {
        return res.status(400).json({ detail: 'role is required' });
      }
      if ((avatarType === 'avatar1' || avatarType === 'avatar2') && !locationPayload?.placeId) {
        return res.status(400).json({
          detail: 'location is required — pick a city or country from the dropdown',
        });
      }

      const effectiveRole = role || query;
      const displayQuery = locationLabel
        ? `${effectiveRole} in ${locationLabel}`.trim()
        : effectiveRole;
      const maxResults = Number(req.body?.maxResults || process.env.MAX_RESULTS || 25);
      const jobId = randomUUID();
      const startedAt = new Date().toISOString();

      const job = await createScrapeJob({
        id: jobId,
        status: 'queued',
        query: displayQuery,
        role: effectiveRole,
        location: locationPayload,
        maxResults,
        avatarType: avatarType || null,
        provider,
        events: [initialLog(effectiveRole, locationLabel)],
        startedAt: null,
      });

      res.json({
        runId: job.id,
        query: displayQuery,
        role: effectiveRole,
        location: locationPayload,
        maxResults,
      });
    } catch (error) {
      console.error('create scrape job failed', error);
      res.status(500).json({ detail: error?.message || 'Failed to create scrape job' });
    }
  });

  app.get('/api/scrape/:jobId', async (req, res) => {
    try {
      const job = await getScrapeJob(req.params.jobId);
      if (!job) return res.status(404).json({ detail: 'Run not found' });
      res.json(serializeJob(job));
    } catch (error) {
      console.error('get scrape job failed', error);
      res.status(500).json({ detail: error?.message || 'Failed to load scrape job' });
    }
  });

  app.get('/api/scrape/:jobId/stream', async (req, res) => {
    let job;
    try {
      job = await getScrapeJob(req.params.jobId);
    } catch (error) {
      console.error('load scrape stream failed', error);
      return res.status(500).json({ detail: error?.message || 'Failed to open stream' });
    }
    if (!job) return res.status(404).json({ detail: 'Run not found' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let sent = 0;
    const writeEvents = (events) => {
      for (let i = sent; i < events.length; i += 1) {
        res.write(`data: ${JSON.stringify(events[i])}\n\n`);
      }
      sent = events.length;
    };

    writeEvents(job.events);

    if (job.status === 'queued') {
      const claimed = await claimScrapeJob(job.id);
      if (claimed) {
        runQueuedJob(claimed).catch((error) => {
          console.error('scrape job failed', error);
        });
      }
    }

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': keepalive\n\n');
    }, 15_000);

    try {
      while (!res.writableEnded) {
        job = await waitForScrapeEvents(job.id, sent, { timeoutMs: 5_000 });
        if (!job) break;
        writeEvents(job.events);
        if (job.status === 'done' || job.status === 'error') break;
      }
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    }
  });

  app.use('/api/scrape', (_req, res) => {
    res.status(404).json({ detail: 'Scrape route not found' });
  });
}
