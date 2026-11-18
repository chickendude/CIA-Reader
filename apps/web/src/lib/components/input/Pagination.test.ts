import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import Pagination from './Pagination.svelte';

afterEach(cleanup);

it('links to adjacent pages and disables navigation at either end', async () => {
  const props = { limit: 10, total: 20, offset: 0, hrefFor: (n: number) => `?q=book&offset=${n}` };
  const view = render(Pagination, props);
  const link = (name: string) => screen.getByRole('link', { name });
  expect(screen.getByText('Page 1 of 2')).toBeTruthy();
  expect(link('Previous').hasAttribute('href')).toBe(false);
  expect(link('Next').getAttribute('href')).toBe('?q=book&offset=10');

  await view.rerender({ ...props, offset: 10 });
  expect(screen.getByText('Page 2 of 2')).toBeTruthy();
  expect(link('Previous').getAttribute('href')).toBe('?q=book&offset=0');
  expect(link('Next').getAttribute('aria-disabled')).toBe('true');
});

it('uses buttons for in-place paging and prevents repeat clicks while loading', async () => {
  const onPage = vi.fn();
  const props = { offset: 40, limit: 40, hasNext: true, onPage };
  const view = render(Pagination, props);
  expect(screen.getByText('Page 2')).toBeTruthy();
  await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(onPage).toHaveBeenCalledWith(80);
  await view.rerender({ ...props, disabled: true });
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next' }).disabled).toBe(true);
});
