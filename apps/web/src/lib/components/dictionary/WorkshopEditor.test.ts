import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyDraft } from '$lib/dictionary/workshop';
import { workshop } from '$lib/dictionary/workshop-client';
import WorkshopEditor from './WorkshopEditor.svelte';

vi.mock('$lib/dictionary/workshop-client', () => ({ workshop: vi.fn() }));
afterEach(cleanup);

it('shows the pattern word list without a separate inflected forms section', async () => {
  vi.mocked(workshop).mockImplementation(async (action) => action === 'patterns' ? [] : { forms: { घर: ['citation'], घरों: ['plural-oblique'] } });
  const draft = emptyDraft('घर');
  render(WorkshopEditor, {
    language: 'hi',
    word: { draft, external: '', uses: [], group: [], evidence: [] },
    draft,
    working: false,
    observed: '',
    review: false,
    onsaved: vi.fn(),
    onopen: vi.fn(),
    ondeleted: vi.fn(),
  });

  expect(await screen.findByRole('button', { name: 'घरों' })).toBeTruthy();
  expect(screen.queryByText('Inflected forms')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Other forms' })).toBeTruthy();
});
