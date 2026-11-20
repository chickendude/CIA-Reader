import { dictionaryProfile } from '$lib/dictionary/profiles';
import type { LanguageCode } from '@ciareader/shared-types';
import { type Draft } from '$lib/dictionary/workshop';
import { defaultFetcher } from './lazy-tokens.js';
import type { ChapterView, ServerToken } from './types.js';

/** Keep token identities and reading position while refreshing dictionary matches. */
export function dictionaryChapterTokens(
  chapter: () => ChapterView | undefined,
  textId: () => string,
  language: () => LanguageCode,
  onRefresh: (lemmaId: string) => void,
) {
  const chapterId = $derived(chapter()?.id);
  const chapterIdx = $derived(chapter()?.idx);
  const original = $derived(chapter()?.tokens);
  let fresh = $state.raw<{ source: ServerToken[]; tokens: ServerToken[] }>();
  const tokens = () => fresh && fresh.source === original ? fresh.tokens : original;
  $effect(() => {
    const source = original;
    const idx = chapterIdx;
    const expectedId = chapterId;
    const id = textId();
    const code = language();
    const profile = dictionaryProfile(code);
    const spellingKey = (s: string) => profile.caseSensitive ? profile.normalize(s) : profile.normalize(s).toLowerCase();
    if (!source || idx === undefined) return;
    let version = 0;
    const refresh = async (event: Event) => {
      const draft = (event as CustomEvent<Draft>).detail;
      const lemmaId = draft.id;
      const current = tokens();
      if (!lemmaId || !current) return;
      const forms = new Set([
        draft.lemma, ...draft.alternatives, ...draft.other,
        ...(draft.inventory?.slots.filter((s) => s.include).flatMap((s) => s.forms) ?? []),
      ].map(spellingKey));
      for (const excluded of draft.excluded) forms.delete(spellingKey(excluded));
      const matches = (t: ServerToken) =>
        t.isWord && t.isOov && !t.lemmaId && forms.has(spellingKey(t.surface));
      if (!current.some((t) => t.lemmaId === lemmaId || matches(t))) return;

      // Another click can arrive before the chapter request returns.
      fresh = { source, tokens: current.map((t) => matches(t) ? {
        ...t, lemmaId, headword: draft.lemma, pos: draft.pos, isOov: false,
        glossDefault: draft.meaning || null, hasDefinition: !!draft.meaning,
      } : t) };
      onRefresh(lemmaId);
      const request = ++version;
      try {
        const result = await defaultFetcher(id, idx);
        if (request !== version || !result.tokens || result.chapterId !== expectedId) return;
        fresh = { source, tokens: result.tokens };
        onRefresh(lemmaId);
      } catch {
        // Keep the saved match if the viewer's chapter data could not be refreshed.
      }
    };
    window.addEventListener('reader-dictionary-saved', refresh);
    return () => {
      version++;
      window.removeEventListener('reader-dictionary-saved', refresh);
    };
  });
  return tokens;
}
