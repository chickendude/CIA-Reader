import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';

import ChapterNav from './ChapterNav.svelte';
import type { ReaderTocEntry } from './reader-toc.js';

afterEach(cleanup);

function entry(
  i: number,
  overrides: Partial<ReaderTocEntry> = {},
): ReaderTocEntry {
  return {
    key: `k${i}`,
    number: i + 1,
    title: `Chapter ${i + 1}`,
    words: (i + 1) * 100,
    href: `/reader/t?mode=page&chapter=${i}`,
    isCurrent: false,
    ...overrides,
  };
}

function threeChapters(currentIndex = 1): ReaderTocEntry[] {
  return [0, 1, 2].map((i) =>
    entry(i, { isCurrent: i === currentIndex, title: `Ch ${i + 1}` }),
  );
}

describe('ChapterNav', () => {
  it('shows the current chapter title and opens/closes the TOC on the trigger', async () => {
    const { container } = render(ChapterNav, {
      props: { entries: threeChapters(1), currentIndex: 1 },
    });
    const trigger = container.querySelector(
      '.chapter-nav-trigger',
    ) as HTMLButtonElement;
    expect(trigger.textContent).toContain('Ch 2');
    expect(container.querySelector('.chapter-nav-menu')).toBeNull();

    await fireEvent.click(trigger);
    expect(container.querySelector('.chapter-nav-menu')).not.toBeNull();

    await fireEvent.click(trigger);
    expect(container.querySelector('.chapter-nav-menu')).toBeNull();
  });

  it('lists every chapter with its word count and flags the current one', async () => {
    const { container } = render(ChapterNav, {
      props: { entries: threeChapters(1), currentIndex: 1 },
    });
    await fireEvent.click(
      container.querySelector('.chapter-nav-trigger') as HTMLButtonElement,
    );
    const rows = container.querySelectorAll('[role="menuitemradio"]');
    expect(rows).toHaveLength(3);
    expect(rows[1]!.getAttribute('aria-checked')).toBe('true');
    expect(rows[0]!.getAttribute('aria-checked')).toBe('false');
    // Word counts render (200 words for the 2nd chapter).
    expect(container.querySelector('.chapter-nav-menu')!.textContent).toContain(
      '200 words',
    );
  });

  it('closes on Escape and on outside-click', async () => {
    const { container } = render(ChapterNav, {
      props: { entries: threeChapters(0), currentIndex: 0 },
    });
    const trigger = container.querySelector(
      '.chapter-nav-trigger',
    ) as HTMLButtonElement;

    await fireEvent.click(trigger);
    expect(container.querySelector('.chapter-nav-menu')).not.toBeNull();
    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('.chapter-nav-menu')).toBeNull();

    await fireEvent.click(trigger);
    expect(container.querySelector('.chapter-nav-menu')).not.toBeNull();
    await fireEvent.mouseDown(document.body);
    expect(container.querySelector('.chapter-nav-menu')).toBeNull();
  });

  it('renders a plain static title with no caret/arrows for a single chapter', () => {
    const { container } = render(ChapterNav, {
      props: {
        entries: [entry(0, { isCurrent: true, title: 'Solo' })],
        currentIndex: 0,
      },
    });
    expect(container.querySelector('.chapter-nav-trigger')).toBeNull();
    expect(container.querySelector('.chapter-nav-arrow')).toBeNull();
    expect(
      container.querySelector('.chapter-nav-title-static')!.textContent,
    ).toContain('Solo');
  });

  it('points the arrows at the adjacent chapters and disables the ends', () => {
    const first = render(ChapterNav, {
      props: { entries: threeChapters(0), currentIndex: 0 },
    });
    const firstArrows = first.container.querySelectorAll('.chapter-nav-arrow');
    // prev is disabled (span), next is a link to chapter 1.
    expect(firstArrows[0]!.classList.contains('is-disabled')).toBe(true);
    expect((firstArrows[1] as HTMLAnchorElement).getAttribute('href')).toBe(
      '/reader/t?mode=page&chapter=1',
    );
    first.unmount();

    const last = render(ChapterNav, {
      props: { entries: threeChapters(2), currentIndex: 2 },
    });
    const lastArrows = last.container.querySelectorAll('.chapter-nav-arrow');
    expect((lastArrows[0] as HTMLAnchorElement).getAttribute('href')).toBe(
      '/reader/t?mode=page&chapter=1',
    );
    expect(lastArrows[1]!.classList.contains('is-disabled')).toBe(true);
  });

  it('routes a course-locked next arrow through ?skipLock=1', () => {
    const { container } = render(ChapterNav, {
      props: { entries: threeChapters(0), currentIndex: 0, nextLocked: true },
    });
    const next = container.querySelectorAll('.chapter-nav-arrow')[1] as HTMLAnchorElement;
    expect(next.getAttribute('href')).toBe('/reader/t?mode=page&chapter=1&skipLock=1');
    expect(next.classList.contains('is-locked')).toBe(true);
  });

  it('marks titles dir="auto" so RTL (Hebrew-script) chapters align', async () => {
    const { container } = render(ChapterNav, {
      props: {
        entries: threeChapters(0).map((e) => ({ ...e, title: 'אלף' })),
        currentIndex: 0,
      },
    });
    expect(
      container.querySelector('.chapter-nav-title')!.getAttribute('dir'),
    ).toBe('auto');
    await fireEvent.click(
      container.querySelector('.chapter-nav-trigger') as HTMLButtonElement,
    );
    expect(
      container.querySelector('.chapter-nav-row-title')!.getAttribute('dir'),
    ).toBe('auto');
  });

  it('keeps menu arrow-key navigation from bubbling to the window page-flip handler', async () => {
    const { container } = render(ChapterNav, {
      props: { entries: threeChapters(0), currentIndex: 0 },
    });
    await fireEvent.click(
      container.querySelector('.chapter-nav-trigger') as HTMLButtonElement,
    );
    const rows = container.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    const winSpy = vi.fn();
    window.addEventListener('keydown', winSpy);
    rows[0]!.focus();
    await fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' });
    window.removeEventListener('keydown', winSpy);
    // Focus advanced AND the event never reached the window.
    expect(document.activeElement).toBe(rows[1]);
    expect(winSpy).not.toHaveBeenCalled();
  });
});
