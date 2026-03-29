import { createClient } from '@supabase/supabase-js';
import { sql } from '@vercel/postgres';

// ---------- INIT ----------

const hasSupabase =
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = hasSupabase
  ? createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )
  : null;

const hasPostgres = !!process.env.POSTGRES_URL;

// in-memory fallback (last resort)
let memoryStore = {};

// ---------- HELPERS ----------

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

// ---------- SUPABASE ----------

async function getFromSupabase() {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('app_state')
    .select('payload')
    .eq('id', 'global')
    .single();

  if (error && error.code !== 'PGRST116') throw error;

  return data?.payload || {};
}

async function saveToSupabase(payload) {
  if (!supabase) return false;

  const { error } = await supabase.from('app_state').upsert({
    id: 'global',
    payload,
    updated_at: new Date().toISOString(),
  });

  if (error) throw error;
  return true;
}

// ---------- POSTGRES ----------

async function ensurePgTable() {
  if (!hasPostgres) return;

  await sql`
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      payload JSONB,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
}

async function getFromPostgres() {
  if (!hasPostgres) return null;

  await ensurePgTable();

  const { rows } = await sql`
    SELECT payload FROM app_state WHERE id = 'global'
  `;

  return rows[0]?.payload || {};
}

async function saveToPostgres(payload) {
  if (!hasPostgres) return false;

  await ensurePgTable();

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
    // ---------- GET ----------
    if (req.method === 'GET') {
      // 1. Try Supabase
      try {
        const data = await getFromSupabase();
        if (data) return json(res, 200, { data, source: 'supabase' });
      } catch (e) {
        console.warn('Supabase failed:', e.message);
      }

      // 2. Fallback → Postgres
      try {
        const data = await getFromPostgres();
        if (data) return json(res, 200, { data, source: 'postgres' });
      } catch (e) {
        console.warn('Postgres failed:', e.message);
      }

      // 3. Last fallback → memory
      return json(res, 200, { data: memoryStore, source: 'memory' });
    }

    // ---------- POST ----------
    if (req.method === 'POST') {
      const payload = req.body || {};

      let saved = false;

      // 1. Try Supabase
      try {
        saved = await saveToSupabase(payload);
      } catch (e) {
        console.warn('Supabase save failed:', e.message);
      }

      // 2. Always also save to Postgres (acts as backup)
      try {
        await saveToPostgres(payload);
      } catch (e) {
        console.warn('Postgres save failed:', e.message);
      }

      // 3. Memory fallback
      memoryStore = payload;

      return json(res, 200, {
        ok: true,
        primary: saved ? 'supabase' : 'fallback',
      });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
}