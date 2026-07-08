const REQUEST_TIMEOUT_MS = 60_000;

async function readJsonResponse(res) {
  const text = await res.text();
  if (!text) {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return {};
  }

  try {
    const data = JSON.parse(text);
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return data;
  } catch (err) {
    if (err instanceof SyntaxError) {
      const snippet = text.trim().slice(0, 160);
      throw new Error(
        res.ok ? 'Server returned invalid JSON' : snippet || `Request failed (${res.status})`,
      );
    }
    throw err;
  }
}

async function apiFetch(path, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      cache: 'no-store',
      ...options,
      signal: controller.signal,
    });
    return await readJsonResponse(res);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. Try refreshing the page.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchDesk(params = {}, { retries = 2 } = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
  }
  const path = `/api/desk?${qs}`;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await apiFetch(path, {}, 25_000);
    } catch (err) {
      lastError = err;
      const retryable = /timed out|504|503|502/i.test(err.message ?? '');
      if (attempt < retries && retryable) {
        await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

export async function fetchBootstrap(params = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
  }
  const query = qs.toString();
  return apiFetch(query ? `/api/bootstrap?${query}` : '/api/bootstrap');
}

export async function fetchDashboard({ bust = false } = {}) {
  const path = bust ? `/api/dashboard?bust=${Date.now()}` : '/api/dashboard';
  return apiFetch(path);
}

export async function fetchAnalytics(since = 'all', { retries = 2 } = {}) {
  const qs = since && since !== 'all' ? `?since=${encodeURIComponent(since)}` : '';
  const path = `/api/analytics${qs}`;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await apiFetch(path, {}, 25_000);
    } catch (err) {
      lastError = err;
      const retryable = /timed out|504|503|502/i.test(err.message ?? '');
      if (attempt < retries && retryable) {
        await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

export async function fetchRuns(limit = 50, offset = 0) {
  return apiFetch(`/api/runs?limit=${limit}&offset=${offset}`);
}

export async function fetchRunById(runId) {
  return apiFetch(`/api/runs/${runId}`);
}

export async function fetchLeads(params = {}, { retries = 1 } = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
  }
  const path = `/api/leads?${qs}`;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await apiFetch(path, {}, 20_000);
    } catch (err) {
      lastError = err;
      const retryable = /timed out|504|503|502/i.test(err.message ?? '');
      if (attempt < retries && retryable) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

export async function fetchLeadFacets(params = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
  }
  const query = qs.toString();
  return apiFetch(query ? `/api/leads/facets?${query}` : '/api/leads/facets');
}

export async function fetchLead(id) {
  return apiFetch(`/api/leads/${id}`);
}

export async function updateLead(id, patch) {
  return apiFetch(`/api/leads/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export async function deleteLead(id) {
  return apiFetch(`/api/leads/${id}`, { method: 'DELETE' });
}

export async function fetchDuplicates(status = 'pending') {
  return apiFetch(`/api/duplicates?status=${status}`);
}

export async function resolveDuplicate(id, action) {
  return apiFetch(`/api/duplicates/${id}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
}

export async function startScrape(query, maxResults) {
  return apiFetch('/api/scrape', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, maxResults }),
  });
}

export function streamScrape(runId, onEvent, { onDisconnect } = {}) {
  const source = new EventSource(`/api/scrape/${runId}/stream`);

  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data));
    } catch {
      // ignore malformed events
    }
  };

  source.onerror = () => {
    source.close();
    onDisconnect?.();
  };
  return () => source.close();
}

export async function fetchRun(runId) {
  return apiFetch(`/api/scrape/${runId}`);
}

export function exportUrl(runId) {
  return `/api/scrape/${runId}/export.xlsx`;
}

export function kbExportUrl(params = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, String(value));
  }
  const query = qs.toString();
  return query ? `/api/kb/export.xlsx?${query}` : '/api/kb/export.xlsx';
}

export async function bulkLeadsAction(ids, action, tag) {
  return apiFetch('/api/leads/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, action, tag }),
  });
}

export async function bulkLeadsByFilter(filter, action) {
  return apiFetch('/api/leads/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter, action }),
  });
}

export async function fetchLeadRuns(id) {
  return apiFetch(`/api/leads/${id}/runs`);
}

export async function fetchSavedViews() {
  return apiFetch('/api/saved-views');
}

export async function createSavedView(name, filterJson) {
  return apiFetch('/api/saved-views', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, filterJson }),
  });
}

export async function deleteSavedView(id) {
  return apiFetch(`/api/saved-views/${id}`, { method: 'DELETE' });
}
