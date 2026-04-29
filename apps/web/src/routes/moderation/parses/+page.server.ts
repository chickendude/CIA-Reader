/**
 * Curator parse-reports moderation page (T-6.6).
 *
 * URL contract:
 *   /moderation/parses?language=hi&status=open&id=<report-uuid>
 *
 * Left pane is the filtered list (sorted by duplicate_count DESC,
 * then updated_at DESC); right pane is the selected report. The
 * selected-id is a URL param so a curator can paste a link and
 * land directly on a specific report.
 */
import { error } from '@sveltejs/kit';

import { listParseReports } from '$lib/server/parse-reports.js';
import { db, schema } from '$lib/server/db/index.js';
import { eq } from 'drizzle-orm';
import { isSupportedLanguage } from '@ciareader/shared-types';
import type { LanguageCode } from '@ciareader/shared-types';
import type { ParseReport } from '$lib/server/db/schema.js';
import type { PageServerLoad } from './$types';

const STATUSES = [
  'open',
  'triaged',
  'resolved',
  'rejected',
  'duplicate',
  'deferred',
] as const;

function readStatus(url: URL): ParseReport['status'] | null {
  const raw = url.searchParams.get('status');
  if (!raw) return 'open';
  return (STATUSES as readonly string[]).includes(raw)
    ? (raw as ParseReport['status'])
    : null;
}

export const load: PageServerLoad = async ({ url, parent }) => {
  const { moderator } = await parent();
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
  if (status === null) {
    throw error(400, `Unknown status; allowed: ${STATUSES.join(', ')}`);
  }

  const reports = await listParseReports({
    language: language ?? undefined,
    status,
    limit: 100,
  });

  // Right-pane selection. URL: ?id=<uuid>. Anything missing or
  // unknown falls back to the first listed report.
  const selectedIdParam = url.searchParams.get('id');
  let selected: ParseReport | null = null;
  if (selectedIdParam) {
    const [row] = (await db
      .select()
      .from(schema.parseReports)
      .where(eq(schema.parseReports.id, selectedIdParam))
      .limit(1)) as ParseReport[];
    if (row) selected = row;
  }
  if (!selected && reports.length > 0) selected = reports[0]!;

  return {
    moderator,
    filter: { language, status },
    reports,
    selected,
    statusOptions: STATUSES,
  };
};
