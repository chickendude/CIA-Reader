/**
 * The transcription workbench entry view.
 *
 * Loader: draft lemma + senses, the scan page it should sit on (saved
 * ref wins; else the printed page from the source_id; `?page=N`
 * re-points manually), the page's cached raw OCR (run on first open —
 * failures degrade to a warning, never a 500), a crop proposal when no
 * ref exists yet, and prev/next unverified navigation.
 *
 * Actions mirror the moderation editor's form-action pattern: `verify`
 * publishes via the service layer and advances to the next entry;
 * `flag` opens a transcription issue; `createEntry` adds an entry the
 * draft import missed.
 */
import { error, fail, redirect } from '@sveltejs/kit';

import {
  configForLemma,
  drizzleTranscribeRepo,
  listTranscriptionQueue,
  printedPageFromSourceId,
  resolveScanPage,
  openTranscriptionIssue,
  verifyTranscription,
} from '$lib/server/dictionary/transcribe.js';
import { CuratorValidationError, createLemma } from '$lib/server/dictionary/curator.js';
import { ForbiddenError } from '$lib/server/dictionary/permissions.js';
import { ensureScanPageOcr } from '$lib/server/scans/ocr.js';
import { proposeCrop } from '$lib/server/scans/locate.js';
import { getPdfStorage } from '$lib/server/pdf/storage.js';
import { findScanDictionary } from '$lib/server/scans/registry.js';
import { db, schema } from '$lib/server/db/index.js';
import { and, eq, like } from 'drizzle-orm';
import type { ScanCrop, ScanPage } from '$lib/server/db/schema.js';
import type { Actions, PageServerLoad } from './$types';

function mapActionError(e: unknown): { status: number; message: string } | null {
  if (e instanceof CuratorValidationError) return { status: e.status, message: e.message };
  if (e instanceof ForbiddenError) return { status: 403, message: e.message };
  return null;
}

export const load: PageServerLoad = async ({ params, url }) => {
  const config = findScanDictionary(params.slug);
  if (!config) throw error(404, 'Unknown dictionary');

  const lemma = await drizzleTranscribeRepo.loadLemma(params.lemmaId);
  if (!lemma || configForLemma(lemma)?.slug !== config.slug) {
    throw error(404, 'Entry not found in this dictionary');
  }
  const senses = await drizzleTranscribeRepo.loadOfficialTranslations(lemma.id);

  const [ref] = await db
    .select()
    .from(schema.lemmaScanRefs)
    .where(eq(schema.lemmaScanRefs.lemmaId, lemma.id))
    .limit(1);

  // Page resolution: manual ?page override > saved ref > source_id.
  const pageParam = Number(url.searchParams.get('page'));
  let scanPage: ScanPage | null = null;
  if (Number.isInteger(pageParam) && pageParam > 0) {
    scanPage = await resolveScanPage(config.slug, pageParam);
  } else if (ref) {
    scanPage = await drizzleTranscribeRepo.loadScanPage(ref.scanPageId);
  } else {
    const printed = printedPageFromSourceId(lemma.sourceId);
    if (printed !== null) scanPage = await resolveScanPage(config.slug, printed);
  }

  let ocrWarning: string | null = null;
  if (scanPage) {
    try {
      scanPage = await ensureScanPageOcr(scanPage.id);
    } catch {
      ocrWarning = 'OCR failed for this page — it will be retried on next open.';
    }
  }

  const savedCrop = (ref?.crop as ScanCrop | undefined) ?? null;
  const proposal =
    !savedCrop && scanPage?.ocrStatus === 'ok'
      ? proposeCrop(scanPage.ocrWords, {
          senseBodies: senses.map((s) => s.body),
        })
      : null;

  // Prev/next unverified in printed-page order.
  const printed = printedPageFromSourceId(lemma.sourceId);
  const around = await listTranscriptionQueue(config, {
    fromPrintedPage: printed !== null ? Math.max(1, printed - 1) : undefined,
    limit: 100,
  });
  const idx = around.findIndex((e) => e.lemmaId === lemma.id);
  const nextId =
    idx >= 0 ? (around[idx + 1]?.lemmaId ?? null) : (around[0]?.lemmaId ?? null);
  const prevId = idx > 0 ? around[idx - 1]!.lemmaId : null;

  return {
    slug: config.slug,
    citation: config.citation,
    language: config.language,
    script: config.script,
    lemma: {
      id: lemma.id,
      headword: lemma.headword,
      pos: lemma.pos,
      glossDefault: lemma.glossDefault,
      sourceId: lemma.sourceId,
      sourceAttribution: lemma.sourceAttribution,
      curatorLocked: lemma.curatorLocked,
    },
    senses: senses.map((s) => ({
      id: s.id,
      body: s.body,
      targetLanguage: s.targetLanguage,
    })),
    scanPage: scanPage
      ? {
          id: scanPage.id,
          printedPage: scanPage.printedPage,
          imageUrl: getPdfStorage().urlFor(scanPage.imageKey),
          width: scanPage.width,
          height: scanPage.height,
          ocrStatus: scanPage.ocrStatus,
          ocrText: scanPage.ocrText,
        }
      : null,
    savedCrop,
    proposal,
    ocrWarning,
    prevId,
    nextId,
  };
};

