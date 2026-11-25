import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';

import BookActions from './BookActions.svelte';

vi.mock('$lib/components/toast/toast-store.js', async (importOriginal) => {
  const { createToastStore } = await importOriginal<typeof import('../toast/toast-store.js')>();
  return { getToastStore: createToastStore };
});

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('hides Rename when the viewer only has catalog actions', async () => {
  render(BookActions, { id: 'book', title: 'Book', catalogAction: 'remove' });
  await fireEvent.click(screen.getByRole('button', { name: 'Actions for Book' }));
  expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reparse book' })).toBeNull();
});

it('retains the edited title after a failed save and retries a standalone text rename', async () => {
  vi.stubGlobal('scrollTo', vi.fn());
  const patch = vi.fn()
    .mockResolvedValueOnce(Response.json({ message: 'Save failed' }, { status: 500 }))
    .mockResolvedValueOnce(Response.json({}));
  vi.stubGlobal('fetch', patch);
  render(BookActions, { id: 'text', title: 'Old title', canRename: true });
  await fireEvent.click(screen.getByRole('button', { name: 'Actions for Old title' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Book title' });
  const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
  expect(input.value).toBe('Old title');
  await fireEvent.input(input, { target: { value: '  ' } });
  expect(save.disabled).toBe(true);
  await fireEvent.input(input, { target: { value: '  नया नाम  ' } });
  await fireEvent.click(save);
  expect((await screen.findByRole('alert')).textContent).toBe('Save failed');
  expect(input.value).toBe('  नया नाम  ');
  await fireEvent.click(save);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(patch).toHaveBeenCalledTimes(2);
  expect(patch).toHaveBeenLastCalledWith('/api/v1/texts/text', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'नया नाम' }),
  });
});

it('reparses a standalone book using the progress endpoint', async () => {
  const request = vi.fn().mockResolvedValue(new Response(
    '{"type":"complete","tokensWritten":3,"wordsParsed":2}\n',
  ));
  vi.stubGlobal('fetch', request);
  render(BookActions, { id: 'text', title: 'Book', reparseSource: 'pdf' });
  const trigger = screen.getByRole<HTMLButtonElement>('button', { name: 'Actions for Book' });
  await fireEvent.click(trigger);
  await fireEvent.click(screen.getByRole('button', { name: 'Reparse book' }));
  expect(request).toHaveBeenCalledWith('/api/v1/admin/texts/text/reprocess', {
    method: 'POST', headers: { accept: 'application/x-ndjson' },
  });
  await waitFor(() => expect(trigger.disabled).toBe(false));
});

it('requests all chapters for a chapter book', async () => {
  const request = vi.fn().mockResolvedValue(Response.json({ dispatched: 2 }));
  vi.stubGlobal('fetch', request);
  render(BookActions, { id: 'collection', title: 'Book', collection: true, reparseSource: 'book' });
  await fireEvent.click(screen.getByRole('button', { name: 'Actions for Book' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Reparse book' }));
  expect(request).toHaveBeenCalledWith('/api/v1/collections/collection/reprocess', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"all":true}',
  });
});
