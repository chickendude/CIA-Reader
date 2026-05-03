/**
 * TokenSpan render tests (T-14.3b).
 *
 * Most TokenSpan visual states (status tints, OOV dashes, anchor
 * outline) are covered indirectly via the chapter-render tests.
 * This file pins the `isInPendingSelection` prop's class wiring,
 * which is the new contract introduced for the in-progress
 * shift-click highlight — without it, ChapterBody could pass the
 * prop and the visual feedback could silently regress.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';

import TokenSpan from './TokenSpan.svelte';
import type { ServerToken } from './types.js';

afterEach(() => {
  cleanup();
});

function makeToken(overrides: Partial<ServerToken> = {}): ServerToken {
  return {
    id: 't1',
    idx: 0,
    surface: 'इंतज़ार',
    isWord: true,
    isAmbiguous: false,
    isOov: false,
    lemmaId: 'lemma-1',
    romanization: null,
    glossDefault: 'wait',
    personalGloss: null,
    candidates: [],
    numberForms: null,
    status: 'unknown',
    ...overrides,
  };
}

describe('TokenSpan — isInPendingSelection (T-14.3b)', () => {
  it('omits the .pending class by default', () => {
    const { container } = render(TokenSpan, { token: makeToken() });
    const span = container.querySelector('[data-token-id="t1"]');
    expect(span).not.toBeNull();
    expect(span!.classList.contains('pending')).toBe(false);
  });

  it('applies the .pending class when in a pending selection', () => {
    const { container } = render(TokenSpan, {
      token: makeToken(),
      isInPendingSelection: true,
    });
    const span = container.querySelector('[data-token-id="t1"]');
    expect(span).not.toBeNull();
    expect(span!.classList.contains('pending')).toBe(true);
    // Coexists with the base .word class so per-token status tints
    // (driven by data-s) still paint underneath.
    expect(span!.classList.contains('word')).toBe(true);
  });

  it('applies .pending alongside .anchor when both are true', () => {
    const { container } = render(TokenSpan, {
      token: makeToken(),
      isAnchor: true,
      isInPendingSelection: true,
    });
    const span = container.querySelector('[data-token-id="t1"]');
    expect(span).not.toBeNull();
    expect(span!.classList.contains('anchor')).toBe(true);
    expect(span!.classList.contains('pending')).toBe(true);
  });

  it('does not apply .pending to non-word tokens', () => {
    // Non-word tokens render as plain text without the wrapper
    // span entirely (TokenSpan early-returns the surface), so the
    // `pending` class can never attach. Guards against a future
    // refactor that wraps whitespace tokens too.
    const { container } = render(TokenSpan, {
      token: makeToken({ id: 't-space', surface: ' ', isWord: false }),
      isInPendingSelection: true,
    });
    expect(container.querySelector('[data-token-id="t-space"]')).toBeNull();
  });
});
