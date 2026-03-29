import { createClient } from '@supabase/supabase-js';
import { sql } from '@vercel/postgres';

let supabase = null;
let hasSupabase = false;
let hasPostgres = false;

// Simple in-memory fallback for cases where both providers fail
let memoryStore = {};

// Optional debug switch
const DEBUG = process.env.STATE_DEBUG === '1';

function log(...args) {
  if (DEBUG) console.log('[state-api]', ...args);
}

function warn(...args) {
  console.warn('[state-api]', ...args);
}

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function normalizePayload(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload;
  }
  return {};
}

// Safe init so missing env vars never crash the route
try {
  if (
    typeof process.env.SUPABASE_URL === 'string' &&
    process.env.SUPABASE_URL.trim() &&
    typeof process.env.SUPABASE_SERVICE_ROLE_KEY === 'string' &&
    process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
  ) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      }
    );
    hasSupabase = true;
    log('Supabase enabled');
  } else {
    log('Supabase not configured');
  }
} catch (err) {
  warn('Supabase init failed:', err?.message || err);
}

try {
  hasPostgres = !!(
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING
  );
  log('Postgres enabled:', hasPostgres);
} catch (err) {
  warn('Postgres init failed:', err?.message || err);
}

async function ensurePgTable() {
  if (!hasPostgres) return;

  await sql`
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
}

async function getFromSupabase() {
  if (!hasSupabase || !supabase) return null;

  const { data, error } = await supabase
    .from('app_state')
    .select('payload')
    .eq('id', 'global')
    .maybeSingle();

  if (error) throw error;

  return data?.payload ?? null;
}

async function saveToSupabase(payload) {
  if (!hasSupabase || !supabase) return false;

  const clean = normalizePayload(payload);

  const { error } = await supabase.from('app_state').upsert(
    {
      id: 'global',
      payload: clean,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );

  if (error) throw error;
  return true;
}

async function getFromPostgres() {
  if (!hasPostgres) return null;

  await ensurePgTable();

  const result = await sql`
    SELECT payload
    FROM app_state
    WHERE id = 'global'
    LIMIT 1
  `;

  return result.rows?.[0]?.payload ?? null;
}

async function saveToPostgres(payload) {
  if (!hasPostgres) return false;

  await ensurePgTable();

  const clean = normalizePayload(payload);

  await sql`
    INSERT INTO app_state (id, payload, updated_at)
    VALUES ('global', ${JSON.stringify(clean)}::jsonb, NOW())
    ON CONFLICT (id)
    DO UPDATE SET
      payload = EXCLUDED.payload,
      updated_at = NOW()
  `;

  return true;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      let supabaseError = null;
      let postgresError = null;

      try {
        const data = await getFromSupabase();
        if (data !== null) {
          log('GET served from Supabase');
          memoryStore = normalizePayload(data);
          return json(res, 200, { data: memoryStore, source: 'supabase' });
        }
      } catch (err) {
        supabaseError = err?.message || String(err);
        warn('Supabase GET failed:', supabaseError);
      }

      try {
        const data = await getFromPostgres();
        if (data !== null) {
          log('GET served from Postgres');
          memoryStore = normalizePayload(data);
          return json(res, 200, { data: memoryStore, source: 'postgres' });
        }
      } catch (err) {
        postgresError = err?.message || String(err);
        warn('Postgres GET failed:', postgresError);
      }

      log('GET served from memory');
      return json(res, 200, {
        data: normalizePayload(memoryStore),
        source: 'memory',
        debug: DEBUG
          ? {
              hasSupabase,
              hasPostgres,
              supabaseError,
              postgresError,
            }
          : undefined,
      });
    }

    if (req.method === 'POST') {
      const payload = normalizePayload(req.body);

      let savedToSupabase = false;
      let savedToPostgres = false;
      let supabaseError = null;
      let postgresError = null;

      try {
        savedToSupabase = await saveToSupabase(payload);
        if (savedToSupabase) log('POST saved to Supabase');
      } catch (err) {
        supabaseError = err?.message || String(err);
        warn('Supabase POST failed:', supabaseError);
      }

      try {
        savedToPostgres = await saveToPostgres(payload);
        if (savedToPostgres) log('POST saved to Postgres');
      } catch (err) {
        postgresError = err?.message || String(err);
        warn('Postgres POST failed:', postgresError);
      }

      memoryStore = payload;

      return json(res, 200, {
        ok: true,
        source: savedToSupabase
          ? 'supabase'
          : savedToPostgres
          ? 'postgres'
          : 'memory',
        saved: {
          supabase: savedToSupabase,
          postgres: savedToPostgres,
          memory: true,
        },
        debug: DEBUG
          ? {
              hasSupabase,
              hasPostgres,
              supabaseError,
              postgresError,
            }
          : undefined,
      });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    warn('Fatal handler error:', err?.message || err);
    return json(res, 200, {
      data: normalizePayload(memoryStore),
      source: 'safe-fallback',
      error: DEBUG ? err?.message || String(err) : undefined,
    });
  }
}
