import { expect, it } from 'vitest';
import { dictionaryProfile, savedFormProfile } from './profiles';

it('lets a language supply a pattern and review slots', () => {
  const profile = savedFormProfile([
    {
      id: 'locative',
      label: 'Singular locative',
      applies: (lemma, pos) => pos === 'NOUN' && lemma.endsWith('e'),
      forms: (lemma) => [lemma + 'an'],
      slots: (lemma) => [{ id: 'loc-sg', label: 'Singular locative', forms: [lemma + 'an'] }],
    },
  ]);
  expect(profile.patterns('etxe', 'NOUN', '').map((p) => p.id)).toEqual(['invariant', 'locative']);
  expect(profile.generate('etxe', 'NOUN', 'locative')).toEqual(['etxean']);
  expect(profile.inventory('etxe', 'NOUN', 'locative').slots).toMatchObject([
    { id: 'loc-sg', forms: ['etxean'], include: false },
  ]);
  expect(profile.patterns('egin', 'VERB', '').map((p) => p.id)).toEqual(['invariant']);
  expect(
    dictionaryProfile('mr')
      .patterns('घर', 'NOUN', '')
      .map((p) => p.id),
  ).toEqual(['invariant']);
});
