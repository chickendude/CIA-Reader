import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { blankWorkshopWord, type Draft } from '$lib/dictionary/workshop';
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
    excerpts: [{ url: '', original: 'खोजी', english: 'seeker' }],
    paradigm: 'noun_m_ii',
  });
  const saved = vi.fn();
  vi.mocked(workshop).mockImplementation(async (action, fields) => {
    if (action === 'patterns') return [];
    if (action === 'search')
      return [{ id: 'existing', lemma: 'खोजी', pos: 'NOUN', meaning: 'seeker' }];
    if (action === 'preview') {
      const draft = fields.draft as Draft;
      return { forms: Object.fromEntries([draft.lemma, ...draft.other].map((form) => [form, []])) };
    }
    if (action === 'save') existing.draft = JSON.parse(JSON.stringify(fields.draft));
    return existing;
  });

  const props = {
    language: 'hi' as const,
    token,
    chapterTokens: [
      { ...token, idx: 0, surface: 'इन ' },
      token,
      { ...token, idx: 2, surface: ' ने कहा।' },
    ],
    lemmaId: null,
    headword: token.surface,
    onClose: vi.fn(),
    onSaved: saved,
  };
  const editor = render(ReaderDictionaryEditor, props);
  const form = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Dictionary form' });
  expect(form.value).toBe('खोजियों');
  expect(screen.queryByText('Dictionary lookup')).toBeNull();
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
  const other = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Other forms' });
  expect(other.value).toBe('खोजियों');
  const typed = 'खोजियों, खोजी लोग, खोजी लोग,  ,\nखोजिए';
  other.focus();
  await fireEvent.input(other, { target: { value: typed } });
  expect(other.value).toBe(typed);
  expect(await screen.findByRole('button', { name: 'खोजी लोग' })).toBeTruthy();
  await fireEvent.keyDown(other, { key: 's', ctrlKey: true });
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(workshop).toHaveBeenCalledWith('save', {
    draft: expect.objectContaining({
      id: 'existing',
      version: 'v1',
      other: ['खोजियों', 'खोजी लोग', 'खोजिए'],
      meaning: 'seeker',
      excerpts: existing.draft.excerpts,
    }),
  }, undefined, 'hi');
  editor.unmount();
  render(ReaderDictionaryEditor, { ...props, lemmaId: existing.draft.id });
  expect((await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Other forms' })).value)
    .toBe('खोजियों, खोजी लोग, खोजिए');
});
