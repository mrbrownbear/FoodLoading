import { createClient } from '@supabase/supabase-js';
import { sql } from '@vercel/postgres';

// ---------- SAFE INIT ----------

let supabase = null;
let hasSupabase = false;
let hasPostgres = false;

try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    hasSupabase = true;
  }
} catch (e) {
  console.warn('Supabase init failed:', e.message);
}

try {
  hasPostgres = !!process.env.POSTGRES_URL;
} catch (e) {
  console.warn('Postgres init failed:', e.message);
}

// fallback memory
let memoryStore = {};

// ---------- HELPERS ----------

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

// ---------- SUPABASE ----------

async function getSupabase() {
  if (!hasSupabase) return null;

  const { data, error } = await supabase
    .from('app_state')
    .select('payload')
    .eq('id', 'global')
    .maybeSingle(); // safer than .single()

  if (error) throw error;

  return data?.payload || null;
}

async function saveSupabase(payload) {
  if (!hasSupabase) return false;

  const { error } = await supabase.from('app_state').upsert({
    id: 'global',
    payload,
    updated_at: new Date().toISOString(),
  });

  if (error) throw error;
  return true;
}

// ---------- POSTGRES ----------

async function ensurePg() {
  if (!hasPostgres) return;

  await sql`
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      payload JSONB,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
}

async function getPostgres() {
  if (!hasPostgres) return null;

  await ensurePg();

  const { rows } = await sql`
    SELECT payload FROM app_state WHERE id = 'global'
  `;

  return rows[0]?.payload || null;
}

async function savePostgres(payload) {
  if (!hasPostgres) return false;

  await ensurePg();

  await sql`
    INSERT INTO app_state (id, payload, updated_at)
    VALUES ('global', ${payload}, NOW())
    ON CONFLICT (id)
    DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
  `;

  return true;
}

// ---------- HANDLER ----------

export default async function handler(req, res) {
  try {
    // ===== GET =====
    if (req.method === 'GET') {
      try {
        const data = await getSupabase();
        if (data) return json(res, 200, { data, source: 'supabase' });
      } catch (e) {
        console.warn('Supabase GET failed:', e.message);
      }

      try {
        const data = await getPostgres();
        if (data) return json(res, 200, { data, source: 'postgres' });
      } catch (e) {
        console.warn('Postgres GET failed:', e.message);
      }

      return json(res, 200, { data: memoryStore, source: 'memory' });
    }

    // ===== POST =====
    if (req.method === 'POST') {
      const payload = req.body || {};

      try {
        await saveSupabase(payload);
      } catch (e) {
        console.warn('Supabase save failed:', e.message);
      }

      try {
        await savePostgres(payload);
      } catch (e) {
        console.warn('Postgres save failed:', e.message);
      }

      memoryStore = payload;

      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('FATAL API ERROR:', err);
    return json(res, 200, { data: memoryStore, source: 'safe-fallback' });
  }
}
