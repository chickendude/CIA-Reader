import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';

import WordPopup from './WordPopup.svelte';
import type { ServerToken, ServerNumberForms } from './types.js';

beforeAll(() => {
  // jsdom doesn't ship matchMedia; the popup uses it to switch between
  // mobile-sheet and desktop-static layouts. Stub a minimal "always
  // mobile" matcher so the $effect doesn't throw.
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }),
    });
  }
});

afterEach(() => {
  cleanup();
  // Belt + braces: clear any portaled popup the cleanup didn't.
  document.body
    .querySelectorAll('[data-testid="word-popup"], [data-testid="word-popup-empty"]')
    .forEach((el) => el.remove());
});

function makeNumberForms(): ServerNumberForms {
  return {
    value: 123,
    digitsLatin: '123',
    digitsDeva: '१२३',
    digitsOrya: '୧୨୩',
    hi: { spelled: 'एक सौ तेईस', romanized: 'ek sau teīs' },
    mr: { spelled: 'एकशे तेवीस', romanized: 'ēkaśē tēvīsa' },
    odia: { spelled: 'ଏକ ଶହ ତେଇଶ', romanized: 'ēka śaha tēiśa' },
  };
}

function makeToken(overrides: Partial<ServerToken> = {}): ServerToken {
  return {
    id: 't1',
    idx: 0,
    surface: '123',
    isWord: true,
    isAmbiguous: false,
    isOov: false,
    lemmaId: null,
    romanization: null,
    glossDefault: null,
    candidates: [],
    numberForms: null,
    status: 'unknown',
    ...overrides,
  };
}

describe('WordPopup — number-only token block (T-2.8)', () => {
  it('renders all three native-script digit forms', () => {
    render(WordPopup, {
      token: makeToken({ numberForms: makeNumberForms() }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
    });
    // Sheet portals to <body>, so query document.body rather than the
    // testing-library container.
    const block = document.body.querySelector('[data-testid="number-forms"]');
    expect(block).not.toBeNull();
    const digits = block!.querySelector('.num-digits')!.textContent ?? '';
    expect(digits).toContain('123');
    expect(digits).toContain('१२३');
    expect(digits).toContain('୧୨୩');
  });

  it('renders the spelled-out form + romanization for each MVP language', () => {
    render(WordPopup, {
      token: makeToken({ numberForms: makeNumberForms() }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
    });
    const langs = Array.from(
      document.body.querySelectorAll('.num-langs li'),
    ) as HTMLLIElement[];
    expect(langs).toHaveLength(3);
    const text = langs.map((li) => li.textContent ?? '').join('|');
    expect(text).toContain('Hindi');
    expect(text).toContain('एक सौ तेईस');
    expect(text).toContain('ek sau teīs');
    expect(text).toContain('Marathi');
    expect(text).toContain('एकशे तेवीस');
    expect(text).toContain('Odia');
    expect(text).toContain('ଏକ ଶହ ତେଇଶ');
  });

  it('hides the status / translations / fix affordances for number tokens', () => {
    // Pass a non-null lemmaId to force the number branch to suppress
    // the status group explicitly (rather than relying on the absent-
    // lemma path that already hides it).
    render(WordPopup, {
      token: makeToken({
        lemmaId: 'should-not-matter',
        numberForms: makeNumberForms(),
      }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
    });
    expect(document.body.querySelector('.sp-status')).toBeNull();
    expect(document.body.querySelector('.translations')).toBeNull();
    expect(document.body.querySelector('.add-toggle')).toBeNull();
    expect(document.body.querySelector('.fix-toggle')).toBeNull();
  });

  it('renders the existing lemma popup when numberForms is null', () => {
    render(WordPopup, {
      token: makeToken({ surface: 'पाठ', lemmaId: 'lem-1' }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
    });
    expect(
      document.body.querySelector('[data-testid="number-forms"]'),
    ).toBeNull();
    expect(
      document.body.querySelector('[data-testid="word-popup"]'),
    ).not.toBeNull();
  });
});
