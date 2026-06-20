// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  definitionLanguageName,
  parseHiddenDefinitionLanguages,
  serializeHiddenDefinitionLanguages,
} from './definition-languages.js';

describe('definitionLanguageName', () => {
  it('names the gloss-only languages not in the reading registry', () => {
    expect(definitionLanguageName('en')).toBe('English');
    expect(definitionLanguageName('es')).toBe('Spanish');
    expect(definitionLanguageName('eu')).toBe('Euskara');
  });

  it('falls back to the uppercased code for an unknown language', () => {
    expect(definitionLanguageName('fr')).toBe('FR');
  });
});

describe('parseHiddenDefinitionLanguages', () => {
  it('round-trips through serialize', () => {
    const set = new Set(['en', 'es']);
    const restored = parseHiddenDefinitionLanguages(
      serializeHiddenDefinitionLanguages(set),
    );
    expect([...restored].sort()).toEqual(['en', 'es']);
  });

  it('returns an empty set for null / malformed / non-array values', () => {
    expect(parseHiddenDefinitionLanguages(null).size).toBe(0);
    expect(parseHiddenDefinitionLanguages('not json').size).toBe(0);
    expect(parseHiddenDefinitionLanguages('{"a":1}').size).toBe(0);
  });

  it('drops non-string members defensively', () => {
    expect([...parseHiddenDefinitionLanguages('["en",1,null,"es"]')].sort()).toEqual([
      'en',
      'es',
    ]);
  });
});
