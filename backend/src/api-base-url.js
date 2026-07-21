export function apiBaseUrl() {
  const explicit = (process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_API_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = (process.env.VERCEL_URL || '').trim();
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:8000';
}
