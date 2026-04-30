/**
 * Curator translation-report queue (T-11.1).
 *
 * URL contract:
 *   /moderation/translations?status=open&language=hi
 *
 * Default view shows status='open' across every language the moderator
 * is granted on (admins: all). Closed buckets are inspectable by passing
 * `?status=resolved_hidden|resolved_kept|dismissed`.
 *
 * Form actions:
 *   hide               — curator+ : flips translations.hidden=true via the
 *                        existing `setTranslationHidden` (writes audit row)
 *                        and bulk-resolves all open reports for that
 *                        translation as `resolved_hidden`. Reason required.
 *   keep               — curator+ : marks all open reports as `resolved_kept`
 *                        without touching the translation.
 *   dismiss            — curator+ : closes a single report (no batch effect).
 *   promoteReporter    — admin only : sets a user's role to `curator`.
 *                        Granting per-language curator rights remains a
 *                        separate flow under /moderation/dictionary.
 */
import { error, fail } from '@sveltejs/kit';

import {
  ForbiddenError,
  isAdmin,
  isCuratorOrAdmin,
  listGrantedLanguages,
} from '$lib/server/dictionary/permissions.js';
import {
  bulkResolveByTranslation,
  listReports,
  resolveReport,
  ReportValidationError,
  type ListedReport,
} from '$lib/server/moderation/reports.js';
import { setUserRole, UserNotFoundError, LastAdminError } from '$lib/server/dictionary/admin.js';
import { MissingReasonError } from '$lib/server/dictionary/audit.js';
import { isSupportedLanguage } from '@ciareader/shared-types';
import type { LanguageCode } from '@ciareader/shared-types';
import type { TranslationReport } from '$lib/server/db/schema.js';
import type { Actions, PageServerLoad } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUSES: TranslationReport['status'][] = [
  'open',
  'resolved_hidden',
  'resolved_kept',
  'dismissed',
];

function readStatus(url: URL): TranslationReport['status'] {
  const raw = url.searchParams.get('status');
  if (!raw) return 'open';
  if ((STATUSES as string[]).includes(raw)) {
    return raw as TranslationReport['status'];
  }
  throw error(400, `Unknown status; allowed: ${STATUSES.join(', ')}`);
}

export const load: PageServerLoad = async ({ url, parent }) => {
  const { moderator } = await parent();
  // Defense-in-depth — the layout already gates curator+ but we re-check
  // because `listReports` would also throw, and re-checking here lets us
  // emit a friendlier 403 instead of bubbling the service exception.
  if (!isCuratorOrAdmin(moderator)) throw error(403, 'Curator or admin role required');

  const langParam = url.searchParams.get('language');
  let language: LanguageCode | null = null;
  if (langParam && langParam !== 'any') {
    if (!isSupportedLanguage(langParam)) {
      throw error(400, `Unsupported language: ${langParam}`);
    }
    if (
      moderator.role !== 'admin' &&
      !moderator.grantedLanguages.includes(langParam)
    ) {
      throw error(403, `Not granted on ${langParam}`);
    }
    language = langParam;
  }

  const status = readStatus(url);
  const reports: ListedReport[] = await listReports(
    {
      id: moderator.id,
      role: moderator.role,
      grantedLanguages: moderator.grantedLanguages,
    },
    {
      status,
      language: language ?? undefined,
      limit: 100,
    },
  );

  return {
    moderator,
    filter: { status, language },
    reports,
    statusOptions: STATUSES,
    isAdmin: moderator.role === 'admin',
  };
};

function readField(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function mapServiceError(err: unknown): { status: number; message: string } | null {
  if (err instanceof ForbiddenError) return { status: 403, message: err.message };
  if (err instanceof MissingReasonError) {
    return { status: 400, message: err.message };
  }
  if (err instanceof ReportValidationError) {
    return { status: err.status, message: err.message };
  }
  return null;
}

export const actions: Actions = {
  hide: async ({ request, locals }) => {
    if (!locals.user || !isCuratorOrAdmin(locals.user)) {
      return fail(403, { error: 'Curator or admin role required' });
    }
    const form = await request.formData();
    const translationId = readField(form, 'translationId');
    const reason = readField(form, 'reason');
    if (!translationId || !UUID_RE.test(translationId)) {
      return fail(400, { error: 'Missing or invalid translationId' });
    }
    if (!reason || reason.length < 3) {
      return fail(400, { error: 'A reason is required for every curator edit' });
    }
    try {
      const grantedLanguages = await listGrantedLanguages(locals.user);
      const result = await bulkResolveByTranslation(
        { id: locals.user.id, role: locals.user.role, grantedLanguages },
        translationId,
        'resolved_hidden',
        reason,
      );
      return { ok: true, action: 'hide' as const, reportsAffected: result.reportsAffected };
    } catch (err) {
      const mapped = mapServiceError(err);
      if (mapped) return fail(mapped.status, { error: mapped.message });
      throw err;
    }
  },

  keep: async ({ request, locals }) => {
    if (!locals.user || !isCuratorOrAdmin(locals.user)) {
      return fail(403, { error: 'Curator or admin role required' });
    }
    const form = await request.formData();
    const translationId = readField(form, 'translationId');
    const note = readField(form, 'note');
    if (!translationId || !UUID_RE.test(translationId)) {
      return fail(400, { error: 'Missing or invalid translationId' });
    }
    try {
      const grantedLanguages = await listGrantedLanguages(locals.user);
      const result = await bulkResolveByTranslation(
        { id: locals.user.id, role: locals.user.role, grantedLanguages },
        translationId,
        'resolved_kept',
        note,
      );
      return { ok: true, action: 'keep' as const, reportsAffected: result.reportsAffected };
    } catch (err) {
      const mapped = mapServiceError(err);
      if (mapped) return fail(mapped.status, { error: mapped.message });
      throw err;
    }
  },

  dismiss: async ({ request, locals }) => {
    if (!locals.user || !isCuratorOrAdmin(locals.user)) {
      return fail(403, { error: 'Curator or admin role required' });
    }
    const form = await request.formData();
    const reportId = readField(form, 'reportId');
    const note = readField(form, 'note');
    if (!reportId || !UUID_RE.test(reportId)) {
      return fail(400, { error: 'Missing or invalid reportId' });
    }
    try {
      const grantedLanguages = await listGrantedLanguages(locals.user);
      await resolveReport(
        { id: locals.user.id, role: locals.user.role, grantedLanguages },
        reportId,
        'dismiss',
        note,
      );
      return { ok: true, action: 'dismiss' as const };
    } catch (err) {
      const mapped = mapServiceError(err);
      if (mapped) return fail(mapped.status, { error: mapped.message });
      throw err;
    }
  },

  promoteReporter: async ({ request, locals }) => {
    if (!locals.user || !isAdmin(locals.user)) {
      return fail(403, { error: 'Admin role required' });
    }
    const form = await request.formData();
    const reporterId = readField(form, 'reporterId');
    if (!reporterId || !UUID_RE.test(reporterId)) {
      return fail(400, { error: 'Missing or invalid reporterId' });
    }
    try {
      const updated = await setUserRole(reporterId, 'curator');
      return {
        ok: true,
        action: 'promoteReporter' as const,
        promoted: { id: updated.id, email: updated.email, role: updated.role },
      };
    } catch (err) {
      if (err instanceof UserNotFoundError) return fail(404, { error: 'User not found' });
      if (err instanceof LastAdminError) return fail(409, { error: err.message });
      throw err;
    }
  },
};
