import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';

import TokenSpan from './TokenSpan.svelte';
import type { ServerToken } from './types.js';

function makeToken(overrides: Partial<ServerToken> = {}): ServerToken {
  return {
    id: 't1',
    idx: 0,
    surface: 'पानी',
    isWord: true,
    isAmbiguous: false,
    isOov: false,
    lemmaId: 'lem-1',
    romanization: null,
    glossDefault: 'water',
    personalGloss: null,
    candidates: [],
    features: {},
    numberForms: null,
    status: 'unknown',
    hasDefinition: true,
    ...overrides,
  };
}

afterEach(() => cleanup());

describe('TokenSpan — no-definition class (#435)', () => {
  it('tags a word as .no-definition when hasDefinition is false', () => {
    const { container } = render(TokenSpan, {
      token: makeToken({ hasDefinition: false }),
    });
    const word = container.querySelector('.word');
    expect(word).not.toBeNull();
    expect(word!.classList.contains('no-definition')).toBe(true);
  });

  it('does not tag a defined word', () => {
    const { container } = render(TokenSpan, {
      token: makeToken({ hasDefinition: true }),
    });
    expect(
      container.querySelector('.word')!.classList.contains('no-definition'),
    ).toBe(false);
  });

  it('does not tag when hasDefinition is absent (client-fallback tokens)', () => {
    const token = makeToken();
    delete token.hasDefinition;
    const { container } = render(TokenSpan, { token });
    expect(
      container.querySelector('.word')!.classList.contains('no-definition'),
    ).toBe(false);
  });

  it('tags an undefined OOV word alongside the .oov class', () => {
    const { container } = render(TokenSpan, {
      token: makeToken({ isOov: true, lemmaId: null, hasDefinition: false }),
    });
    const word = container.querySelector('.word')!;
    expect(word.classList.contains('oov')).toBe(true);
    expect(word.classList.contains('no-definition')).toBe(true);
  });

  it('never tags whitespace / non-word tokens', () => {
    const { container } = render(TokenSpan, {
      token: makeToken({
        isWord: false,
        surface: ' ',
        hasDefinition: false,
      }),
    });
    // Non-word tokens render as bare text, no .word span at all.
    expect(container.querySelector('.no-definition')).toBeNull();
  });

  it('tags the undefined word in <ruby> render mode too', () => {
    const { container } = render(TokenSpan, {
      token: makeToken({ hasDefinition: false, romanization: 'pānī' }),
      showRomanization: true,
    });
    const ruby = container.querySelector('ruby.word');
    expect(ruby).not.toBeNull();
    expect(ruby!.classList.contains('no-definition')).toBe(true);
  });
});
