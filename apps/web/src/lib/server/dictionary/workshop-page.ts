import { error } from '@sveltejs/kit';
import { canEditDictionary } from '$lib/server/dictionary/permissions';
import { reviewBooks } from '$lib/server/texts/hindi-review';
import { OPENAI_API_KEY } from '$lib/server/env';
import { getWorkshopWord } from '$lib/server/dictionary/hindi-workshop';
import { db } from '$lib/server/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { User } from '$lib/server/db/schema';

export async function loadHindiWorkshop(
  user: Pick<User, 'id' | 'role'> | null,
  url: URL,
  reviewOnly = false,
) {
  if (!user || !(await canEditDictionary(user, 'hi'))) error(403, 'Hindi curator access required');
  const id = reviewOnly ? null : url.searchParams.get('id');
  if (id && !z.string().uuid().safeParse(id).success) error(404, 'Entry not found');
  const reports = reviewOnly
    ? []
    : await db.execute<{ name: string }>(
        sql`SELECT substr(key,8) name FROM hindi_reference_cache WHERE key LIKE 'report:%' ORDER BY key DESC`,
      );
  return {
    browse: url.searchParams.get('view') === 'entries',
    reports: reports.map((r) => r.name),
    books: await reviewBooks(user),
    ai: Boolean(OPENAI_API_KEY),
    initial: id ? await getWorkshopWord(id) : null,
    observed: url.searchParams.get('word')?.slice(0, 400) ?? '',
  };
}