/** Shared parse of the workbench form's sense rows. */
function sensesFromForm(form: FormData): Array<{
  translationId?: string;
  body: string;
  targetLanguage?: string;
}> {
  const senses = [];
  const count = Number(form.get('senseCount') ?? 0);
  for (let i = 0; i < count; i += 1) {
    const body = String(form.get(`sense-${i}-body`) ?? '');
    if (!body.trim()) continue;
    const translationId = String(form.get(`sense-${i}-id`) ?? '');
    const targetLanguage = String(form.get(`sense-${i}-lang`) ?? 'en');
    senses.push({
      ...(translationId ? { translationId } : {}),
      body,
      targetLanguage,
    });
  }
  return senses;
}

export const actions: Actions = {
  verify: async ({ locals, params, request }) => {
    const user = locals.user!;
    const form = await request.formData();
    const crop: ScanCrop = {
      x: Number(form.get('crop-x')),
      y: Number(form.get('crop-y')),
      w: Number(form.get('crop-w')),
      h: Number(form.get('crop-h')),
    };
    try {
      await verifyTranscription(
        user,
        params.lemmaId,
        {
          headword: String(form.get('headword') ?? ''),
          pos: String(form.get('pos') ?? ''),
          senses: sensesFromForm(form),
          scanPageId: String(form.get('scanPageId') ?? ''),
          crop,
        },
        String(form.get('reason') ?? ''),
      );
    } catch (e) {
      const mapped = mapActionError(e);
      if (mapped) {
        return fail(mapped.status, { ok: false as const, message: mapped.message });
      }
      throw e;
    }
    const nextId = String(form.get('nextId') ?? '');
    throw redirect(
      303,
      nextId
        ? `/moderation/transcribe/${params.slug}/${nextId}`
        : `/moderation/transcribe/${params.slug}`,
    );
  },

  flag: async ({ locals, params, request }) => {
    const user = locals.user!;
    const form = await request.formData();
    try {
      await openTranscriptionIssue(user, {
        dictionarySlug: params.slug,
        lemmaId: params.lemmaId,
        scanPageId: String(form.get('scanPageId') ?? '') || undefined,
        note: String(form.get('note') ?? ''),
      });
    } catch (e) {
      const mapped = mapActionError(e);
      if (mapped) {
        return fail(mapped.status, { ok: false as const, message: mapped.message });
      }
      throw e;
    }
    const nextId = String(form.get('nextId') ?? '');
    throw redirect(
      303,
      nextId
        ? `/moderation/transcribe/${params.slug}/${nextId}`
        : `/moderation/transcribe/${params.slug}`,
    );
  },

  createEntry: async ({ locals, params, request }) => {
    const user = locals.user!;
    const config = findScanDictionary(params.slug);
    if (!config) throw error(404, 'Unknown dictionary');
    const form = await request.formData();
    const printedPage = Number(form.get('printedPage'));
    if (!Number.isInteger(printedPage) || printedPage < 1) {
      return fail(400, { ok: false as const, message: 'printed page required' });
    }
    // Next free ordinal under the created-entry prefix for this page.
    // Single-curator tool: a racing duplicate ordinal is acceptable and
    // harmless (source ids stay unique enough for audit purposes).
    const prefix = `${config.createdSourceIdPrefix}${printedPage}:`;
    const existing = await db
      .select({ id: schema.lemmas.id })
      .from(schema.lemmas)
      .where(
        and(
          eq(schema.lemmas.language, config.language),
          like(schema.lemmas.sourceId, `${prefix}%`),
        ),
      );
    try {
      const lemma = await createLemma(
        user,
        {
          language: config.language,
          headword: String(form.get('headword') ?? ''),
          pos: String(form.get('pos') ?? 'X'),
          script: config.script,
          sourceAttribution: `${config.citation}, via CIA Reader transcription`,
          sourceId: `${prefix}${existing.length}`,
          translations: String(form.get('body') ?? '')
            .split('\n')
            .map((b) => b.trim())
            .filter(Boolean)
            .map((body) => ({ body })),
        },
        String(form.get('reason') ?? 'workbench create'),
      );
      throw redirect(303, `/moderation/transcribe/${params.slug}/${lemma.id}`);
    } catch (e) {
      const mapped = mapActionError(e);
      if (mapped) {
        return fail(mapped.status, { ok: false as const, message: mapped.message });
      }
      throw e;
    }
  },
};
