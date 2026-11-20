import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { goto } from '$app/navigation';

import { emptyDraft } from '$lib/dictionary/workshop';
import ChapterBody from './ChapterBody.svelte';
import ReaderImage from './ReaderImage.svelte';
import type { ChapterView, ServerToken } from './types.js';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

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

it('pages through an illustrated EPUB section with no transcribed text', async () => {
  const chapters = [0, 1].map((idx) => ({
    ...chapter([]), id: `scan-${idx}`, idx, pageImageUrl: `/pdf-assets/texts/x/pages/${idx}.png`,
  }));
  const props = { chapters, chapterIdx: 0, textId: 'x', language: 'hi' as const };
  const view = render(ReaderImage, props);
  expect(screen.getByRole('img', { name: 'Page 1' }).getAttribute('src')).toBe(chapters[0]!.pageImageUrl);
  expect(screen.queryByRole('button', { name: 'Text' })).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(goto).toHaveBeenCalledWith('/reader/x?chapter=1', { keepFocus: true });
  await view.rerender({ ...props, chapterIdx: 1 });
  expect(screen.getByRole('img', { name: 'Page 2' }).getAttribute('src')).toBe(chapters[1]!.pageImageUrl);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next page' }).disabled).toBe(true);
});

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

it('reopens a saved form at another occurrence while the chapter is refreshing', async () => {
  const missing = { surface: 'खोजियों', lemmaId: null, isOov: true, hasDefinition: false, glossDefault: null };
  const occurrences = [word(missing), word({ ...missing, id: 't2', idx: 1 })];
  const draft = { ...emptyDraft('खोजी'), id: 'seeker', meaning: 'seeker', other: [missing.surface] };
  const entry = { id: draft.id, headword: draft.lemma, glossDefault: draft.meaning, pos: draft.pos };
  vi.stubGlobal('scrollTo', vi.fn());
  const refresh = Promise.withResolvers<Response>();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/chapters/0/tokens')) return refresh.promise;
    if (url.endsWith('/workshop/actions')) {
      return Response.json({ draft, external: '', uses: [], evidence: [], group: [] });
    }
    return Response.json({ lemma: entry, translations: { personal: [], official: [], community: [] } });
  }));
  const view = render(ChapterBody, {
    props: { chapter: chapter(occurrences), language: 'hi', textId: 'book' },
    context: new Map([['readerDictionary', () => true]]),
  });
  const words = view.container.querySelectorAll<HTMLElement>('[data-token-id]');
  await fireEvent.click(words[0]!);
  expect(screen.getByRole('button', { name: 'Add dictionary entry' })).toBeTruthy();
  window.dispatchEvent(new CustomEvent('reader-dictionary-saved', { detail: draft }));
  await fireEvent.click(words[1]!);
  await waitFor(() => expect(words[1]?.dataset.lemmaId).toBe(draft.id));
  await fireEvent.click(await screen.findByRole('button', { name: 'Edit dictionary entry' }));
  const dialog = await screen.findByRole('dialog', { name: 'Hindi dictionary entry' });
  refresh.resolve(Response.json({
    chapterId: 'chap-0',
    tokens: occurrences.map((t) => ({ ...t, lemmaId: draft.id, isOov: false, status: 'known' })),
  }));
  await waitFor(() => expect(words[1]?.dataset.s).toBe('4'));
  expect(dialog.isConnected).toBe(true);
  expect(screen.getByLabelText<HTMLInputElement>('Dictionary form').value).toBe('खोजी');
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
