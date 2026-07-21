const SERPAPI_ACCOUNT_URL = 'https://serpapi.com/account.json';
const CACHE_TTL_MS = 30_000;

let cache = { at: 0, payload: null };

function serpConfig() {
  const serpapi = (process.env.SERPAPI_KEY || process.env.SERP_API || '').trim();
  if (serpapi) return { provider: 'serpapi', key: serpapi };
  const serper = (process.env.SERPER_API_KEY || '').trim();
  if (serper) return { provider: 'serper', key: serper };
  return null;
}

function intOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function cleanDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return raw.length >= 10 && raw[4] === '-' && raw[7] === '-' ? raw.slice(0, 10) : raw;
}

function friendlyDate(isoDate) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return isoDate;
  return `${months[month - 1]} ${day}, ${Number(match[1])}`;
}

function formatExhaustedMessage(renewal) {
  if (renewal) return `No searches left for this month. Plan resets on ${friendlyDate(renewal)}.`;
  return 'No searches left for this month. Plan resets next month.';
}

function formatLabel(left, limit) {
  if (left === null) return null;
  if (limit !== null && limit >= 0) return `${left}/${limit} searches left`;
  return `${left} searches left`;
}

function fromSerpapiAccount(data) {
  const searchesPerMonth = intOrNull(data.searches_per_month);
  const planLeft = intOrNull(data.plan_searches_left);
  const totalLeft = intOrNull(data.total_searches_left);
  const used = intOrNull(data.this_month_usage);
  const extra = intOrNull(data.extra_credits) || 0;
  const renewal = cleanDate(data.plan_renewal_date);
  const left = planLeft !== null ? planLeft : totalLeft;
  let limit = searchesPerMonth;
  if (limit === null && left !== null && used !== null) limit = left + used;
  if (limit === null && left !== null) limit = left;

  return {
    available: true,
    provider: 'serpapi',
    plan_name: String(data.plan_name || data.plan_id || '').trim() || null,
    searches_left: left,
    searches_limit: limit,
    searches_used: used,
    extra_credits: extra || null,
    total_searches_left: totalLeft,
    this_hour_searches: intOrNull(data.this_hour_searches),
    plan_renewal_date: renewal,
    label: formatLabel(left, limit),
    exhausted_message: formatExhaustedMessage(renewal),
  };
}

export function invalidateSerpQuotaCache() {
  cache = { at: 0, payload: null };
}

export async function fetchSerpQuota({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.payload && now - cache.at < CACHE_TTL_MS) {
    return { ...cache.payload };
  }

  const config = serpConfig();
  if (!config) {
    const payload = {
      available: false,
      provider: null,
      plan_name: null,
      searches_left: null,
      searches_limit: null,
      searches_used: null,
      extra_credits: null,
      total_searches_left: null,
      this_hour_searches: null,
      plan_renewal_date: null,
      label: null,
      exhausted_message: null,
      error: 'SERPAPI_KEY (or SERPER_API_KEY) is not configured',
    };
    cache = { at: now, payload };
    return { ...payload };
  }

  if (config.provider === 'serper') {
    const payload = {
      available: true,
      provider: 'serper',
      plan_name: null,
      searches_left: null,
      searches_limit: null,
      searches_used: null,
      extra_credits: null,
      total_searches_left: null,
      this_hour_searches: null,
      plan_renewal_date: null,
      label: 'Serper search active',
      exhausted_message: null,
      note: 'Live remaining counts require SerpAPI (serpapi.com).',
    };
    cache = { at: now, payload };
    return { ...payload };
  }

  try {
    const url = new URL(SERPAPI_ACCOUNT_URL);
    url.searchParams.set('api_key', config.key);
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (res.status === 401 || res.status === 403) {
      const payload = {
        available: false,
        provider: 'serpapi',
        label: null,
        error: 'SerpAPI rejected the API key',
        searches_left: null,
        searches_limit: null,
        searches_used: null,
      };
      cache = { at: now, payload };
      return { ...payload };
    }
    if (!res.ok) {
      const payload = {
        available: false,
        provider: 'serpapi',
        label: null,
        error: `SerpAPI account error ${res.status}`,
        searches_left: null,
        searches_limit: null,
        searches_used: null,
      };
      cache = { at: now, payload };
      return { ...payload };
    }
    const data = await res.json();
    if (data?.error) {
      const payload = {
        available: false,
        provider: 'serpapi',
        label: null,
        error: String(data.error),
        searches_left: null,
        searches_limit: null,
        searches_used: null,
      };
      cache = { at: now, payload };
      return { ...payload };
    }
    const payload = fromSerpapiAccount(data);
    cache = { at: now, payload };
    return { ...payload };
  } catch (error) {
    const payload = {
      available: false,
      provider: 'serpapi',
      label: null,
      error: String(error?.message || error).slice(0, 180),
      searches_left: null,
      searches_limit: null,
      searches_used: null,
    };
    cache = { at: now, payload };
    return { ...payload };
  }
}
