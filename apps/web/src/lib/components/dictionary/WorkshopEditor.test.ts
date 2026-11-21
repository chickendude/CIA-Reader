import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyDraft } from '$lib/dictionary/workshop';
import { workshop } from '$lib/dictionary/workshop-client';
import WorkshopEditor from './WorkshopEditor.svelte';

vi.mock('$lib/dictionary/workshop-client', () => ({ workshop: vi.fn() }));
afterEach(cleanup);

it('keeps a hidden headword editable and saves the spelling without its marker', async () => {
  const draft = { ...emptyDraft('क़ब्ज़ा'), alternatives: ['कब्जा'], hiddenAlternatives: ['कब्जा'] };
  vi.mocked(workshop).mockImplementation(async (action) =>
    action === 'patterns' ? [] : { forms: {}, draft });
  render(WorkshopEditor, {
    language: 'hi', word: { draft, external: '', uses: [], group: [], evidence: [] },
    draft, working: false, observed: '', review: false, onsaved: vi.fn(), onopen: vi.fn(),
  });
  const input = screen.getByRole('textbox', { name: 'Alternative headwords' }) as HTMLInputElement;
  expect(input.value).toBe('.कब्जा');
  await fireEvent.change(input, { target: { value: 'कब्जा, .कब्ज़ा' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(workshop).toHaveBeenCalledWith('save', { draft: expect.objectContaining({
    alternatives: ['कब्जा', 'कब्ज़ा'], hiddenAlternatives: ['कब्ज़ा'],
  }) }, undefined, 'hi');
});

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
