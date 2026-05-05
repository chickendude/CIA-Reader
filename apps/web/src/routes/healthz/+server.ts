import { json, error } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';

import { db } from '$lib/server/db';
import type { RequestHandler } from './$types';

/**
 * Production health probe (T-13.5).
 *
 * Lighter than /api/v1/smoke — no NLP round-trip, just a 1ms DB ping
 * to confirm the web process can reach Postgres. Used by:
 *   - the web container's docker healthcheck,
 *   - scripts/deploy.sh's post-deploy poll,
 *   - Uptime Kuma's external monitor.
 *
 * Returns 200 when ready to serve traffic, 503 otherwise.
 */
export const GET: RequestHandler = async () => {
  try {
    await db.execute(sql`SELECT 1`);
    return json({ status: 'ok' });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw error(503, `database unreachable: ${message}`);
  }
};
