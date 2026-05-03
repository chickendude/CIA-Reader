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
    personalGloss: null,
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

    // The user sees the new translation immediately — added rows
    // become the new primary slot at the top of the popup. The
    // bottom add form collapses back to the toggle button.
    await waitFor(() => {
      const primary = document.body.querySelector(
        '[data-testid="primary-translation-edit"]',
      );
      expect(primary?.textContent ?? '').toContain('water');
      expect(document.body.querySelector('.add-form')).toBeNull();
      expect(document.body.querySelector('.add-toggle')).not.toBeNull();
    });
  });
});

describe('WordPopup — edit + delete personal translations', () => {
  function personalRow(id: string, body: string) {
    return {
      id,
      source: 'user' as const,
      submittedBy: 'me',
      body,
      targetLanguage: 'en',
      sourceAttribution: null,
      parentTranslationId: null,
      provenance: { kind: 'personal' as const, attribution: null },
      voteScore: 0,
      viewerVote: null,
    };
  }

  function payloadOf(personal: { id: string; body: string }[]) {
    return {
      lemma: { id: 'lem-1', headword: 'पानी', pos: 'NOUN', glossDefault: null },
      translations: {
        personal: personal.map((p) => personalRow(p.id, p.body)),
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
    vi.restoreAllMocks();
  });

  // The list-row Edit + Delete buttons cover the secondary personal
  // translations only — the primary (oldest) one moved out into its
  // own slot at the top of the popup, so payloads need at least two
  // personal rows to surface a list-row to act on.
  const TWO_PERSONAL = [
    { id: 'tr-1', body: 'water' },
    { id: 'tr-2', body: 'lake' },
  ];

  it('renders Edit + Delete buttons on each non-primary personal row when isOwner=true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(payloadOf(TWO_PERSONAL))),
    );
    render(WordPopup, {
      token: makeToken({ surface: 'पानी', lemmaId: 'lem-1' }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
    });
    await waitFor(() => {
      expect(
        document.body.querySelector('[data-testid="edit-personal"]'),
      ).not.toBeNull();
      expect(
        document.body.querySelector('[data-testid="delete-personal"]'),
      ).not.toBeNull();
    });
  });

  it('hides Edit + Delete buttons on non-primary personal rows when isOwner=false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(payloadOf(TWO_PERSONAL))),
    );
    render(WordPopup, {
      token: makeToken({ surface: 'पानी', lemmaId: 'lem-1' }),
      language: 'hi',
      isOwner: false,
      onClose: vi.fn(),
    });
    await waitFor(() => {
      expect(document.body.querySelector('[data-testid="personal-row"]')).not.toBeNull();
    });
    expect(document.body.querySelector('[data-testid="edit-personal"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="delete-personal"]')).toBeNull();
  });

  it('Edit swaps the secondary row for a focused textarea and PATCHes the body on Enter', async () => {
    const fetchMock = vi
      .fn()
      // initial GET
      .mockResolvedValueOnce(jsonResponse(payloadOf(TWO_PERSONAL)))
      // PATCH
      .mockResolvedValueOnce(
        jsonResponse({ translation: personalRow('tr-2', 'pond') }),
      )
      // refetch GET
      .mockResolvedValueOnce(
        jsonResponse(
          payloadOf([
            { id: 'tr-1', body: 'water' },
            { id: 'tr-2', body: 'pond' },
          ]),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const onPersonalTranslationChange = vi.fn();
    render(WordPopup, {
      token: makeToken({ surface: 'पानी', lemmaId: 'lem-1' }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
      onPersonalTranslationChange,
    });

    const editBtn = await waitFor(() => {
      const el = document.body.querySelector<HTMLButtonElement>(
        '[data-testid="edit-personal"]',
      );
      if (!el) throw new Error('edit-personal missing');
      return el;
    });
    editBtn.click();

    const textarea = await waitFor(() => {
      const el = document.body.querySelector<HTMLTextAreaElement>(
        '[data-testid="edit-personal-form"] textarea',
      );
      if (!el) throw new Error('edit textarea missing');
      return el;
    });
    expect(document.activeElement).toBe(textarea);
    expect(textarea.value).toBe('lake');

    textarea.value = 'pond';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );

    await waitFor(() => {
      expect(
        document.body.querySelector('[data-testid="edit-personal-form"]'),
      ).toBeNull();
      const list = document.body.querySelector('.translations');
      expect(list?.textContent ?? '').toContain('pond');
      // The primary row didn't change, so the parent gets the
      // unchanged primary body (the live-update channel only carries
      // the primary).
      expect(onPersonalTranslationChange).toHaveBeenCalledWith(
        'lem-1',
        'water',
      );
    });

    const patchCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        typeof url === 'string' &&
        url.endsWith('/api/v1/translations/tr-2') &&
        (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCall).toBeDefined();
  });

  it('Delete on a secondary row confirms, sends DELETE, and refetches', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(payloadOf(TWO_PERSONAL)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse(payloadOf([{ id: 'tr-1', body: 'water' }])),
      );
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(WordPopup, {
      token: makeToken({ surface: 'पानी', lemmaId: 'lem-1' }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
    });

    const delBtn = await waitFor(() => {
      const el = document.body.querySelector<HTMLButtonElement>(
        '[data-testid="delete-personal"]',
      );
      if (!el) throw new Error('delete-personal missing');
      return el;
    });
    delBtn.click();

    await waitFor(() => {
      expect(
        document.body.querySelector('[data-testid="personal-row"]'),
      ).toBeNull();
    });

    const deleteCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        typeof url === 'string' &&
        url.endsWith('/api/v1/translations/tr-2') &&
        (init as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(deleteCall).toBeDefined();
  });

  it('Delete is a no-op when window.confirm is dismissed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(payloadOf(TWO_PERSONAL)));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(WordPopup, {
      token: makeToken({ surface: 'पानी', lemmaId: 'lem-1' }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
    });

    const delBtn = await waitFor(() => {
      const el = document.body.querySelector<HTMLButtonElement>(
        '[data-testid="delete-personal"]',
      );
      if (!el) throw new Error('delete-personal missing');
      return el;
    });
    delBtn.click();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      document.body.querySelector('[data-testid="personal-row"]'),
    ).not.toBeNull();
  });

  it('fires onPersonalTranslationChange after a successful add', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(payloadOf([])))
      .mockResolvedValueOnce(jsonResponse({ translation: personalRow('tr-1', 'water') }))
      .mockResolvedValueOnce(jsonResponse(payloadOf([{ id: 'tr-1', body: 'water' }])));
    vi.stubGlobal('fetch', fetchMock);

    const onPersonalTranslationChange = vi.fn();
    render(WordPopup, {
      token: makeToken({ surface: 'पानी', lemmaId: 'lem-1' }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
      onPersonalTranslationChange,
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
      if (!el) throw new Error('add textarea missing');
      return el;
    });
    textarea.value = 'water';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );

    await waitFor(() => {
      expect(onPersonalTranslationChange).toHaveBeenCalledWith('lem-1', 'water');
    });
  });
});

