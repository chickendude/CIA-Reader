import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import ContextChoiceButton from './ContextChoiceButton.svelte';
import type { ServerToken } from './types.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('confirms an AI choice and then lets a human confirmation be cleared', async () => {
  const token: ServerToken = {
    id: 'token',
    idx: 0,
    surface: 'एक',
    isWord: true,
    isAmbiguous: false,
    isOov: false,
    romanization: null,
    glossDefault: 'one (1), a',
    personalGloss: null,
    features: {},
    numberForms: null,
    status: 'unknown',
    lemmaId: 'number',
    headword: 'एक',
    pos: 'NUM',
    selectedBy: 'ai',
    canVerifyContext: true,
    contextVersion: 'version',
    candidates: [],
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ token: { ...token, selectedBy: 'human' } })));
  vi.stubGlobal('fetch', fetchMock);
  const rendered = render(ContextChoiceButton, {
    token,
    lemmaId: 'number',
    label: 'एक NUM',
    selectedBy: 'ai',
  });
  await fireEvent.click(rendered.getByRole('button'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(JSON.parse(fetchMock.mock.calls[0]![1].body).selectedLemmaIds).toEqual(['number']);
  await rendered.rerender({
    token: { ...token, selectedBy: 'human' },
    lemmaId: 'number',
    label: 'एक NUM',
    selectedBy: 'human',
  });
  await waitFor(() =>
    expect((rendered.getByRole('button') as HTMLButtonElement).disabled).toBe(false),
  );
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ token })));
  await fireEvent.click(rendered.getByRole('button'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetchMock.mock.calls[1]![1].body).selectedLemmaIds).toEqual([]);
});
