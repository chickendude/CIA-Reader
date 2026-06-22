import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';

import ChapterBody from './ChapterBody.svelte';
import type { ChapterView, ServerToken } from './types.js';

beforeAll(() => {
  // jsdom doesn't ship matchMedia; WordPopup (mounted by ChapterBody)
  // reads it to switch between mobile/desktop layouts.
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

function word(overrides: Partial<ServerToken> = {}): ServerToken {
  return {
    id: 't1',
    idx: 0,
    surface: 'Egun',
    isWord: true,
    isAmbiguous: false,
    isOov: false,
    lemmaId: 'lem-1',
    romanization: null,
    glossDefault: 'day',
    personalGloss: null,
    candidates: [],
    features: {},
    numberForms: null,
    status: 'unknown',
    hasDefinition: true,
    bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 },
    ...overrides,
  };
}

function chapter(tokens: ServerToken[]): ChapterView {
  return {
    id: 'chap-0',
    idx: 0,
    title: null,
    body: tokens.map((t) => t.surface).join(' '),
    tokenCount: tokens.length,
    tokens,
    phraseSpans: [],
  };
}

const PAGE_IMAGE = { url: '/pdf-assets/texts/x/pages/0.webp', width: 800, height: 1200 };

beforeEach(() => {
  // WordPopup mounts unconditionally; stub fetch so any background lookup
  // in its empty state can't hit the network during the test.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChapterBody — PDF image overlay', () => {
  it('renders the page image and one clickable hotspot per word, positioned by bbox', () => {
    const { container } = render(ChapterBody, {
      chapter: chapter([
        word(),
        // whitespace token: no hotspot
        word({ id: 'ws', idx: 1, surface: ' ', isWord: false, bbox: null }),
        word({ id: 't2', idx: 2, surface: 'on', bbox: { x: 0.5, y: 0.2, w: 0.1, h: 0.05 } }),
      ]),
      language: 'eu',
      textId: 'x',
      pageImage: PAGE_IMAGE,
    });

    const img = container.querySelector('img.page-img') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe(PAGE_IMAGE.url);

    const hotspots = container.querySelectorAll('.ovl-hotspot');
    // Two word tokens have boxes; the whitespace token has none.
    expect(hotspots).toHaveLength(2);

    const first = hotspots[0] as HTMLElement;
    expect(first.getAttribute('data-token-id')).toBe('t1');
    // The bbox (0.1, 0.2, 0.3, 0.05) maps to percentage insets. jsdom
    // normalizes `10.000%` → `10%`.
    expect(first.style.left).toBe('10%');
    expect(first.style.top).toBe('20%');
    expect(first.style.width).toBe('30%');
    expect(first.style.height).toBe('5%');
  });

  it('reflects known-word status on the hotspot via data-s', () => {
    const { container } = render(ChapterBody, {
      chapter: chapter([word({ status: 'learning' })]),
      language: 'eu',
      textId: 'x',
      pageImage: PAGE_IMAGE,
    });
    const hotspot = container.querySelector('.ovl-hotspot') as HTMLElement;
    // 'learning' maps to status code '2' (see STATUS_TO_CODE).
    expect(hotspot.getAttribute('data-s')).toBe('2');
  });

  it('renders reflowed text (no overlay) when pageImage is absent', () => {
    const { container } = render(ChapterBody, {
      chapter: chapter([word()]),
      language: 'eu',
      textId: 'x',
    });
    expect(container.querySelector('.ovl-hotspot')).toBeNull();
    expect(container.querySelector('.page-overlay')).toBeNull();
    // Falls back to the normal word-span render.
    expect(container.querySelector('.word')).not.toBeNull();
  });
});