describe('WordPopup — primary translation editor (above status buttons)', () => {
  function personalRow(id: string, body: string) {
    return {
      id,
      source: 'user' as const,
      submittedBy: 'me',
      body,
      targetLanguage: 'en',
      sourceAttribution: null,
      parentTranslationId: null,
      provenance: { kind: 'personal' as const, attribution: null },
      voteScore: 0,
      viewerVote: null,
    };
  }

  function payloadOf(personal: { id: string; body: string }[]) {
    return {
      lemma: { id: 'lem-1', headword: 'पानी', pos: 'NOUN', glossDefault: null },
      translations: {
        personal: personal.map((p) => personalRow(p.id, p.body)),
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
    vi.restoreAllMocks();
  });

  async function awaitElement<T extends Element>(selector: string): Promise<T> {
    return waitFor(() => {
      const el = document.body.querySelector<T>(selector);
      if (!el) throw new Error(`missing ${selector}`);
      return el;
    });
  }

  it('renders an empty primary slot when the viewer has no personal translation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(payloadOf([]))),
    );
    render(WordPopup, {
      token: makeToken({ surface: 'पानी', lemmaId: 'lem-1' }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
    });
    const slot = await awaitElement<HTMLElement>(
      '[data-testid="primary-translation-edit"]',
    );
    expect(slot.dataset.empty).toBe('1');
    expect(slot.textContent ?? '').toContain('+ Add your translation');
  });

  it('shows the existing personal body in the primary slot above the status buttons', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(payloadOf([{ id: 'tr-1', body: 'water' }])),
      ),
    );
    render(WordPopup, {
      token: makeToken({ surface: 'पानी', lemmaId: 'lem-1' }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
    });
    const slot = await awaitElement<HTMLElement>(
      '[data-testid="primary-translation-edit"]',
    );
    expect(slot.dataset.empty).toBe('0');
    expect(slot.textContent ?? '').toContain('water');

    // Slot must come before the status buttons in document order.
    const status = document.body.querySelector('.sp-status');
    expect(status).not.toBeNull();
    const cmp = slot.compareDocumentPosition(status!);
    expect(cmp & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The primary row is hidden from the translations list to avoid
    // duplicating itself.
    const personalRows = document.body.querySelectorAll(
      '[data-testid="personal-row"]',
    );
    expect(personalRows.length).toBe(0);
  });

  it('opens the editor at the same single-row size as the empty placeholder (no growth on click)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(payloadOf([]))),
    );
    render(WordPopup, {
      token: makeToken({ surface: 'पानी', lemmaId: 'lem-1' }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
    });
    const slot = await awaitElement<HTMLButtonElement>(
      '[data-testid="primary-translation-edit"]',
    );
    slot.click();
    const textarea = await awaitElement<HTMLTextAreaElement>(
      '.sp-primary-form textarea',
    );
    // rows=1 keeps the textarea the same height as the dashed
    // placeholder it replaced; the user can drag-resize if they
    // need more vertical room.
    expect(textarea.rows).toBe(1);
  });

  it('clicking the empty slot opens an autofocused textarea and POSTs a new personal translation', async () => {
    const fetchMock = vi
      .fn()
      // initial GET — no personal yet
      .mockResolvedValueOnce(jsonResponse(payloadOf([])))
      // POST /api/v1/translations
      .mockResolvedValueOnce(
        jsonResponse({ translation: personalRow('tr-1', 'water') }),
      )
      // refetch
      .mockResolvedValueOnce(
        jsonResponse(payloadOf([{ id: 'tr-1', body: 'water' }])),
      );
    vi.stubGlobal('fetch', fetchMock);

    const onPersonalTranslationChange = vi.fn();
    render(WordPopup, {
      token: makeToken({ surface: 'पानी', lemmaId: 'lem-1' }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
      onPersonalTranslationChange,
    });

    const slot = await awaitElement<HTMLButtonElement>(
      '[data-testid="primary-translation-edit"]',
    );
    slot.click();

    const textarea = await awaitElement<HTMLTextAreaElement>(
      '.sp-primary-form textarea',
    );
    expect(document.activeElement).toBe(textarea);

    textarea.value = 'water';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );

    await waitFor(() => {
      const display = document.body.querySelector<HTMLElement>(
        '[data-testid="primary-translation-edit"]',
      );
      expect(display).not.toBeNull();
      expect(display!.textContent ?? '').toContain('water');
      expect(display!.dataset.empty).toBe('0');
    });

    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        typeof url === 'string' &&
        url.endsWith('/api/v1/translations') &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCall).toBeDefined();
    expect(onPersonalTranslationChange).toHaveBeenCalledWith('lem-1', 'water');
  });

  it('clicking an existing primary opens the editor pre-filled and PATCHes on Enter', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(payloadOf([{ id: 'tr-1', body: 'water' }])),
      )
      // PATCH
      .mockResolvedValueOnce(
        jsonResponse({ translation: personalRow('tr-1', 'fresh water') }),
      )
      // refetch
      .mockResolvedValueOnce(
        jsonResponse(payloadOf([{ id: 'tr-1', body: 'fresh water' }])),
      );
    vi.stubGlobal('fetch', fetchMock);

    const onPersonalTranslationChange = vi.fn();
    render(WordPopup, {
      token: makeToken({ surface: 'पानी', lemmaId: 'lem-1' }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
      onPersonalTranslationChange,
    });

    const slot = await awaitElement<HTMLButtonElement>(
      '[data-testid="primary-translation-edit"]',
    );
    slot.click();
    const textarea = await awaitElement<HTMLTextAreaElement>(
      '.sp-primary-form textarea',
    );
    expect(textarea.value).toBe('water');
    expect(document.activeElement).toBe(textarea);

    textarea.value = 'fresh water';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );

    await waitFor(() => {
      const display = document.body.querySelector<HTMLElement>(
        '[data-testid="primary-translation-edit"]',
      );
      expect(display?.textContent ?? '').toContain('fresh water');
    });

    const patchCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        typeof url === 'string' &&
        url.endsWith('/api/v1/translations/tr-1') &&
        (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCall).toBeDefined();
    expect(onPersonalTranslationChange).toHaveBeenCalledWith(
      'lem-1',
      'fresh water',
    );
  });

  it('Esc cancels the primary edit and leaves the existing body in place', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(payloadOf([{ id: 'tr-1', body: 'water' }])),
      ),
    );
    render(WordPopup, {
      token: makeToken({ surface: 'पानी', lemmaId: 'lem-1' }),
      language: 'hi',
      isOwner: true,
      onClose: vi.fn(),
    });

    const slot = await awaitElement<HTMLButtonElement>(
      '[data-testid="primary-translation-edit"]',
    );
    slot.click();
    const textarea = await awaitElement<HTMLTextAreaElement>(
      '.sp-primary-form textarea',
    );
    textarea.value = 'about to be discarded';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );

    await waitFor(() => {
      const display = document.body.querySelector<HTMLElement>(
        '[data-testid="primary-translation-edit"]',
      );
      expect(display?.textContent ?? '').toContain('water');
      expect(document.body.querySelector('.sp-primary-form')).toBeNull();
    });
  });

  it('does not render the primary slot for non-owner viewers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(payloadOf([]))),
    );
    render(WordPopup, {
      token: makeToken({ surface: 'पानी', lemmaId: 'lem-1' }),
      language: 'hi',
      isOwner: false,
      onClose: vi.fn(),
    });
    await awaitElement('[data-testid="word-popup"]');
    expect(
      document.body.querySelector('[data-testid="primary-translation"]'),
    ).toBeNull();
  });
});

describe('WordPopup — POS pill in header', () => {
  function payloadOf(pos: string) {
    return {
      lemma: { id: 'lem-1', headword: 'पानी', pos, glossDefault: null },
      translations: { personal: [], official: [], community: [] },
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders an abbreviated POS pill next to the headword and exposes the full name via aria-label', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(payloadOf('NOUN')), {
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
      const pill = document.body.querySelector<HTMLElement>(
        '.sp-headword [data-testid="pos-pill"]',
      );
      if (!pill) throw new Error('missing pos-pill in header');
      expect(pill.querySelector('.pos-abbr')?.textContent).toBe('n');
      expect(pill.getAttribute('aria-label')).toBe('noun');
      // The expanded name lives in the popover so it can show on hover/focus.
      expect(pill.querySelector('.pos-pop')?.textContent?.trim()).toBe('noun');
    });
  });
});
