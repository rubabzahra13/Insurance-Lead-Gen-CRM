import { createHash } from 'node:crypto';

export function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

export function apiTimeout(ms = 55_000) {
  return (req, res, next) => {
    // Scrape runs for minutes; never time out the start request or live SSE stream.
    if (req.path.startsWith('/scrape')) return next();

    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({ error: 'Request timed out' });
      }
    }, ms);

    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));
    next();
  };
}

export function sendCachedJson(_req, res, data, { maxAge = 15 } = {}) {
  res.setHeader('Cache-Control', `private, max-age=${maxAge}, stale-while-revalidate=60`);
  res.setHeader('ETag', `"${createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16)}"`);
  res.json(data);
}
