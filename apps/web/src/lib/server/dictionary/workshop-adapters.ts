import type { LanguageCode } from '@ciareader/shared-types';
import type { ReportOption } from '$lib/dictionary/workshop';
import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { reviewHindiStutter } from '../texts/hindidb';
import { hindiReference, hindiWorkshopReport, previewHindiEntry } from './hindi-runtime';

interface WorkshopAdapter {
  preview?: typeof previewHindiEntry;
  phraseForms?: (entry: Record<string, unknown>) => Promise<{ forms: Record<string, string[]> }>;
  reference?: typeof hindiReference;
  report?: typeof hindiWorkshopReport;
  listReports?: () => Promise<ReportOption[]>;
  reviewStutter?: typeof reviewHindiStutter;
  searchSpelling?: (pattern: string) => SQL;
  archivePrefix?: string;
}

const adapters: Partial<Record<LanguageCode, WorkshopAdapter>> = {
  hi: {
    preview: previewHindiEntry,
    phraseForms: (entry) => previewHindiEntry(entry, { phrase_candidates: true }),
    reference: hindiReference,
    report: hindiWorkshopReport,
    listReports: async () => {
      const rows = await db.execute<{ name: string }>(
        sql`SELECT substr(key,8) name FROM hindi_reference_cache WHERE key LIKE 'report:%' ORDER BY key DESC`,
      );
      return [
        { name: 'spellings', label: 'Merge spelling variants', action: 'merge' },
        ...rows
          .filter((r) => r.name !== 'spellings')
          .map(({ name }) => ({ name, label: name, action: 'delete' as const })),
      ];
    },
    reviewStutter: reviewHindiStutter,
    searchSpelling: (pattern) =>
      sql`l.headword_nukta_stripped ILIKE translate(normalize(${pattern},NFD),'़','')`,
    // Older Hindi imports used bare cache keys.
    archivePrefix: '',
  },
};

export function workshopAdapter(language: LanguageCode): WorkshopAdapter {
  return adapters[language] ?? {};
}

export function archiveKey(language: LanguageCode, key: string) {
  return (workshopAdapter(language).archivePrefix ?? language + ':') + key;
}
