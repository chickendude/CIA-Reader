<!--
  Continuous reading mode (T-5.1, token-aware in T-5.2, lazy chapter
  loading in T-5.1a).

  Renders every chapter stacked vertically. Token rendering is
  delegated to <ChapterBody/> so all three modes use the same
  status/OOV/ambiguous logic.

  T-5.1a: only the active chapter ships with server-rendered tokens
  on first paint. Sibling chapters are fetched on demand via an
  IntersectionObserver — when a section comes within ~600px of the
  viewport we kick off a fetch and merge the result back into the
  ChapterView so the next render colours the lemmas. While the fetch
  is in flight (or before the observer fires) the chapter's body
  still renders via the whitespace fallback, so the text is always
  readable.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';

  import ChapterBody from './ChapterBody.svelte';
  import { LazyTokenLoader, type ChapterTokenFetcher } from './lazy-tokens.js';
  import type { ChapterView, ServerToken } from './types.js';

  let {
    chapters,
    initialChapterIdx = 0,
    showRomanization = false,
    isOwner = false,
    textId,
    language,
    /** Override hook for tests — defaults to a real fetch when omitted. */
    fetcher,
  }: {
    chapters: ChapterView[];
    initialChapterIdx?: number;
    showRomanization?: boolean;
    isOwner?: boolean;
    textId: string;
    language: import('@ciareader/shared-types').LanguageCode;
    fetcher?: ChapterTokenFetcher;
  } = $props();

  // Map of chapterIdx → fetched tokens (or `null` if the worker
  // hasn't run for that chapter — same fallback as the SSR path).
  // Seeded with the initial chapter so re-renders don't trigger an
  // unnecessary network round-trip for the chapter we already have.
  let lazyTokens = $state(new Map<number, ServerToken[] | null>());

  const loader = $derived(
    new LazyTokenLoader(textId, fetcher),
  );

  // The chapter views handed to ChapterBody — sibling chapters get
  // their tokens patched in once the lazy loader resolves them.
  const renderedChapters = $derived.by(() => {
    return chapters.map((c) => {
      if (c.tokens != null) return c;
      const fetched = lazyTokens.get(c.idx);
      if (fetched === undefined) return c;
      return { ...c, tokens: fetched };
    });
  });

  function ensureChapter(chapterIdx: number) {
    // Skip when the chapter already shipped tokens (active chapter)
    // or we've already fetched / are fetching this idx.
    const existing = chapters.find((c) => c.idx === chapterIdx);
    if (!existing || existing.tokens != null) return;
    if (lazyTokens.has(chapterIdx)) return;
    void loader
      .load(chapterIdx)
      .then((tokens) => {
        const next = new Map(untrack(() => lazyTokens));
        next.set(chapterIdx, tokens);
        lazyTokens = next;
      })
      .catch(() => {
        // Swallow — the chapter still renders via the whitespace
        // fallback, just without lemma colouring. A retry happens
        // automatically the next time the observer trips because
        // we never wrote to `lazyTokens`.
      });
  }

  let sectionRefs: Map<number, HTMLElement> = new Map();
  function bindSection(node: HTMLElement, idx: number) {
    sectionRefs.set(idx, node);
    return {
      destroy() {
        sectionRefs.delete(idx);
      },
    };
  }

  onMount(() => {
    if (typeof IntersectionObserver === 'undefined') {
      // jsdom / SSR fallback: prefetch every chapter eagerly so the
      // experience degrades gracefully (still better than the old
      // load-everything-server-side behavior because each chapter
      // ships in its own JSON response and Postgres roundtrip).
      for (const c of chapters) ensureChapter(c.idx);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idxAttr = (entry.target as HTMLElement).dataset.chapterIdx;
          if (!idxAttr) continue;
          const idx = Number.parseInt(idxAttr, 10);
          if (Number.isFinite(idx)) ensureChapter(idx);
        }
      },
      { rootMargin: '600px 0px' },
    );
    for (const node of sectionRefs.values()) io.observe(node);
    return () => io.disconnect();
  });
</script>

<div class="reader-continuous" data-mode="continuous" data-initial-chapter={initialChapterIdx}>
  {#each renderedChapters as chapter (chapter.id)}
    <section
      id={`chapter-${chapter.idx}`}
      data-chapter-idx={chapter.idx}
      class:active={chapter.idx === initialChapterIdx}
      use:bindSection={chapter.idx}

    >
      {#if chapter.title || renderedChapters.length > 1}
        <h2>
          {chapter.title ?? `Chapter ${chapter.idx + 1}`}
          <span class="muted">({chapter.tokenCount.toLocaleString()} tokens)</span>
        </h2>
      {/if}
      <ChapterBody {chapter} {language} {showRomanization} {isOwner} />
    </section>
  {/each}
</div>

<style>
  .reader-continuous {
    max-width: var(--reader-col-width, 38rem);
    margin: 0 auto;
    padding: 1rem 1.25rem 4rem;
    font-family: var(--reader-font-family, var(--font-serif-dev, var(--font-serif)));
    font-size: var(--reader-font-size, 1.1rem);
    line-height: var(--reader-line-height, 2);
    color: var(--ink, var(--color-fg));
  }
  section {
    margin: 1.5rem 0;
  }
  h2 {
    font-size: 1.1rem;
    margin: 0 0 0.5rem;
  }
  .muted {
    color: var(--color-fg-muted);
    font-weight: 400;
    font-size: 0.85em;
    margin-left: 0.4rem;
  }
</style>
