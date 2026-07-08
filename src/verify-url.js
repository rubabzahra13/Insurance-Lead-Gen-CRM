import { linkedinSlugFromUrl, normalizeProfileUrl, normalizePersonName, sleep } from './utils.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// LinkedIn answers 999 (bot block) and 405 (HEAD rejected) for real AND fake
// URLs alike, so those statuses prove nothing. The only trustworthy positive
// signal is a 200 page whose <title> shows the person's name.
const BLOCKED_STATUSES = new Set([403, 405, 429, 999]);

function extractTitle(html) {
  return html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? '';
}

function nameAppearsInTitle(title, expectedName) {
  const tokens = normalizePersonName(expectedName)
    .split(' ')
    .filter((token) => token.length > 2);
  if (tokens.length === 0) return false;

  const haystack = normalizePersonName(title);
  const matched = tokens.filter((token) => haystack.includes(token)).length;
  return matched / tokens.length >= 0.5;
}

export async function verifyLinkedInUrl(url, options = {}) {
  const normalized = normalizeProfileUrl(url);
  if (!normalized) {
    return { status: 'invalid', httpStatus: null, finalUrl: null, reason: 'not_a_linkedin_profile_url' };
  }

  const timeoutMs = Number(options.timeoutMs ?? process.env.URL_VERIFY_TIMEOUT_MS ?? 8000);
  const maxRetries = Number(options.maxRetries ?? 1);
  const expectedName = options.expectedName ?? null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(normalized, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      const finalUrl = normalizeProfileUrl(response.url) ?? normalized;

      if (response.status === 404) {
        return { status: 'invalid', httpStatus: 404, finalUrl, reason: 'profile_not_found' };
      }

      if (BLOCKED_STATUSES.has(response.status)) {
        return {
          status: 'inconclusive',
          httpStatus: response.status,
          finalUrl,
          reason: 'linkedin_blocked_check',
        };
      }

      if (response.status >= 500) {
        if (attempt < maxRetries) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        return { status: 'inconclusive', httpStatus: response.status, finalUrl, reason: 'upstream_error' };
      }

      if (response.status !== 200) {
        return { status: 'inconclusive', httpStatus: response.status, finalUrl, reason: 'unexpected_status' };
      }

      if (!finalUrl.includes('linkedin.com/in/') || !linkedinSlugFromUrl(finalUrl)) {
        return { status: 'invalid', httpStatus: 200, finalUrl, reason: 'redirected_away_from_profile' };
      }

      const title = extractTitle(await response.text());

      if (!title || /sign\s*up|log\s*in|authwall/i.test(title)) {
        return { status: 'inconclusive', httpStatus: 200, finalUrl, reason: 'login_wall' };
      }

      if (expectedName) {
        if (nameAppearsInTitle(title, expectedName)) {
          return { status: 'verified', httpStatus: 200, finalUrl, reason: 'profile_loaded_name_matches' };
        }
        return { status: 'invalid', httpStatus: 200, finalUrl, reason: 'page_shows_different_name' };
      }

      return { status: 'verified', httpStatus: 200, finalUrl, reason: 'profile_loaded' };
    } catch (error) {
      if (attempt < maxRetries) {
        await sleep(1000 * (attempt + 1));
        continue;
      }

      const reason = error.name === 'TimeoutError' || error.name === 'AbortError' ? 'timeout' : 'network_error';
      return { status: 'inconclusive', httpStatus: null, finalUrl: normalized, reason };
    }
  }

  return { status: 'inconclusive', httpStatus: null, finalUrl: normalized, reason: 'unknown' };
}
