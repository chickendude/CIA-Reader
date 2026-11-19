import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';

import WordTooltip from './WordTooltip.svelte';
import type { ServerToken } from './types.js';
import type { AnchorRect } from './tooltip-position.js';

const ANCHOR: AnchorRect = {
  top: 200,
  left: 400,
  bottom: 224,
  right: 460,
  width: 60,
  height: 24,
};

function makeToken(overrides: Partial<ServerToken> = {}): ServerToken {
  return {
    id: 't1',
    idx: 0,
    surface: 'प्रभात',
    isWord: true,
    isAmbiguous: false,
    isOov: false,
    lemmaId: 'lem-1',
    romanization: 'prabhāt',
    glossDefault: null,
    personalGloss: null,
    candidates: [],
    features: {},
    numberForms: null,
    status: 'unknown',
    ...overrides,
  };
}

beforeEach(() => {
  // The tooltip portals to <body>, so any .tip leftover from
  // a previous test (e.g. cleanup() didn't remove it because the
  // portal action's destroy fired late) would confuse queries.
  document.body.querySelectorAll('.tip').forEach((el) => el.remove());
});

afterEach(() => {
  cleanup();
  // Belt + braces: clear any portaled tooltip the cleanup didn't.
  document.body.querySelectorAll('.tip').forEach((el) => el.remove());
});

// WordTooltip portals its DOM to <body>, so we query the
// document body rather than the testing-library `container`.
describe('WordTooltip gloss display', () => {
  it('shows the book count on the preview and clears it for a word without a count', async () => {
    const view = render(WordTooltip, {
      token: makeToken({ bookFrequency: 6 }),
      anchorRect: ANCHOR,
    });
    expect(document.querySelector('.tip-title .tip-count [aria-hidden]')?.textContent).toBe('x6');
    await view.rerender({ token: makeToken({ lemmaId: null }), anchorRect: ANCHOR });
    expect(document.querySelector('.tip-count')).toBeNull();
  });

  it('shows only the selected entry when a Hindi occurrence has been confirmed', () => {
    render(WordTooltip, {token:makeToken({surface:'एक',headword:'एक',pos:'NUM',glossDefault:'one (1), a',selectedBy:'human',candidates:[
      {lemmaId:'adj',headword:'एक',pos:'ADJ',glossDefault:'sole, only; united',score:1,features:{}},
    ]}),anchorRect:ANCHOR,language:'hi'});
    expect(document.body.querySelectorAll('.tip-candidate')).toHaveLength(1);
    expect(document.body.textContent).toContain('one (1), a');
    expect(document.body.textContent).not.toContain('sole, only');
  });
  it('shows every Hindi POS candidate, including meanings beyond the primary entry', () => {
    render(WordTooltip, { token: makeToken({
      surface: 'हिन्दी', headword: 'हिंदी', pos: 'ADJ', glossDefault: 'Indian',
      isAmbiguous: true, candidates: [
        { lemmaId: 'proper', headword: 'हिंदी', pos: 'PROPN', glossDefault: 'Modern Standard Hindi; The Central Zone of Indo-Aryan languages', score: 1, features: {} },
        { lemmaId: 'noun', headword: 'हिंदी', pos: 'NOUN', glossDefault: 'an Indian; a person of India', score: 1, features: {} },
      ],
    }), anchorRect: ANCHOR, language: 'hi' });
    const cards = document.body.querySelectorAll('.tip-candidate');
    expect(cards).toHaveLength(3);
    expect(cards[0]?.textContent).toContain('Indian');
    expect(cards[1]?.querySelectorAll('ol > li')).toHaveLength(2);
    expect(cards[1]?.textContent).toContain('Modern Standard Hindi');
    expect(cards[2]?.textContent).toContain('a person of India');
  });
  it("shows the lemma's glossDefault when present", () => {
    render(WordTooltip, {
      token: makeToken({ glossDefault: 'morning, dawn' }),
      anchorRect: ANCHOR,
    });
    const def = document.body.querySelector('.tip-def');
    expect(def?.textContent).toBe('morning, dawn');
    expect(def?.classList.contains('muted')).toBe(false);
  });

  it("falls back to italic 'No translations' when glossDefault is null but the lemma is known", () => {
    render(WordTooltip, {
      token: makeToken({ glossDefault: null }),
      anchorRect: ANCHOR,
    });
    const def = document.body.querySelector('.tip-def');
    expect(def?.textContent).toBe('No translations');
    expect(def?.classList.contains('empty')).toBe(true);
  });

  it("shows 'No dictionary match' for OOV tokens regardless of glossDefault", () => {
    render(WordTooltip, {
      token: makeToken({ isOov: true, glossDefault: 'should not show' }),
      anchorRect: ANCHOR,
    });
    const def = document.body.querySelector('.tip-def');
    expect(def?.textContent).toBe('No dictionary match');
    expect(def?.classList.contains('empty')).toBe(true);
  });

  it('prefers the viewer’s own personalGloss over glossDefault', () => {
    render(WordTooltip, {
      token: makeToken({
        glossDefault: 'morning, dawn',
        personalGloss: 'sunrise (mine)',
      }),
      anchorRect: ANCHOR,
    });
    const def = document.body.querySelector(
      '[data-testid="tip-personal"]',
    );
    expect(def?.textContent).toContain('sunrise (mine)');
    // The dictionary gloss is suppressed when the viewer has their own.
    expect(document.body.textContent).not.toContain('morning, dawn');
  });

  it('shows the personalGloss even on OOV tokens (the user has translated it themselves)', () => {
    render(WordTooltip, {
      token: makeToken({
        isOov: true,
        glossDefault: null,
        personalGloss: 'my coinage',
      }),
      anchorRect: ANCHOR,
    });
    expect(
      document.body.querySelector('[data-testid="tip-personal"]')?.textContent,
    ).toContain('my coinage');
    expect(document.body.textContent).not.toContain('No dictionary match');
  });

  it("treats no-lemma tokens like an empty-translation lemma with italic 'No translations'", () => {
    render(WordTooltip, {
      token: makeToken({ lemmaId: null, glossDefault: null }),
      anchorRect: ANCHOR,
    });
    expect(document.body.querySelector('.tip-def')?.textContent).toBe(
      'No translations',
    );
  });

  it('portals the tooltip to document.body', () => {
    const { container } = render(WordTooltip, {
      token: makeToken({ glossDefault: 'morning' }),
      anchorRect: ANCHOR,
    });
    // The .tip element should NOT live inside the testing-library
    // container — that proves it portaled successfully.
    expect(container.querySelector('.tip')).toBeNull();
    expect(document.body.querySelector('.tip')).not.toBeNull();
  });
});

