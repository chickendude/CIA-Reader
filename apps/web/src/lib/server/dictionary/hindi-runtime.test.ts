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
