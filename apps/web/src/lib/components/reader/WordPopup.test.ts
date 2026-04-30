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
  it.each([
    ['hi', 'Hindi', '१२३', 'एक सौ तेईस', 'ek sau teīs'],
    ['mr', 'Marathi', '१२३', 'एकशे तेवीस', 'ēkaśē tēvīsa'],
    ['or', 'Odia', '୧୨୩', 'ଏକ ଶହ ତେଇଶ', 'ēka śaha tēiśa'],
  ] as const)(
    'renders only the %s number forms with Latin + native digits',
    (language, label, nativeDigits, spelled, romanized) => {
      render(WordPopup, {
        token: makeToken({ numberForms: makeNumberForms() }),
        language,
        isOwner: true,
        onClose: vi.fn(),
      });
      // Sheet portals to <body>, so query document.body rather than the
      // testing-library container.
      const heading = document.body.querySelector('.num-title');
      expect(heading?.textContent).toContain('123');
      expect(heading?.textContent).toContain(nativeDigits);
      expect(heading?.textContent).not.toContain(
        language === 'or' ? '१२३' : '୧୨୩',
      );

      const block = document.body.querySelector('[data-testid="number-forms"]');
      expect(block).not.toBeNull();
      const entries = document.body.querySelectorAll('.num-entry');
      expect(entries).toHaveLength(1);
      const text = block!.textContent ?? '';
      expect(text).toContain(label);
      expect(text).toContain(spelled);
      expect(text).toContain(romanized);
      if (language !== 'hi') expect(text).not.toContain('एक सौ तेईस');
      if (language !== 'mr') expect(text).not.toContain('एकशे तेवीस');
      if (language !== 'or') expect(text).not.toContain('ଏକ ଶହ ତେଇଶ');
    },
  );

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

describe('WordPopup — translation reporting (T-11.1)', () => {
  function makePayload() {
    return {
      lemma: { id: 'lem-1', headword: 'पानी', pos: 'NOUN', glossDefault: null },
      translations: {
        personal: [],
        official: [],
        community: [
          {
            id: 'tr-com-1',
            source: 'user',
            submittedBy: 'someone-else',
            body: 'wrong',
            targetLanguage: 'en',
            sourceAttribution: null,
            parentTranslationId: null,
            provenance: { kind: 'community', attribution: null },
            voteScore: 0,
            viewerVote: null,
          },
        ],
      },
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a Report button on each community row when isOwner=true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(makePayload()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    render(WordPopup, {
      token: makeToken({ surface: 'पानी', lemmaId: 'lem-1' }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
    });
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    const reportBtn = document.body.querySelector('[data-testid="report-button"]');
    expect(reportBtn).not.toBeNull();
  });

  it('hides the Report button when isOwner=false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(makePayload()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    render(WordPopup, {
      token: makeToken({ surface: 'पानी', lemmaId: 'lem-1' }),
      language: 'hi',
      isOwner: false,
      onClose: vi.fn(),
    });
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    expect(
      document.body.querySelector('[data-testid="report-button"]'),
    ).toBeNull();
  });
});
