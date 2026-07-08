const SESSION_KEY = 'leadscout:app-meta';
const SESSION_TTL_MS = 5 * 60 * 1000;

export function getAppMetaCache() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || Date.now() - parsed.at > SESSION_TTL_MS) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function setAppMetaCache(data) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* quota */
  }
}

export function invalidateAppMetaCache() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
