const STORAGE_PREFIX = 'leadscout:analytics:';
const TTL_MS = 5 * 60 * 1000;

export function readAnalyticsCache(since = 'all') {
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${since}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || Date.now() - parsed.at > TTL_MS) {
      sessionStorage.removeItem(`${STORAGE_PREFIX}${since}`);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function writeAnalyticsCache(since, data) {
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${since}`, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* quota */
  }
}
