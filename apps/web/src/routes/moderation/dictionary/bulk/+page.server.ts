/**
 * Bulk curator tools page (T-3.9).
 *
 * Three forms in one page, each routed to a distinct action so we can
 * narrow the result by `section` exactly the way the lemma editor does.
 * All three operations are admin-only at the service layer; this loader
 * additionally gates the page so a curator without admin role doesn't
 * see a UI they can't use.
 *
 * The CSV-style import accepts a tab- or comma-separated paste in the
 * textarea; it's parsed line by line on the server. Re-using the
 * existing JSON service keeps every code path through one validator.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';

import {
  bulkImportTranslations,
  bulkPromoteTranslations,
  bulkUpdateAttribution,
  BULK_LIMIT,
  type BulkImportRow,
  type BulkImportResult,
  type BulkPromoteResult,
  type BulkAttributionResult,
} from '$lib/server/dictionary/bulk.js';
import { isSupportedLanguage, type LanguageCode } from '@ciareader/shared-types';
import { CuratorValidationError } from '$lib/server/dictionary/curator.js';
import { ForbiddenError, isAdmin } from '$lib/server/dictionary/permissions.js';
import { MissingReasonError } from '$lib/server/dictionary/audit.js';
import type { Actions, PageServerLoad } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapError(e: unknown): { status: number; message: string } {
  if (e instanceof CuratorValidationError) return { status: e.status, message: e.message };
  if (e instanceof MissingReasonError) return { status: 400, message: e.message };
  if (e instanceof ForbiddenError) return { status: 403, message: e.message };
  return { status: 500, message: 'Unexpected error' };
}

type ImportResult =
  | ({ ok: true; section: 'import' } & BulkImportResult)
  | { ok: false; section: 'import'; message: string };
type PromoteResult =
  | ({ ok: true; section: 'promote' } & BulkPromoteResult)
  | { ok: false; section: 'promote'; message: string };
type AttributionResult =
  | ({ ok: true; section: 'attribution' } & BulkAttributionResult)
  | { ok: false; section: 'attribution'; message: string };

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login?next=/moderation/dictionary/bulk');
  if (!isAdmin({ role: locals.user.role })) {
    throw error(403, 'Bulk tools require admin role');
  }
  return { bulkLimit: BULK_LIMIT };
};

const importSchema = z.object({
  csv: z.string().min(1, 'paste at least one row'),
  reason: z.string().max(500).optional().default(''),
  defaultAttribution: z
    .string()
    .max(500)
    .optional()
    .transform((s) => (s && s.trim().length > 0 ? s.trim() : undefined)),
});

const promoteSchema = z.object({
  ids: z.string().min(1, 'paste at least one id'),
  reason: z.string().max(500).optional().default(''),
});

const attributionSchema = z.object({
  source: z.enum(['official_dictionary', 'curator']),
  oldAttribution: z.string().min(1).max(500),
  newAttribution: z
    .string()
    .max(500)
    .transform((s) => (s.trim().length === 0 ? null : s)),
  language: z
    .string()
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined)),
  clearAttribution: z.string().optional().transform((s) => s === 'true'),
  reason: z.string().max(500).optional().default(''),
});

/**
 * Parse a CSV-ish paste into structured rows. Splits each non-empty
 * line on tabs first, then commas if there's no tab. We deliberately
 * don't pull in a real CSV library — the tool is for curators pasting
 * spreadsheet selections, not arbitrary CSV with quoted commas.
 *
 * Expected column order:
 *   language, headword, pos, body[, targetLanguage, sourceAttribution]
 */
function parseCsv(text: string): BulkImportRow[] {
  const rows: BulkImportRow[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#')) continue;
    const fields = line.includes('\t') ? line.split('\t') : line.split(',');
    const [language, headword, pos, body, targetLanguage, sourceAttribution] = fields.map(
      (f) => f.trim(),
    );
    rows.push({
      language: language ?? '',
      headword: headword ?? '',
      pos: pos ?? '',
      body: body ?? '',
      ...(targetLanguage ? { targetLanguage } : {}),
      ...(sourceAttribution !== undefined && sourceAttribution !== ''
        ? { sourceAttribution }
        : {}),
    });
  }
  return rows;
}

