import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, expect, it } from 'vitest';
import Words from './+page.svelte';
import type { PageData } from './$types';
import type { WordStatus } from './word-statuses';

afterEach(cleanup);

function pageData(statuses: WordStatus[]): PageData {
  return {
    user: null,
    currentLanguage: 'hi',
    availableLanguages: [],
    addableLanguages: [],
    counts: { learning: 35, known: 702, ignored: 2 },
    filters: { language: 'hi', q: '', statuses },
    rows: [],
    truncated: false,
  };
}

it('toggles individual statuses and switches All between every status and none', async () => {
  const view = render(Words, { data: pageData(['learning', 'known']) });
  const button = (name: RegExp) => screen.getByRole<HTMLButtonElement>('button', { name });

  expect(button(/^learning 35$/i).getAttribute('aria-pressed')).toBe('true');
  expect(button(/^learning 35$/i).value).toBe('known');
  expect(button(/^known 702$/i).value).toBe('learning');
  expect(button(/^ignored 2$/i).getAttribute('aria-pressed')).toBe('false');
  expect(button(/^ignored 2$/i).value).toBe('all');
  expect(button(/^all$/i).getAttribute('aria-pressed')).toBe('mixed');
  expect(button(/^all$/i).value).toBe('all');

  await view.rerender({ data: pageData(['learning', 'known', 'ignored']) });
  expect(button(/^all$/i).getAttribute('aria-pressed')).toBe('true');
  expect(button(/^all$/i).value).toBe('none');

  await view.rerender({ data: pageData([]) });
  expect(button(/^all$/i).getAttribute('aria-pressed')).toBe('false');
  expect(button(/^all$/i).value).toBe('all');
  expect(button(/^ignored 2$/i).value).toBe('ignored');
});
