import { getLanguage } from '@ciareader/shared-types';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { canEditDictionary } from '$lib/server/dictionary/permissions.js';
import { loadWorkshop, workshopLanguage } from '$lib/server/dictionary/workshop-page';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, listDictionaryLemmas, publicLemma } from '$lib/server/dictionary/browse.js';
import { publicDictionaryEntry } from '$lib/server/dictionary/public-entry';
import type { PageServerLoad } from './$types';

function readInt(url: URL, key: string, fallback: number) {
  const n = Number.parseInt(url.searchParams.get(key) ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export const load: PageServerLoad = async ({ params, url, locals }) => {
  const code = workshopLanguage(params.language);
  const language = getLanguage(code);
  const user = locals?.user ?? null;
  const canEdit = await canEditDictionary(user, code);
  if (canEdit && url.searchParams.get('mode') !== 'public') {
    return { language, canEdit, staff: await loadWorkshop(code, user, url) };
  }

  const id = url.searchParams.get('id');
  if (id && !z.string().uuid().safeParse(id).success) error(404, 'Entry not found');
  const limit = Math.min(Math.max(readInt(url, 'limit', DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
  const offset = Math.max(readInt(url, 'offset', 0), 0);
  const q = url.searchParams.get('q');
  const pos = url.searchParams.getAll('pos');
  const result = await listDictionaryLemmas(code, { q, pos, limit, offset, matchEntryText: true });
  const selected = id || result.lemmas[0]?.id;
  return {
    language, canEdit, staff: null,
    entry: selected ? await publicDictionaryEntry(code, selected) : null,
    lemmas: result.lemmas.map(publicLemma),
    totalCount: result.totalCount, limit: result.limit, offset: result.offset,
    usedRomanizationTransliteration: result.usedRomanizationTransliteration,
    usedNuktaFallback: result.usedNuktaFallback, effectiveQuery: result.effectiveQuery,
    query: { q: q ?? '', pos },
  };
};
