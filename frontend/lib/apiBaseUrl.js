/** Shared API origin for browser fetches (same-origin empty string on Vercel). */
export function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
}
