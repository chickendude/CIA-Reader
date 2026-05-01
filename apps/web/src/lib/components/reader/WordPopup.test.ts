import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';

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

function makeNumberForms(
  overrides: Partial<ServerNumberForms> = {},
): ServerNumberForms {
  return {
    value: '123',
    digitsLatin: '123',
    digitsDeva: '१२३',
    digitsOrya: '୧୨୩',
    hi: { spelled: 'एक सौ तेईस', romanized: 'ek sau teīs' },
    mr: { spelled: 'एकशे तेवीस', romanized: 'ēkaśē tēvīsa' },
    odia: { spelled: 'ଏକ ଶହ ତେଇଶ', romanized: 'ēka śaha tēiśa' },
    ...overrides,
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

  it('renders a negative + decimal value end-to-end (T-2.8a)', () => {
    // The Python parser emits the canonical sign + decimal in
    // digitsLatin / digitsDeva / digitsOrya, and the spelled-out
    // form already includes the language minus / point words. The
    // popup template just renders strings, so a `-3.14` token shows
    // the signed/decimal Latin digits in the heading and the
    // "ऋण ... दशमलव ..." spelled-out block in the body.
    render(WordPopup, {
      token: makeToken({
        surface: '-3.14',
        numberForms: makeNumberForms({
          value: '-3.14',
          digitsLatin: '-3.14',
          digitsDeva: '-३.१४',
          digitsOrya: '-୩.୧୪',
          hi: {
            spelled: 'ऋण तीन दशमलव एक चार',
            romanized: 'r̥ṇ tīn daśamlav ek cār',
          },
          mr: {
            spelled: 'उणे तीन दशांश एक चार',
            romanized: 'uṇē tīna daśāṁśa ēka cāra',
          },
          odia: {
            spelled: 'ଋଣ ତିନି ଦଶମିକ ଏକ ଚାରି',
            romanized: 'r̥ṇa tini daśamika ēka cāri',
          },
        }),
      }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
    });
    const heading = document.body.querySelector('.num-title');
    // Latin + native digits both carry the sign + decimal point.
    expect(heading?.textContent).toContain('-3.14');
    expect(heading?.textContent).toContain('-३.१४');
    const block = document.body.querySelector('[data-testid="number-forms"]');
    expect(block?.textContent).toContain('ऋण');
    expect(block?.textContent).toContain('दशमलव');
    expect(block?.textContent).toContain('ऋण तीन दशमलव एक चार');
  });

  it('shows a reprocess hint for legacy number tokens whose numberForms column is null', () => {
    // Pre-#340 chapter: the dispatcher auto-created a "1,013,322 / NUM"
    // lemma row, so lemmaId is set. The popup must NOT render that
    // bogus lemma block; it must show the reprocess hint instead.
    render(WordPopup, {
      token: makeToken({
        surface: '1,013,322',
        lemmaId: 'auto-created-lem',
        numberForms: null,
      }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
    });
    expect(
      document.body.querySelector('[data-testid="number-needs-reprocess"]'),
    ).not.toBeNull();
    // No misleading "Lemma 1,013,322" / status / translations / Fix.
    expect(document.body.querySelector('.sp-row')).toBeNull();
    expect(document.body.querySelector('.sp-status')).toBeNull();
    expect(document.body.querySelector('.translations')).toBeNull();
    expect(document.body.querySelector('.fix-toggle')).toBeNull();
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
    await waitFor(() => {
      expect(
        document.body.querySelector('[data-testid="report-button"]'),
      ).not.toBeNull();
    });
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
    // Wait for the popup payload to render so we know fetch has resolved.
    await waitFor(() => {
      expect(document.body.querySelector('.community-row')).not.toBeNull();
    });
    expect(
      document.body.querySelector('[data-testid="report-button"]'),
    ).toBeNull();
  });
});

describe('WordPopup — add-translation form (no buttons, focus, refetch)', () => {
  function emptyPayload() {
    return {
      lemma: { id: 'lem-1', headword: 'पानी', pos: 'NOUN', glossDefault: null },
      translations: { personal: [], official: [], community: [] },
    };
  }

  function payloadWith(personal: { id: string; body: string }[]) {
    return {
      lemma: { id: 'lem-1', headword: 'पानी', pos: 'NOUN', glossDefault: null },
      translations: {
        personal: personal.map((p) => ({
          id: p.id,
          source: 'user',
          submittedBy: 'me',
          body: p.body,
          targetLanguage: 'en',
          sourceAttribution: null,
          parentTranslationId: null,
          provenance: { kind: 'personal', attribution: null },
          voteScore: 0,
          viewerVote: null,
        })),
        official: [],
        community: [],
      },
    };
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('focuses the textarea as soon as "+ Add my translation" is clicked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(emptyPayload())),
    );
    render(WordPopup, {
      token: makeToken({ surface: 'पानी', lemmaId: 'lem-1' }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
    });
    const toggle = await waitFor(() => {
      const el = document.body.querySelector<HTMLButtonElement>('.add-toggle');
      if (!el) throw new Error('add-toggle missing');
      return el;
    });
    toggle.click();
    await waitFor(() => {
      const textarea = document.body.querySelector<HTMLTextAreaElement>(
        '.add-form textarea',
      );
      expect(textarea).not.toBeNull();
      expect(document.activeElement).toBe(textarea);
    });
  });

  it('does not render any Save/Cancel buttons inside the add-translation form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(emptyPayload())),
    );
    render(WordPopup, {
      token: makeToken({ surface: 'पानी', lemmaId: 'lem-1' }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
    });
    const toggle = await waitFor(() => {
      const el = document.body.querySelector<HTMLButtonElement>('.add-toggle');
      if (!el) throw new Error('add-toggle missing');
      return el;
    });
    toggle.click();
    const form = await waitFor(() => {
      const el = document.body.querySelector<HTMLFormElement>('.add-form');
      if (!el) throw new Error('add-form missing');
      return el;
    });
    expect(form.querySelector('button')).toBeNull();
  });

  it('shows the newly-added translation in the popup after Enter submits', async () => {
    const fetchMock = vi
      .fn()
      // initial GET — empty payload
      .mockResolvedValueOnce(jsonResponse(emptyPayload()))
      // POST /api/v1/translations — server echoes the row back
      .mockResolvedValueOnce(
        jsonResponse({
          translation: {
            id: 'tr-mine',
            source: 'user',
            submittedBy: 'me',
            body: 'water',
            targetLanguage: 'en',
            sourceAttribution: null,
            parentTranslationId: null,
            provenance: { kind: 'personal', attribution: null },
            voteScore: 0,
            viewerVote: null,
          },
        }),
      )
      // refetch GET — payload now contains the personal row
      .mockResolvedValueOnce(
        jsonResponse(payloadWith([{ id: 'tr-mine', body: 'water' }])),
      );
    vi.stubGlobal('fetch', fetchMock);

    render(WordPopup, {
      token: makeToken({ surface: 'पानी', lemmaId: 'lem-1' }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
    });
    const toggle = await waitFor(() => {
      const el = document.body.querySelector<HTMLButtonElement>('.add-toggle');
      if (!el) throw new Error('add-toggle missing');
      return el;
    });
    toggle.click();
    const textarea = await waitFor(() => {
      const el = document.body.querySelector<HTMLTextAreaElement>(
        '.add-form textarea',
      );
      if (!el) throw new Error('textarea missing');
      return el;
    });

    // Type via the same mechanism Svelte's bind:value listens for.
    textarea.value = 'water';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );

    // The translations list refreshes and the form collapses back to
    // the toggle so the user immediately sees what they added.
    await waitFor(() => {
      const list = document.body.querySelector('.translations');
      expect(list?.textContent ?? '').toContain('water');
      expect(document.body.querySelector('.add-form')).toBeNull();
      expect(document.body.querySelector('.add-toggle')).not.toBeNull();
    });
  });
});
