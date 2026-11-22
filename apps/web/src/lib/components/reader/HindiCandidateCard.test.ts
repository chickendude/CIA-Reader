import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import HindiCandidateCard from './HindiCandidateCard.svelte';
import type { ServerToken } from './types.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('marks the alternate entry independently and numbers its meanings', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const onStatusChange = vi.fn();
  const token = { id: 'token', idx: 3, chapterId: 'chapter', lemmaId: 'adjective' } as ServerToken;
  const { getByRole, getAllByRole } = render(HindiCandidateCard, {
    candidate: {
      lemmaId: 'noun',
      headword: 'हिंदी',
      pos: 'NOUN',
      glossDefault: 'an Indian; a person of India',
      score: 1,
      features: {},
      status: 'unknown',
    },
    token,
    isOwner: true,
    onStatusChange,
  });
  expect(getAllByRole('listitem').map((item) => item.textContent)).toEqual(['an Indian', 'a person of India']);
  await fireEvent.click(getByRole('button', { name: 'Known' }));
  await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith('noun', 'known'));
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/v1/me/known-lemmas/noun')).toBe(true);
  expect(token.lemmaId).toBe('adjective');
});
