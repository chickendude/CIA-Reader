import { sql } from 'drizzle-orm';
import type { db } from '../db/index.js';

export async function replacePatternForms(
  tx: Pick<typeof db, 'execute'>,
  lemmaId: string,
  forms: Record<string, string[]>,
) {
  const generated = Object.entries(forms)
    .filter(([, rules]) => rules.some((rule) => rule !== 'citation' && rule !== 'explicit-form'))
    .map(([surface]) => surface);
  await tx.execute(sql`DELETE FROM dictionary_pattern_forms WHERE lemma_id=${lemmaId}`);
  await tx.execute(sql`INSERT INTO dictionary_pattern_forms(lemma_id,surface)
    SELECT ${lemmaId}, value FROM jsonb_array_elements_text(${JSON.stringify(generated)}::text::jsonb)`);
}
