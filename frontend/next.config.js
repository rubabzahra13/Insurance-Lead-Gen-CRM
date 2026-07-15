const fs = require('fs');
const path = require('path');

function readAppSession() {
  try {
    const sessionPath = path.join(__dirname, '.dev-session.json');
    return JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  } catch {
    return { mode: '', startedAt: '', port: '3000' };
  }
}

const appSession = readAppSession();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    // On Vercel, default to same-origin "" so /api/* hits the FastAPI service rewrite.
    NEXT_PUBLIC_API_BASE_URL:
      process.env.NEXT_PUBLIC_API_BASE_URL !== undefined
        ? process.env.NEXT_PUBLIC_API_BASE_URL
        : process.env.NEXT_PUBIC_BASE_URL ||
          process.env.NEXT_PUBLIC_BASE_URL ||
          (process.env.VERCEL ? '' : 'http://localhost:8000'),
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
    NEXT_PUBLIC_APP_SESSION_STARTED: appSession.startedAt || '',
    NEXT_PUBLIC_APP_SESSION_MODE: appSession.mode || '',
    NEXT_PUBLIC_APP_SESSION_PORT: String(appSession.port || '3000'),
  },
};

module.exports = nextConfig;
