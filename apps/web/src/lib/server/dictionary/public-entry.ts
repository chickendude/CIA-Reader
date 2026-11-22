import { error } from '@sveltejs/kit';
import type { LanguageCode } from '@ciareader/shared-types';
import { sql } from 'drizzle-orm';
import { splitMeanings } from '$lib/dictionary/meanings';
import { db } from '../db/index.js';
import { getLemmaTranslations, LemmaNotFoundError } from './lookups.js';

export async function publicDictionaryEntry(language: LanguageCode, id: string) {
  const result = await getLemmaTranslations(id, null).catch((cause: unknown) => {
    if (cause instanceof LemmaNotFoundError) error(404, 'Dictionary entry not found');
    throw cause;
  });
  if (result.lemma.language !== language) error(404, 'Dictionary entry not found');
  const [details] = await db.execute<{ paradigm: string | null; forms: string[] }>(sql`
    SELECT e.entry->>'paradigm' AS paradigm, ARRAY(
      SELECT surface FROM (
        SELECT f.surface FROM lemma_forms f WHERE f.lemma_id=l.id AND f.quarantined_at IS NULL
        UNION SELECT f.surface FROM dictionary_pattern_forms f WHERE f.lemma_id=l.id
      ) spellings WHERE surface<>l.headword
        AND NOT coalesce(e.entry->'alternative_headwords','[]') ? surface
        AND NOT coalesce(e.entry->'excluded_forms','[]') ? surface
      ORDER BY surface
    ) AS forms FROM lemmas l LEFT JOIN dictionary_entries e ON e.lemma_id=l.id WHERE l.id=${id}`);
  const definitions = [...result.translations.official, ...result.translations.community]
    .map(({ body, targetLanguage, sourceAttribution }) => ({ body, targetLanguage, sourceAttribution }));
  const gloss = result.lemma.glossDefault;
  if (gloss && !definitions.some((d) => d.body === gloss) &&
    result.translations.official.filter((d) => d.targetLanguage === 'en').map((d) => d.body).join('; ') !== gloss) {
    definitions.unshift({ body: gloss, targetLanguage: 'en', sourceAttribution: null });
  }
  return {
    ...result.lemma, forms: details?.forms ?? [], paradigm: details?.paradigm ?? null,
    meanings: definitions.flatMap(({ body, targetLanguage, sourceAttribution }) =>
      splitMeanings(body).map((text, index, senses) => ({
        text, targetLanguage, sourceAttribution: index === senses.length - 1 ? sourceAttribution : null,
      })),
    ),
  };
}
