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
    status: 'unknown',
    ...overrides,
  };
}

beforeEach(() => {
  // Reset DOM between tests so multiple renders don't pile up
  // .tip elements that confuse querySelector.
});

afterEach(() => {
  cleanup();
});

describe('WordTooltip — gloss display (T-5.18)', () => {
  it("shows the lemma's glossDefault when present", () => {
    const { container } = render(WordTooltip, {
      token: makeToken({ glossDefault: 'morning, dawn' }),
      anchorRect: ANCHOR,
    });
    const def = container.querySelector('.tip-def');
    expect(def?.textContent).toBe('morning, dawn');
    expect(def?.classList.contains('muted')).toBe(false);
  });

  it("falls back to italic 'No translations' when glossDefault is null but the lemma is known (T-5.20)", () => {
    const { container } = render(WordTooltip, {
      token: makeToken({ glossDefault: null }),
      anchorRect: ANCHOR,
    });
    const def = container.querySelector('.tip-def');
    expect(def?.textContent).toBe('No translations');
    expect(def?.classList.contains('empty')).toBe(true);
  });

  it("shows 'No dictionary match' for OOV tokens regardless of glossDefault (T-5.20)", () => {
    const { container } = render(WordTooltip, {
      token: makeToken({ isOov: true, glossDefault: 'should not show' }),
      anchorRect: ANCHOR,
    });
    const def = container.querySelector('.tip-def');
    expect(def?.textContent).toBe('No dictionary match');
    expect(def?.classList.contains('empty')).toBe(true);
  });

  it("treats no-lemma tokens like an empty-translation lemma — italic 'No translations' (T-5.20)", () => {
    const { container } = render(WordTooltip, {
      token: makeToken({ lemmaId: null, glossDefault: null }),
      anchorRect: ANCHOR,
    });
    expect(container.querySelector('.tip-def')?.textContent).toBe(
      'No translations',
    );
  });
});
