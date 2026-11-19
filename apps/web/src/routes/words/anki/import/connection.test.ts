import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import ImportPage from './+page.svelte';
import type { PageData } from './$types';

const data: PageData = {
  user: {
    id: 'reader',
    email: 'reader@example.com',
    displayName: null,
    role: 'user',
    emailVerified: true,
  },
  availableLanguages: [],
  addableLanguages: [],
  currentLanguage: null,
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it('reconnects on return after a successful connection and supports a manual retry', async () => {
  let online = true;
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const { action } = JSON.parse(String(init.body));
      calls.push(action);
      if (!online) throw new Error('Offline');
      const result = action === 'deckNames' ? ['Hindi'] : { permission: 'granted' };
      return Response.json({ result, error: null });
    }),
  );
  const mount = () => render(ImportPage, { params: {}, form: null, data });
  mount();
  expect(calls).toEqual([]);
  const connect = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Connect to Anki Desktop' }));
  await connect();
  await fireEvent.click(await screen.findByRole('checkbox', { name: 'Hindi' }));
  expect(calls).toEqual(['requestPermission', 'deckNames']);

  cleanup();
  mount();
  expect((await screen.findByRole<HTMLInputElement>('checkbox', { name: 'Hindi' })).checked).toBe(true);
  expect(calls.slice(2)).toEqual(['deckNames']);

  cleanup();
  online = false;
  mount();
  await screen.findByText('Could not reconnect to Anki Desktop. Open Anki and try again.');
  online = true;
  await connect();
  await screen.findByRole('checkbox', { name: 'Hindi' });
  expect(calls.slice(3)).toEqual(['deckNames', 'requestPermission', 'deckNames']);
});

it('shows unmatched headwords and only displays IDs from the Parhiba field', async () => {
  const parhibaId = 'cbec4099-ab06-475d-86cb-300e7d2da618';
  const results: Record<string, unknown> = {
    requestPermission: { permission: 'granted' },
    deckNames: ['Hindi'],
    findCards: [1, 2],
    cardsInfo: [
      {
        deckName: 'Hindi',
        type: 2,
        queue: 2,
        interval: 30,
        fields: { HindiDB_ID: { value: 'hi_retired' }, Lemma: { value: 'याद करना' } },
      },
      {
        deckName: 'Hindi',
        type: 2,
        queue: 2,
        interval: 30,
        fields: { Parhiba_ID: { value: parhibaId }, Lemma: { value: 'मदद करना' } },
      },
    ],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === '/api/v1/me/anki/import') {
        expect(JSON.parse(String(init.body)).entries).toEqual([
          { headword: 'याद करना', status: 'known' },
          { parhibaId, headword: 'मदद करना', status: 'known' },
        ]);
        return Response.json({
          matched: 0,
          changes: 0,
          unmatchedEntries: [
            { headword: 'याद करना', parhibaId: null },
            { headword: 'मदद करना', parhibaId },
          ],
          counts: { learning: 0, known: 0 },
        });
      }
      return Response.json({ result: results[JSON.parse(String(init.body)).action], error: null });
    }),
  );
  render(ImportPage, { params: {}, form: null, data });
  await fireEvent.click(screen.getByRole('button', { name: 'Connect to Anki Desktop' }));
  await fireEvent.click(await screen.findByRole('checkbox', { name: 'Hindi' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
  await fireEvent.click(await screen.findByText('2 entries without a dictionary match'));
  expect(screen.getByText('याद करना').closest('li')?.textContent?.trim()).toBe('याद करना');
  expect(screen.getByText('मदद करना').closest('li')?.textContent).toContain(parhibaId);
});