describe('WordTooltip number tokens', () => {
  function makeNumberToken(): ServerToken {
    return makeToken({
      surface: '123',
      lemmaId: null,
      romanization: '123',
      features: {},
      numberForms: {
        value: '123',
        digitsLatin: '123',
        digitsDeva: '१२३',
        digitsOrya: '୧୨୩',
        hi: { spelled: 'एक सौ तेईस', romanized: 'ek sau teīs' },
        mr: { spelled: 'एकशे तेवीस', romanized: 'ēkaśē tēvīsa' },
        odia: { spelled: 'ଏକ ଶହ ତେଇଶ', romanized: 'ēka śaha tēiśa' },
        eu: { spelled: 'ehun eta hogeita hiru', romanized: '' },
      },
    });
  }

  it('shows the spelled-out form + romanization for the reading language', () => {
    render(WordTooltip, {
      token: makeNumberToken(),
      anchorRect: ANCHOR,
      language: 'hi',
    });
    const def = document.body.querySelector('.tip-def');
    expect(def?.textContent).toContain('एक सौ तेईस');
    expect(def?.textContent).toContain('ek sau teīs');
    expect(def?.classList.contains('empty')).toBe(false);
  });

  it('switches to the Marathi form when the reader is in Marathi', () => {
    render(WordTooltip, {
      token: makeNumberToken(),
      anchorRect: ANCHOR,
      language: 'mr',
    });
    const def = document.body.querySelector('.tip-def');
    expect(def?.textContent).toContain('एकशे तेवीस');
  });

  it('switches to the Odia form when the reader is in Odia', () => {
    render(WordTooltip, {
      token: makeNumberToken(),
      anchorRect: ANCHOR,
      language: 'or',
    });
    const def = document.body.querySelector('.tip-def');
    expect(def?.textContent).toContain('ଏକ ଶହ ତେଇଶ');
  });

  it('switches to the Basque form (no romanization stripe) when the reader is in Basque', () => {
    render(WordTooltip, {
      token: makeNumberToken(),
      anchorRect: ANCHOR,
      language: 'eu',
    });
    const def = document.body.querySelector('.tip-def');
    expect(def?.textContent).toContain('ehun eta hogeita hiru');
    // No Indic spelling leaks; Latin-script carries no romanization.
    expect(def?.textContent).not.toContain('एक सौ तेईस');
    expect(def?.querySelector('.num-roman')).toBeNull();
  });

  it('suppresses the head romanization for number tokens (the digits would be redundant)', () => {
    render(WordTooltip, {
      token: makeNumberToken(),
      anchorRect: ANCHOR,
      language: 'hi',
    });
    // Head holds only the surface; the romanization stripe is
    // suppressed because token.romanization for "123" is just "123".
    const head = document.body.querySelector('.tip-head');
    expect(head?.querySelectorAll('.tip-roman')).toHaveLength(0);
  });

  it('falls back to the empty state when no language is given (legacy callers)', () => {
    render(WordTooltip, {
      token: makeNumberToken(),
      anchorRect: ANCHOR,
    });
    // No language prop → tooltip can't pick a form, so the regular
    // "No translations" path runs (lemmaId is null on number tokens).
    const def = document.body.querySelector('.tip-def');
    expect(def?.classList.contains('empty')).toBe(true);
  });

  it('marks legacy number tokens (no numberForms payload) as a Number rather than "No translations"', () => {
    render(WordTooltip, {
      token: makeToken({
        surface: '1,013,322',
        // A numeral in an older chapter can have a dictionary entry of its own.
        lemmaId: 'auto-created-lem',
        features: {},
        numberForms: null,
      }),
      anchorRect: ANCHOR,
      language: 'hi',
    });
    expect(
      document.body.querySelector('[data-testid="legacy-number"]'),
    ).not.toBeNull();
    expect(document.body.querySelector('.tip-def')?.textContent).toBe('Number');
  });
});
