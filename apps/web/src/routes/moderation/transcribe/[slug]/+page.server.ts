/**
 * Transcription queue for one dictionary.
 *
 * Lists unverified draft entries in printed-page order, shows open
 * issues, and hosts the calibration quick-check: `?page=N` renders the
 * scan page resolved for printed page N so a wrong `--page-offset`
 * shows up immediately.
 */
import { error, fail } from '@sveltejs/kit';

import {
  countTranscriptionProgress,
  listTranscriptionQueue,
  resolveScanPage,
  resolveTranscriptionIssue,
} from '$lib/server/dictionary/transcribe.js';
import { CuratorValidationError } from '$lib/server/dictionary/curator.js';
import { ForbiddenError } from '$lib/server/dictionary/permissions.js';
import { getPdfStorage } from '$lib/server/pdf/storage.js';
import { findScanDictionary } from '$lib/server/scans/registry.js';
import { db, schema } from '$lib/server/db/index.js';
import { and, desc, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
  const config = findScanDictionary(params.slug);
  if (!config) throw error(404, 'Unknown dictionary');

  const fromParam = url.searchParams.get('from');
  const from = fromParam ? Number(fromParam) : undefined;
  const queue = await listTranscriptionQueue(config, {
    fromPrintedPage: Number.isFinite(from) ? from : undefined,
    limit: 50,
  });
  const progress = await countTranscriptionProgress(config);

  const issues = await db
    .select()
    .from(schema.transcriptionIssues)
    .where(
      and(
        eq(schema.transcriptionIssues.dictionarySlug, config.slug),
        eq(schema.transcriptionIssues.status, 'open'),
      ),
    )
    .orderBy(desc(schema.transcriptionIssues.createdAt))
    .limit(20);

  // Calibration quick-check.
  const pageParam = url.searchParams.get('page');
  let calibration: { printedPage: number; imageUrl: string | null } | null = null;
  if (pageParam) {
    const printedPage = Number(pageParam);
    if (Number.isInteger(printedPage) && printedPage > 0) {
      const page = await resolveScanPage(config.slug, printedPage);
      calibration = {
        printedPage,
        imageUrl: page ? getPdfStorage().urlFor(page.imageKey) : null,
      };
    }
  }

  return {
    slug: config.slug,
    citation: config.citation,
    queue,
    progress,
    issues,
    calibration,
  };
};

export const actions: Actions = {
  resolveIssue: async ({ locals, request }) => {
    const user = locals.user!;
    const form = await request.formData();
    const issueId = String(form.get('issueId') ?? '');
    try {
      await resolveTranscriptionIssue(user, issueId);
      return { ok: true as const };
    } catch (e) {
      if (e instanceof CuratorValidationError) {
        return fail(e.status, { ok: false as const, message: e.message });
      }
      if (e instanceof ForbiddenError) {
        return fail(403, { ok: false as const, message: e.message });
      }
      throw e;
    }
  },
};
