import { error } from '@sveltejs/kit';
import { canEditDictionary } from '$lib/server/dictionary/permissions';
import { reviewBooks } from '$lib/server/texts/hindi-review';
import { getWorkshopWord } from './workshop';
import { z } from 'zod';
import type { User } from '$lib/server/db/schema';

import { getLanguage, isSupportedLanguage, type LanguageCode } from '@ciareader/shared-types';
import { dictionaryProfile } from '$lib/dictionary/profiles';
import { workshopAdapter } from './workshop-adapters';

export function workshopLanguage(code: string): LanguageCode {
  if (!isSupportedLanguage(code)) error(404, 'Unknown dictionary');
  return code;
}

export async function loadWorkshop(
  language: LanguageCode,
  user: Pick<User, 'id' | 'role'> | null,
  url: URL,
) {
  if (!user || !(await canEditDictionary(user, language)))
    error(403, 'Dictionary curator access required for this language');
  const id = url.searchParams.get('id');
  if (id && !z.string().uuid().safeParse(id).success) error(404, 'Entry not found');
  const adapter = workshopAdapter(language);
  const reports = adapter.listReports ? await adapter.listReports() : [];
  return {
    language: getLanguage(language),
    browse:
      dictionaryProfile(language).initialView !== 'review' ||
      url.searchParams.get('view') === 'entries',
    stutterReview: Boolean(adapter.reviewStutter),
    reports,
    books: await reviewBooks(user, language),
    initial: id ? await getWorkshopWord(id, language) : null,
    observed: url.searchParams.get('word')?.slice(0, 400) ?? '',
  };
}
