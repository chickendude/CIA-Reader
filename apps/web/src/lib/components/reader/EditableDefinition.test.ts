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
  const field = getByRole('textbox') as HTMLTextAreaElement;
  expect(field.value).toBe('who, which\nwhoever');
  expect(await fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(queryByRole('button', { name: 'Save definition' })).toBeNull();
  expect(queryByRole('button', { name: 'Cancel' })).toBeNull();
  await fireEvent.input(getByRole('textbox', { name: 'Edit definition' }), {
    target: { value: ' who, which\n\nwhoever, whichever, whatever ' },
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
  const { queryByRole, getAllByRole } = render(EditableDefinition, {
    text: 'who, which; whoever',
    translationId: 'definition',
    lemmaId: 'pronoun',
    canEdit: false,
  });
  expect(queryByRole('button')).toBeNull();
  expect(queryByRole('textbox')).toBeNull();
  expect(getAllByRole('listitem').map((item) => item.textContent)).toEqual(['who, which', 'whoever']);
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
  expect(getByText('first')).toBeTruthy();
  expect(getByText('second')).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('adds a meaning with Enter in the bottom sheet and saves once with the check mark', async () => {
  const request = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', request);
  const view = render(EditableDefinition, {
    text: 'first', translationId: 'definition', lemmaId: 'noun', canEdit: true, sheet: true,
  });
  await fireEvent.click(view.getByRole('button', { name: 'Edit definition' }));
  const field = view.getByRole('textbox');
  expect(await fireEvent.keyDown(field, { key: 'Enter' })).toBe(true);
  await fireEvent.input(field, { target: { value: 'first\nsecond' } });
  await fireEvent.blur(field);
  expect(request).not.toHaveBeenCalled();
  await fireEvent.click(view.getByRole('button', { name: 'Save definition' }));
  await waitFor(() => expect(view.queryByRole('textbox')).toBeNull());
  expect(request).toHaveBeenCalledTimes(1);
  expect(JSON.parse(request.mock.calls[0]![1].body).body).toBe('first; second');
  expect(view.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['first', 'second']);
});

it('discards a sheet edit with the X and saves a subsequent edit on an outside click', async () => {
  const request = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', request);
  const view = render(EditableDefinition, {
    text: 'original', translationId: 'definition', lemmaId: 'noun', canEdit: true, sheet: true,
  });
  const edit = () => fireEvent.click(view.getByRole('button', { name: 'Edit definition' }));
  await edit();
  await fireEvent.input(view.getByRole('textbox'), { target: { value: 'discard' } });
  await fireEvent.click(view.getByRole('button', { name: 'Cancel definition changes' }));
  expect(view.queryByRole('textbox')).toBeNull();
  expect(view.getByText('original')).toBeTruthy();
  expect(request).not.toHaveBeenCalled();

  await edit();
  await fireEvent.input(view.getByRole('textbox'), { target: { value: 'first\nsecond' } });
  await fireEvent.click(document.body);
  await waitFor(() => expect(view.queryByRole('textbox')).toBeNull());
  expect(request).toHaveBeenCalledTimes(1);
  expect(JSON.parse(request.mock.calls[0]![1].body).body).toBe('first; second');
});
