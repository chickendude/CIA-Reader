import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import EditableDefinition from './EditableDefinition.svelte';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('lets staff click, edit, and save one canonical semicolon-separated definition', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const onSave = vi.fn();
  const { getByRole, queryByRole } = render(EditableDefinition, {
    text: 'who, which; whoever',
    translationId: 'definition',
    lemmaId: 'pronoun',
    canEdit: true,
    onSave,
  });
  await fireEvent.click(getByRole('button', { name: 'Edit definition' }));
  await waitFor(() => expect(document.activeElement).toBe(getByRole('textbox')));
  expect(queryByRole('button', { name: 'Save' })).toBeNull();
  expect(queryByRole('button', { name: 'Cancel' })).toBeNull();
  await fireEvent.input(getByRole('textbox', { name: 'Edit definition' }), {
    target: { value: 'who, which; whoever, whichever, whatever' },
  });
  await fireEvent.keyDown(getByRole('textbox'), { key: 'Enter' });
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith('who, which; whoever, whichever, whatever'),
  );
  expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/admin/translations/definition');
  expect(queryByRole('textbox')).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('keeps definitions read-only for normal users', () => {
  const { queryByRole, getByText } = render(EditableDefinition, {
    text: 'who, which; whoever',
    translationId: 'definition',
    lemmaId: 'pronoun',
    canEdit: false,
  });
  expect(queryByRole('button')).toBeNull();
  expect(queryByRole('textbox')).toBeNull();
  expect(getByText('who, which; whoever')).toBeTruthy();
  expect(queryByRole('list')).toBeNull();
});

it('keeps the editor and entered text when the server rejects permission', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
  const { getByRole } = render(EditableDefinition, {
    text: 'original',
    translationId: 'definition',
    lemmaId: 'noun',
    canEdit: true,
  });
  await fireEvent.click(getByRole('button', { name: 'Edit definition' }));
  await fireEvent.input(getByRole('textbox'), { target: { value: 'edited' } });
  await fireEvent.blur(getByRole('textbox'));
  await waitFor(() => expect(getByRole('alert').textContent).toContain('permission'));
  expect(getByRole('textbox')).toBeTruthy();
});

it('saves on blur and cancels on Escape without writing', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const { getByRole, queryByRole, getByText } = render(EditableDefinition, {
    text: 'original', translationId: 'definition', lemmaId: 'noun', canEdit: true,
  });
  await fireEvent.click(getByRole('button', { name: 'Edit definition' }));
  await fireEvent.input(getByRole('textbox'), { target: { value: 'discarded' } });
  await fireEvent.keyDown(getByRole('textbox'), { key: 'Escape' });
  expect(queryByRole('textbox')).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(getByText('original')).toBeTruthy();
  await fireEvent.click(getByRole('button', { name: 'Edit definition' }));
  await fireEvent.input(getByRole('textbox'), { target: { value: 'first; second' } });
  await fireEvent.blur(getByRole('textbox'));
  await waitFor(() => expect(queryByRole('textbox')).toBeNull());
  expect(getByText('first; second')).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
