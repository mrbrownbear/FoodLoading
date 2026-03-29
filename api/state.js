import { sql } from '@vercel/postgres';

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY,
      state JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    INSERT INTO app_state (id, state)
    VALUES (1, '{}'::jsonb)
    ON CONFLICT (id) DO NOTHING;
  `;
}

export default async function handler(request, response) {
  response.setHeader('Content-Type', 'application/json');

  try {
    await ensureTable();

    if (request.method === 'GET') {
      const result = await sql`SELECT state, updated_at FROM app_state WHERE id = 1 LIMIT 1;`;
      const row = result.rows[0] || { state: {}, updated_at: null };
      return response.status(200).json({
        ok: true,
        state: row.state || {},
        updatedAt: row.updated_at || null
      });
    }

    if (request.method === 'POST' || request.method === 'PUT') {
      const incomingState = request.body?.state;

      if (!incomingState || typeof incomingState !== 'object' || Array.isArray(incomingState)) {
        return response.status(400).json({
          ok: false,
          error: 'Request body must include a state object.'
        });
      }

      await sql`
        INSERT INTO app_state (id, state, updated_at)
        VALUES (1, ${JSON.stringify(incomingState)}::jsonb, NOW())
        ON CONFLICT (id)
        DO UPDATE SET state = EXCLUDED.state, updated_at = NOW();
      `;

      return response.status(200).json({ ok: true });
    }

    response.setHeader('Allow', 'GET, POST, PUT');
    return response.status(405).json({ ok: false, error: 'Method not allowed.' });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      error: 'Database request failed.',
      details: error.message
    });
  }
}
