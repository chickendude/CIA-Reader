import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyDraft } from '$lib/dictionary/hindi-workshop';
import { workshop } from '$lib/dictionary/workshop-client';
import WorkshopEditor from './WorkshopEditor.svelte';

vi.mock('$lib/dictionary/workshop-client', () => ({ workshop: vi.fn() }));
afterEach(cleanup);

it('shows HindiDB forms when the preview omits inflection slots', async () => {
  vi.mocked(workshop).mockResolvedValue({ forms: { घर: ['citation'], घरों: ['plural-oblique'] } });
  const draft = emptyDraft('घर');
  render(WorkshopEditor, {
    word: { draft, external: '', uses: [], group: [], evidence: [] },
    draft,
    working: false,
    ai: false,
    observed: '',
    review: false,
    onsaved: vi.fn(),
    onopen: vi.fn(),
    ondeleted: vi.fn(),
  });

  expect(await screen.findByRole('button', { name: 'घरों' })).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toBe('Inflection slot suggestions are unavailable.');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Fill from Wiktionary' }).disabled).toBe(true);
});
