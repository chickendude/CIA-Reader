/**
 * Admin "Dictionary sources" page (T-3.14).
 *
 * Lists every registered importer and exposes per-row actions for the
 * three operations the curator-on-call needs to do without dropping
 * into a shell: re-fetch the upstream raw cache, re-import from that
 * cache, and delete the cache.
 *
 * Lives under /moderation/* (not /admin/*) because the existing
 * `/moderation/+layout.server.ts` already gates curator+admin access;
 * this loader narrows further to admin-only, mirroring the bulk-tools
 * page. The original ticket pitched a separate `/admin/` route group,
 * but reusing the existing surface keeps the nav consistent and avoids
 * a one-off layout file.
 */
import { error, fail, redirect } from '@sveltejs/kit';

import {
  deleteCache,
  JobAlreadyRunningError,
  listSourceStatuses,
  triggerFetch,
  triggerImport,
} from '$lib/server/dictionary/admin-imports.js';
import { isAdmin } from '$lib/server/dictionary/permissions.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login?next=/moderation/dictionary/sources');
  if (!isAdmin({ role: locals.user.role })) {
    throw error(403, 'Dictionary source management requires admin role');
  }
  const sources = await listSourceStatuses();
  return { sources };
};

export type ActionSection = 'fetch' | 'import' | 'delete' | 'fetch-all';

export type ActionResult =
  | { ok: true; section: ActionSection; slug?: string; message?: string }
  | { ok: false; section: ActionSection; slug?: string; message: string };

function requireAdmin(locals: App.Locals): { id: string } {
  if (!locals.user) throw error(401, 'Unauthorized');
  if (!isAdmin({ role: locals.user.role })) throw error(403, 'Admin role required');
  return { id: locals.user.id };
}

function describeError(e: unknown, slug: string): { status: number; message: string } {
  if (e instanceof JobAlreadyRunningError) {
    return { status: 409, message: `A job is already running for ${slug}` };
  }
  return { status: 500, message: e instanceof Error ? e.message : 'Unexpected error' };
}

export const actions: Actions = {
  fetch: async ({ request, locals }) => {
    const admin = requireAdmin(locals);
    const form = await request.formData();
    const slug = String(form.get('slug') ?? '');
    if (!slug) {
      return fail(400, { ok: false, section: 'fetch', message: 'Missing slug' } satisfies ActionResult);
    }
    try {
      triggerFetch(slug, { triggeredByUserId: admin.id });
      return { ok: true, section: 'fetch', slug } satisfies ActionResult;
    } catch (e) {
      const { status, message } = describeError(e, slug);
      return fail(status, { ok: false, section: 'fetch', slug, message } satisfies ActionResult);
    }
  },

  import: async ({ request, locals }) => {
    const admin = requireAdmin(locals);
    const form = await request.formData();
    const slug = String(form.get('slug') ?? '');
    if (!slug) {
      return fail(400, { ok: false, section: 'import', message: 'Missing slug' } satisfies ActionResult);
    }
    try {
      triggerImport(slug, { triggeredByUserId: admin.id });
      return { ok: true, section: 'import', slug } satisfies ActionResult;
    } catch (e) {
      const { status, message } = describeError(e, slug);
      return fail(status, { ok: false, section: 'import', slug, message } satisfies ActionResult);
    }
  },

  delete: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const slug = String(form.get('slug') ?? '');
    if (!slug) {
      return fail(400, { ok: false, section: 'delete', message: 'Missing slug' } satisfies ActionResult);
    }
    try {
      await deleteCache(slug);
      return { ok: true, section: 'delete', slug } satisfies ActionResult;
    } catch (e) {
      const { status, message } = describeError(e, slug);
      return fail(status, { ok: false, section: 'delete', slug, message } satisfies ActionResult);
    }
  },

  /**
   * Convenience: trigger a fetch for every source whose cache is
   * currently `missing`. Does not chain into a re-import — once the
   * fetch lands the curator presses "Re-import" on each row. Adding
   * an automatic chain (fetch → import) would mean tracking a multi-
   * step job state machine, which is more than the current MVP needs.
   */
  fetchAllMissing: async ({ locals }) => {
    const admin = requireAdmin(locals);
    const sources = await listSourceStatuses();
    const triggered: string[] = [];
    const skipped: string[] = [];
    for (const row of sources) {
      if (row.cache.state !== 'missing') continue;
      try {
        triggerFetch(row.slug, { triggeredByUserId: admin.id });
        triggered.push(row.slug);
      } catch {
        skipped.push(row.slug);
      }
    }
    const plural = triggered.length === 1 ? '' : 's';
    const skippedNote = skipped.length ? ` (${skipped.length} already running)` : '';
    return {
      ok: true,
      section: 'fetch-all',
      message: `Started fetch for ${triggered.length} source${plural}${skippedNote}`,
    } satisfies ActionResult;
  },
};
