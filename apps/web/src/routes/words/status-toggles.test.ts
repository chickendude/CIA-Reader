import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import Words from './+page.svelte';
import type { PageData } from './$types';
import type { WordStatus } from './word-statuses';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ beforeNavigate: vi.fn(), goto }));

afterEach(() => {
  cleanup();
  goto.mockReset();
  vi.useRealTimers();
});

function pageData(statuses: WordStatus[]): PageData {
  return {
    user: null,
    currentLanguage: 'hi',
    availableLanguages: [],
    addableLanguages: [],
    counts: { learning: 35, known: 702, ignored: 2 },
    filters: { language: 'hi', q: '', statuses },
    rows: [],
    pagination: { offset: 0, limit: 200, total: 737 },
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

it('searches while typing, waits for IME composition, and clears immediately', async () => {
  vi.useFakeTimers();
  render(Words, { data: pageData(['known']) });
  const field = screen.getByRole('searchbox');
  await fireEvent.compositionStart(field);
  await fireEvent.input(field, { target: { value: 'मे' } });
  await vi.advanceTimersByTimeAsync(300);
  expect(goto).not.toHaveBeenCalled();
  await fireEvent.compositionEnd(field, { target: { value: 'में' } });
  await vi.advanceTimersByTimeAsync(200);
  expect(goto).toHaveBeenCalledTimes(1);
  const [url, options] = goto.mock.calls[0]!;
  const params = new URL(url, 'http://localhost').searchParams;
  expect(params.get('q')).toBe('में');
  expect(params.get('status')).toBe('known');
  expect(options).toMatchObject({ replaceState: true, keepFocus: true });
  await fireEvent.input(field, { target: { value: '' } });
  expect(goto).toHaveBeenLastCalledWith('/words?status=known', expect.anything());
});
