import { normalizeHindiForm, type Draft } from '$lib/dictionary/hindi-workshop';
import { defaultFetcher } from './lazy-tokens.js';
import type { ChapterView, ServerToken } from './types.js';

/** Keep token identities and reading position while refreshing dictionary matches. */
export function dictionaryChapterTokens(
  chapter: () => ChapterView | undefined,
  textId: () => string,
  onRefresh: (lemmaId: string) => void,
) {
  let fresh = $state.raw<{ source: ChapterView; tokens: ServerToken[] }>();
  const tokens = () => fresh && fresh.source === chapter() ? fresh.tokens : chapter()?.tokens;
  $effect(() => {
    const source = chapter();
    const id = textId();
    if (!source?.tokens) return;
    let version = 0;
    const refresh = async (event: Event) => {
      const draft = (event as CustomEvent<Draft>).detail;
      const lemmaId = draft.id;
      const current = tokens();
      if (!lemmaId || !current) return;
      const forms = new Set([
        draft.lemma, ...draft.alternatives, ...draft.other,
        ...(draft.inventory?.slots.filter((s) => s.include).flatMap((s) => s.forms) ?? []),
      ]);
      for (const excluded of draft.excluded) forms.delete(excluded);
      const matches = (t: ServerToken) =>
        t.isWord && t.isOov && !t.lemmaId && forms.has(normalizeHindiForm(t.surface));
      if (!current.some((t) => t.lemmaId === lemmaId || matches(t))) return;

      // Another click can arrive before the chapter request returns.
      fresh = { source, tokens: current.map((t) => matches(t) ? {
        ...t, lemmaId, headword: draft.lemma, pos: draft.pos, isOov: false,
        glossDefault: draft.meaning || null, hasDefinition: !!draft.meaning,
      } : t) };
      onRefresh(lemmaId);
      const request = ++version;
      try {
        const result = await defaultFetcher(id, source.idx);
        if (request !== version || !result.tokens || result.chapterId !== source.id) return;
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
