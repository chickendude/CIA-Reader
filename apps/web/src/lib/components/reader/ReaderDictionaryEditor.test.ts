import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { blankWorkshopWord } from '$lib/dictionary/hindi-workshop';
import { workshop } from '$lib/dictionary/workshop-client';
import ReaderDictionaryEditor from './ReaderDictionaryEditor.svelte';
import type { ServerToken } from './types';

vi.mock('$lib/dictionary/workshop-client', () => ({ workshop: vi.fn() }));

const token: ServerToken = {
  id: 'missing',
  idx: 1,
  surface: 'खोजियों',
  isWord: true,
  isOov: true,
  lemmaId: null,
  isAmbiguous: false,
  romanization: null,
  features: {},
  candidates: [],
  status: 'unknown',
  numberForms: null,
  glossDefault: null,
  personalGloss: null,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('keeps the observed form and context when attaching it to an existing headword', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const existing = blankWorkshopWord('खोजी');
  Object.assign(existing.draft, {
    id: 'existing',
    version: 'v1',
    meaning: 'seeker',
    paradigm: 'noun_m_ii',
  });
  const saved = vi.fn();
  vi.mocked(workshop).mockImplementation(async (action) => {
    if (action === 'search')
      return [{ id: 'existing', lemma: 'खोजी', pos: 'NOUN', meaning: 'seeker' }];
    if (action === 'preview') return { forms: { खोजी: [], खोजियों: [] } };
    return existing;
  });

  render(ReaderDictionaryEditor, {
    token,
    chapterTokens: [
      { ...token, idx: 0, surface: 'इन ' },
      token,
      { ...token, idx: 2, surface: ' ने कहा।' },
    ],
    lemmaId: null,
    headword: token.surface,
    ai: false,
    onClose: vi.fn(),
    onSaved: saved,
  });
  const form = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Dictionary form' });
  expect(form.value).toBe('खोजियों');
  await fireEvent.input(form, { target: { value: 'खोजी' } });
  const prompt = new URL(
    screen.getByRole<HTMLAnchorElement>('link', { name: 'Ask ChatGPT ↗' }).href,
  );
  expect(prompt.searchParams.get('q')).toContain('【खोजियों】');
  expect(prompt.searchParams.get('q')).toContain('इन खोजियों ने कहा।');
  await fireEvent.click(await screen.findByRole('button', { name: 'खोजी NOUN seeker' }));
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLTextAreaElement>('English meaning').value).toBe('seeker'),
  );
  expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Masculine ई' }).checked).toBe(true);
  await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(workshop).toHaveBeenCalledWith('save', {
    draft: expect.objectContaining({
      id: 'existing',
      version: 'v1',
      other: ['खोजियों'],
      meaning: 'seeker',
    }),
  });
});