function parseIds(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export const actions: Actions = {
  import: async ({ request, locals }) => {
    if (!locals.user) throw error(401, 'Unauthorized');
    const editor = { id: locals.user.id, role: locals.user.role };
    const form = Object.fromEntries(await request.formData());
    const parsed = importSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'import',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      } satisfies ImportResult);
    }
    const rows = parseCsv(parsed.data.csv);
    if (rows.length === 0) {
      return fail(400, {
        ok: false,
        section: 'import',
        message: 'No usable rows found',
      } satisfies ImportResult);
    }
    if (rows.length > BULK_LIMIT) {
      return fail(400, {
        ok: false,
        section: 'import',
        message: `Too many rows (cap is ${BULK_LIMIT})`,
      } satisfies ImportResult);
    }
    try {
      const result = await bulkImportTranslations(
        editor,
        rows,
        parsed.data.reason,
        parsed.data.defaultAttribution
          ? { sourceAttribution: parsed.data.defaultAttribution }
          : {},
      );
      return {
        ok: true,
        section: 'import',
        ...result,
      } satisfies ImportResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'import',
        message: mapped.message,
      } satisfies ImportResult);
    }
  },

  promote: async ({ request, locals }) => {
    if (!locals.user) throw error(401, 'Unauthorized');
    const editor = { id: locals.user.id, role: locals.user.role };
    const form = Object.fromEntries(await request.formData());
    const parsed = promoteSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'promote',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      } satisfies PromoteResult);
    }
    const all = parseIds(parsed.data.ids);
    const valid = all.filter((id) => UUID_RE.test(id));
    const invalid = all.filter((id) => !UUID_RE.test(id));
    if (valid.length === 0) {
      return fail(400, {
        ok: false,
        section: 'promote',
        message:
          invalid.length > 0
            ? `No valid UUIDs in the input (${invalid.length} non-uuid tokens skipped)`
            : 'No ids provided',
      } satisfies PromoteResult);
    }
    if (valid.length > BULK_LIMIT) {
      return fail(400, {
        ok: false,
        section: 'promote',
        message: `Too many ids (cap is ${BULK_LIMIT})`,
      } satisfies PromoteResult);
    }
    try {
      const result = await bulkPromoteTranslations(editor, valid, parsed.data.reason);
      return {
        ok: true,
        section: 'promote',
        ...result,
      } satisfies PromoteResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'promote',
        message: mapped.message,
      } satisfies PromoteResult);
    }
  },

  attribution: async ({ request, locals }) => {
    if (!locals.user) throw error(401, 'Unauthorized');
    const editor = { id: locals.user.id, role: locals.user.role };
    const form = Object.fromEntries(await request.formData());
    const parsed = attributionSchema.safeParse(form);
    if (!parsed.success) {
      return fail(400, {
        ok: false,
        section: 'attribution',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      } satisfies AttributionResult);
    }
    const language = parsed.data.language;
    if (language && !isSupportedLanguage(language)) {
      return fail(400, {
        ok: false,
        section: 'attribution',
        message: `Unsupported language: ${language}`,
      } satisfies AttributionResult);
    }
    try {
      const result = await bulkUpdateAttribution(
        editor,
        {
          source: parsed.data.source,
          oldAttribution: parsed.data.oldAttribution,
          newAttribution: parsed.data.clearAttribution
            ? null
            : parsed.data.newAttribution,
          language: language as LanguageCode | undefined,
        },
        parsed.data.reason,
      );
      return {
        ok: true,
        section: 'attribution',
        ...result,
      } satisfies AttributionResult;
    } catch (e) {
      const mapped = mapError(e);
      return fail(mapped.status, {
        ok: false,
        section: 'attribution',
        message: mapped.message,
      } satisfies AttributionResult);
    }
  },
};
