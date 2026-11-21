// @vitest-environment node
import { expect, it } from 'vitest';
import { previewHindiEntry } from './hindi-runtime';

const noun = { lemma: 'घर', pos: 'NOUN', paradigm: 'noun_m_consonant' };

it('generates forms and all six noun slots directly from HindiDB', async () => {
  const result = await previewHindiEntry(noun, { inventory: true, include_slots: true });
  expect(result.forms).toHaveProperty('घरों');
  expect(result.inventory?.slots).toHaveLength(6);
  expect(result.slots).toContainEqual(expect.objectContaining({ forms: ['घरों'] }));
});

it('returns a dictionary validation error for an incompatible inventory', async () => {
  const entry = { ...noun, form_inventory: { version: 'old' } };
  await expect(previewHindiEntry(entry, { validate_inventory: true })).rejects.toMatchObject({
    status: 400,
    message: 'Unsupported form inventory version',
  });
});

it('declines both spellings of क़ब्ज़ा in the preview and the same grammatical slots', async () => {
  const entry = {
    lemma: 'क़ब्ज़ा',
    pos: 'NOUN',
    paradigm: 'noun_m_aa',
    alternative_headwords: ['कब्जा', 'qabza'],
  };
  const result = await previewHindiEntry(entry, { include_slots: true });
  expect(Object.keys(result.forms).sort()).toEqual([
    'क़ब्ज़ा', 'क़ब्ज़े', 'क़ब्ज़ों', 'क़ब्ज़ो', 'कब्जा', 'कब्जे', 'कब्जों', 'कब्जो', 'qabza',
  ].sort());
  expect(result.slots).toContainEqual({
    label: 'Plural, oblique',
    forms: ['कब्जों', 'क़ब्ज़ों'],
  });
  expect(result.forms['कब्जे']).toContain('noun_m_aa');
  const excluded = await previewHindiEntry({ ...entry, excluded_forms: ['कब्जे'] });
  expect(excluded.forms['कब्जे']).toBeUndefined();
  expect(excluded.forms['क़ब्ज़े']).toContain('noun_m_aa');
});
