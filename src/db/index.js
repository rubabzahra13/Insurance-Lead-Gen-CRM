import postgres from 'postgres';
import { lookup } from 'node:dns/promises';

let pgSql;
let resolvedDatabaseUrl;

function postgresOptions() {
  return {
    ssl: 'require',
    prepare: false,
    fetch_types: false,
    max: 1,
    connect_timeout: 10,
    idle_timeout: 20,
    max_lifetime: 60 * 5,
  };
}

export function getConfiguredDatabaseUrl() {
  const pooler = process.env.SUPABASE_POOLER_URL?.trim();
  const direct = process.env.DATABASE_URL?.trim();

  if (process.env.VERCEL) {
    if (pooler) return pooler;
    if (direct?.includes('pooler.supabase.com')) return direct;
    if (direct?.includes('@db.') && direct.includes('.supabase.co')) {
      return toTransactionPoolerUrl(direct);
    }
    return direct || '';
  }

  return direct || pooler || '';
}

function toTransactionPoolerUrl(urlString) {
  const refMatch = urlString.match(/@db\.([^.]+)\.supabase\.co/);
  if (!refMatch) return urlString;

  const url = new URL(urlString);
  const ref = refMatch[1];
  const region = process.env.SUPABASE_REGION?.trim() || 'ap-northeast-1';
  const poolerHost =
    process.env.SUPABASE_POOLER_HOST?.trim() || `aws-1-${region}.pooler.supabase.com`;

  url.username = `postgres.${ref}`;
  url.hostname = poolerHost;
  url.port = '6543';
  return url.toString();
}

async function resolvePostgresUrl() {
  const url = getConfiguredDatabaseUrl();
  if (!url) {
    throw new Error('DATABASE_URL or SUPABASE_POOLER_URL is required');
  }
  return url;
}

export function getConnectionInfo() {
  const url = resolvedDatabaseUrl || getConfiguredDatabaseUrl();
  if (!url) return { configured: false };

  try {
    const parsed = new URL(url);
    return {
      configured: true,
      host: parsed.hostname,
      port: parsed.port,
      user: parsed.username,
      vercel: Boolean(process.env.VERCEL),
      pooler: parsed.hostname.includes('pooler.supabase.com'),
    };
  } catch {
    return { configured: true, invalid: true };
  }
}

async function createPostgresClient(urlString) {
  const refMatch = urlString.match(/@db\.([^.]+)\.supabase\.co/);

  if (!process.env.VERCEL && refMatch) {
    try {
      const url = new URL(urlString);
      const { address } = await lookup(`db.${refMatch[1]}.supabase.co`, { family: 6 });
      return postgres({
        host: [address],
        port: [Number(url.port) || 5432],
        database: url.pathname.replace(/^\//, '') || 'postgres',
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        ...postgresOptions(),
      });
    } catch {
      // fall through to URL string
    }
  }

  return postgres(urlString, postgresOptions());
}

async function openConnection() {
  resolvedDatabaseUrl = await resolvePostgresUrl();
  const sql = await createPostgresClient(resolvedDatabaseUrl);
  await sql`SELECT set_config('statement_timeout', '12000', false)`;
  return sql;
}

export async function initDb() {
  if (!pgSql) {
    pgSql = await openConnection();
  }
  return pgSql;
}

export async function resetDb() {
  if (!pgSql) return;
  await pgSql.end({ timeout: 5 }).catch(() => {});
  pgSql = null;
  resolvedDatabaseUrl = undefined;
}

export function getSql() {
  if (!pgSql) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return pgSql;
}

export async function releaseDb() {
  if (!process.env.VERCEL || !pgSql) return;
  // Keep the pooler connection warm for the duration of a serverless instance.
}

export async function closeDb() {
  await resetDb();
}
