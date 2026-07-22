/**
 * Transcription workbench — dictionary picker.
 *
 * One card per scan-backed dictionary the viewer can edit, with
 * verification progress and ingested-volume info. The calibration
 * quick-check ("view printed page N") lives on the per-dictionary
 * queue page (`?page=N`).
 */
import { asc, eq } from 'drizzle-orm';

import { db, schema } from '$lib/server/db/index.js';
import {
  countTranscriptionProgress,
} from '$lib/server/dictionary/transcribe.js';
import { isAdmin, listGrantedLanguages } from '$lib/server/dictionary/permissions.js';
import { SCAN_DICTIONARIES } from '$lib/server/scans/registry.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user!;
  const granted = isAdmin(user) ? null : new Set(await listGrantedLanguages(user));

  const dictionaries = [];
  for (const config of Object.values(SCAN_DICTIONARIES)) {
    if (granted && !granted.has(config.language)) continue;
    const progress = await countTranscriptionProgress(config);
    const volumes = await db
      .select({
        volumeNumber: schema.scanVolumes.volumeNumber,
        pageCount: schema.scanVolumes.pageCount,
        printedPageStart: schema.scanVolumes.printedPageStart,
        printedPageEnd: schema.scanVolumes.printedPageEnd,
      })
      .from(schema.scanVolumes)
      .where(eq(schema.scanVolumes.dictionarySlug, config.slug))
      .orderBy(asc(schema.scanVolumes.volumeNumber));
    dictionaries.push({
      slug: config.slug,
      citation: config.citation,
      language: config.language,
      progress,
      volumes,
    });
  }

  return { dictionaries };
};
