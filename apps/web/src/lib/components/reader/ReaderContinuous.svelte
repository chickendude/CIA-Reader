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
  import { onMount, tick, untrack } from 'svelte';

  import ChapterBody from './ChapterBody.svelte';
  import {
    LazyTokenLoader,
    type ChapterTokenFetcher,
    type ChapterTokensResponse,
  } from './lazy-tokens.js';
  import type { ProgressAnchor } from './progress-client.js';
  import {
    computePctRead,
    findFirstVisibleWordAnchor,
    findTokenElementAtOrAfter,
    readableRect,
    readerTopInset,
  } from './reader-progress.js';
  import type { ChapterView } from './types.js';

  let {
    chapters,
    initialChapterIdx = 0,
    initialTokenIdx = 0,
    showRomanization = false,
    isOwner = false,
    textId,
    language,
    onProgress,
    /** Override hook for tests — defaults to a real fetch when omitted. */
    fetcher,
  }: {
    chapters: ChapterView[];
    initialChapterIdx?: number;
    initialTokenIdx?: number;
    showRomanization?: boolean;
    isOwner?: boolean;
    textId: string;
    language: import('@ciareader/shared-types').LanguageCode;
    onProgress?: (anchor: ProgressAnchor) => void;
    fetcher?: ChapterTokenFetcher;
  } = $props();

  // Map of chapterIdx → fetched body + tokens + phrase spans. SSR
  // only includes the active chapter's body, so siblings hydrate
  // their text on demand. Seeded with the initial chapter so re-
  // renders don't trigger an unnecessary network round-trip for
  // the chapter we already have. T-14.3: phraseSpans rides on the
  // same fetch so a sibling chapter scrolled into view repaints
  // with phrase highlights on the next $derived pass.
  let lazyChapters = $state(
    new Map<
      number,
      Pick<ChapterTokensResponse, 'body' | 'tokens' | 'phraseSpans'>
    >(),
  );

  const loader = $derived(new LazyTokenLoader(textId, fetcher));

  // The chapter views handed to ChapterBody — sibling chapters get
  // their tokens patched in once the lazy loader resolves them.
  const renderedChapters = $derived.by(() => {
    return chapters.map((c) => {
      if (c.tokens != null && c.body != null) return c;
      const fetched = lazyChapters.get(c.idx);
      if (fetched === undefined) return c;
      return {
        ...c,
        body: fetched.body,
        tokens: fetched.tokens,
        phraseSpans: fetched.phraseSpans,
      };
    });
  });

  function ensureChapter(chapterIdx: number) {
    // Skip when the chapter already shipped tokens (active chapter)
    // or we've already fetched / are fetching this idx.
    const existing = chapters.find((c) => c.idx === chapterIdx);
    if (!existing || existing.tokens != null) return;
    if (lazyChapters.has(chapterIdx)) return;
    void loader
      .load(chapterIdx)
      .then((chapter) => {
        const next = new Map(untrack(() => lazyChapters));
        next.set(chapterIdx, {
          body: chapter.body,
          tokens: chapter.tokens,
          phraseSpans: chapter.phraseSpans,
        });
        lazyChapters = next;
      })
      .catch(() => {
        // Swallow — the chapter still renders via the whitespace
        // fallback, just without lemma colouring. A retry happens
        // automatically the next time the observer trips because
        // we never wrote to `lazyChapters`.
      });
  }

  let sectionRefs: Map<number, HTMLElement> = new Map();
  let rootEl: HTMLElement | null = $state(null);
  let lastReportedKey = '';
  let reportRaf = 0;
  let initialAnchorApplied = $state(false);
  const isRestoringInitialAnchor = $derived(
    (initialChapterIdx > 0 || initialTokenIdx > 0) && !initialAnchorApplied,
  );

  function bindSection(node: HTMLElement, idx: number) {
    sectionRefs.set(idx, node);
    return {
      destroy() {
        sectionRefs.delete(idx);
      },
    };
  }

  function scrollToInitialAnchor() {
    const section = sectionRefs.get(initialChapterIdx);
    if (!section) {
      initialAnchorApplied = true;
      return;
    }
    const tokenEl =
      initialTokenIdx > 0 ? findTokenElementAtOrAfter(section, initialTokenIdx) : null;
    const target = tokenEl ?? section;
    const rect = target.getBoundingClientRect();
    window.scrollTo({
      top: Math.max(0, window.scrollY + rect.top - readerTopInset()),
      behavior: 'auto',
    });
    initialAnchorApplied = true;
  }

  function isAtDocumentEnd(): boolean {
    const doc = document.documentElement;
    return window.scrollY + window.innerHeight >= doc.scrollHeight - 2;
  }

  function reportProgress() {
    reportRaf = 0;
    if (!onProgress || !rootEl) return;
    const anchor = findFirstVisibleWordAnchor(rootEl, {
      clip: readableRect(rootEl),
      minVisiblePx: 4,
    });
    if (!anchor) return;
    const next: ProgressAnchor = {
      ...anchor,
      pctRead: computePctRead(chapters, anchor.chapterIdx, anchor.tokenIdx, {
        completedText: isAtDocumentEnd(),
      }),
    };
    const key = `${next.chapterIdx}:${next.tokenIdx}:${next.pctRead}`;
    if (key === lastReportedKey) return;
    lastReportedKey = key;
    onProgress(next);
  }

  function queueProgressReport() {
    if (reportRaf) return;
    reportRaf = window.requestAnimationFrame(reportProgress);
  }

  onMount(() => {
    void tick().then(() => {
      scrollToInitialAnchor();
      queueProgressReport();
    });
    window.addEventListener('scroll', queueProgressReport, { passive: true });
    window.addEventListener('resize', queueProgressReport);

    if (typeof IntersectionObserver === 'undefined') {
      // jsdom / SSR fallback: prefetch every chapter eagerly so the
      // experience degrades gracefully (still better than the old
      // load-everything-server-side behavior because each chapter
      // ships in its own JSON response and Postgres roundtrip).
      for (const c of chapters) ensureChapter(c.idx);
      return () => {
        window.removeEventListener('scroll', queueProgressReport);
        window.removeEventListener('resize', queueProgressReport);
        if (reportRaf) window.cancelAnimationFrame(reportRaf);
      };
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
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', queueProgressReport);
      window.removeEventListener('resize', queueProgressReport);
      if (reportRaf) window.cancelAnimationFrame(reportRaf);
    };
  });

  $effect(() => {
    void renderedChapters;
    void showRomanization;
    void tick().then(queueProgressReport);
  });
</script>

<div
  class="reader-continuous"
  data-mode="continuous"
  data-initial-chapter={initialChapterIdx}
  data-restoring={isRestoringInitialAnchor ? '1' : undefined}
  bind:this={rootEl}
>
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
  .reader-continuous[data-restoring='1'] {
    opacity: 0;
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
