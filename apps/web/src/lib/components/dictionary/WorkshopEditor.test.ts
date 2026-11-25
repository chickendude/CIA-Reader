import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyDraft } from '$lib/dictionary/workshop';
import { workshop } from '$lib/dictionary/workshop-client';
import WorkshopEditor from './WorkshopEditor.svelte';

vi.mock('$lib/dictionary/workshop-client', () => ({ workshop: vi.fn() }));
afterEach(cleanup);

it('leaves Enter available for another meaning and saves both meanings with Ctrl+S', async () => {
  const draft = { ...emptyDraft('साथ छोड़ना', 'VERB'), meaning: 'to leave' };
  const word = { draft, external: '', uses: [], group: [], evidence: [] };
  const saved = vi.fn();
  vi.mocked(workshop).mockImplementation(async (action) => action === 'patterns' ? [] : word);
  render(WorkshopEditor, {
    language: 'hi', word, draft, working: false, observed: '', review: false,
    onsaved: saved, onopen: vi.fn(),
  });

  const meaning = screen.getByRole('textbox', { name: 'English meaning' });
  meaning.focus();
  expect(await fireEvent.keyDown(meaning, { key: 'Enter' })).toBe(true);
  await fireEvent.input(meaning, { target: { value: 'to leave\nto abandon' } });
  expect(saved).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(meaning);

  expect(await fireEvent.keyDown(meaning, { key: 's', ctrlKey: true })).toBe(false);
  expect(saved).toHaveBeenCalledTimes(1);
  expect(workshop).toHaveBeenCalledWith('save', {
    draft: expect.objectContaining({ meaning: 'to leave; to abandon' }),
  }, undefined, 'hi');
});

it('keeps a hidden headword editable and saves the spelling without its marker', async () => {
  const draft = { ...emptyDraft('अलग-अलग', 'ADJ'), alternatives: ['अलग अलग'], hiddenAlternatives: ['अलग अलग'] };
  vi.mocked(workshop).mockImplementation(async (action) =>
    action === 'patterns' ? [] : { forms: {}, draft });
  render(WorkshopEditor, {
    language: 'hi', word: { draft, external: '', uses: [], group: [], evidence: [] },
    draft, working: false, observed: '', review: false, onsaved: vi.fn(), onopen: vi.fn(),
  });
  const input = screen.getByRole('textbox', { name: 'Alternative headwords' }) as HTMLInputElement;
  expect(input.value).toBe('.अलग अलग');
  await fireEvent.input(input, { target: { value: 'अलग अलग, .alag ' } });
  expect(input.value).toBe('अलग अलग, .alag ');
  await fireEvent.input(input, { target: { value: 'अलग अलग, .alag alag' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(workshop).toHaveBeenCalledWith('save', { draft: expect.objectContaining({
    alternatives: ['अलग अलग', 'alag alag'], hiddenAlternatives: ['alag alag'],
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
