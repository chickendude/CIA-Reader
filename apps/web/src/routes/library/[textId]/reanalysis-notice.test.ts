import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import BookPage from './+page.svelte';
import type { PageData } from './$types';

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/library/book') } }));
afterEach(cleanup);

it('shows the reanalysis notice only to staff viewing an outdated analysis', async () => {
  const data: PageData = {
    user: null, currentLanguage: 'hi', availableLanguages: [], addableLanguages: [],
    book: {
      id: 'book', title: 'Test book', language: 'hi', staffOnly: false, status: 'ready',
      chapters: 1, words: 10, uniqueWords: 5, unresolved: 0, unparsedWords: 0,
      knownWords: 0, learningWords: 0, knownHeadwords: 0, learningHeadwords: 0,
      knownPct: null, learningPct: null, uniquePct: null, personalTextId: null, analysisStale: true,
    },
    isStaff: false, isAuthenticated: false, deckBands: [],
    comparison: { books: [], source: undefined, known: 98, goal: 98, result: null },
  };
  const view = render(BookPage, { data, params: { textId: 'book' }, form: null });
  const notice = () => screen.queryByText(/Reanalyze to update coverage/);
  expect(notice()).toBeNull();
  await view.rerender({ data: { ...data, isAuthenticated: true } });
  expect(notice()).toBeNull();
  const staff = { ...data, isAuthenticated: true, isStaff: true };
  await view.rerender({ data: staff });
  expect(notice()).toBeTruthy();
  await view.rerender({ data: { ...staff, book: { ...staff.book, analysisStale: false } } });
  expect(notice()).toBeNull();
});
