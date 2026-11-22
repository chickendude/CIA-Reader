<!--
  Handle word interactions once per chapter. Hover reads the saved word details. Clicking opens
  the full dictionary entry.
-->
<script lang="ts">
  import { looksLikeNumberToken, withLemmaCorrection } from './types.js';
  import { seekAudioForToken } from './audio-bus.js';
  import TokenSpan from './TokenSpan.svelte';
  import { wordReturnOutline } from './word-return-outline';
  import { isIgnoredHere, readerOccurrenceIgnores } from './ignored-occurrences';
  import WordPopup from './WordPopup.svelte';
  import WordTooltip from './WordTooltip.svelte';
  import { joinDictionaryEntries } from './joined-tokens.js';
  import { dictionaryChapterTokens } from './dictionary-chapter.svelte.js';
  import { WordPreview } from './word-preview.svelte.js';
  import CorrectionToast from './CorrectionToast.svelte';
  import { LongPressDetector } from './touch-gestures.js';
  import { LANGUAGES, type LanguageCode } from '@ciareader/shared-types';
  import {
    groupPendingSegments,
    paragraphsOfServerTokens,
    paragraphsOfTokens,
    segmentParagraphPhrases,
    statusToCode,
    tokenize,
    type ChapterPhraseSpan,
    type ChapterView,
    type ParagraphSegment,
    type ServerToken,
  } from './types.js';
  import { validatePhraseSelection } from './phrase-selection.js';

  let {
    chapter,
    language,
    showRomanization = false,
    isOwner = false,
    isAdmin = false,
    textId,
    pageImage = null,
    onLookupChange,
  }: {
    chapter: ChapterView;
    /** drives the CorrectionModal's dictionary-search
     *  language + script. */
    language: LanguageCode;
    showRomanization?: boolean;
    isOwner?: boolean;
    isAdmin?: boolean;
    /** Owning text id — drives the popup's book-wide frequency lookup. */
    textId: string;
    /** PDF image reader: when set, render the page image with clickable
     *  word hotspots (positioned by each token's bbox) instead of
     *  reflowed text. All the popup / known-words machinery below is
     *  reused — the hotspots carry `data-token-id` so `onChapterClick`
     *  and the hover tooltip work unchanged. */
    pageImage?: { url: string; width: number | null; height: number | null } | null;
    onLookupChange?: (open: boolean) => void;
  } = $props();

  // Text direction comes from the shared registry (rtl for Yiddish's
  // Hebrew script). Set as a `dir` attribute on the chapter wrapper so
  // paragraph flow, alignment, and punctuation placement all follow
  // the script — every reader mode renders through this component, so
  // this is the single switch for RTL reading.
  const textDirection = $derived(LANGUAGES[language].textDirection);
  const occurrenceIgnores = readerOccurrenceIgnores();

  // Local override map: lemmaId → user's most recent status. The
  // popup's optimistic update writes through here so every other
  // token tied to the same lemma flips its highlight in real time
  // (the next page load reflects the same state via the loader).
  let statusOverrides = $state(new Map<string, ServerToken['status']>());
  let definitionOverrides = $state(new Map<string, string>());
  let contextOverrides = $state(new Map<string, ServerToken>());
  $effect(() => {
    const update = (event: Event) => {
      const next = (event as CustomEvent<ServerToken>).detail;
      if (next.chapterId !== chapter.id) return;
      contextOverrides = new Map(contextOverrides).set(next.id,next);
      const corrections = new Map(lemmaCorrections); corrections.delete(next.id); lemmaCorrections = corrections;
      if (activeToken?.id === next.id) activeToken = tokensById.get(next.id) ?? next;
      if (preview.token?.id === next.id) preview.token = tokensById.get(next.id) ?? next;
    };
    window.addEventListener('hindi-context-choice-changed',update);
    return () => window.removeEventListener('hindi-context-choice-changed',update);
  });
  $effect(() => {
    const update = (event: Event) => {
      const { lemmaId, body } = (event as CustomEvent<{ lemmaId: string; body: string }>).detail;
      definitionOverrides = new Map(definitionOverrides).set(lemmaId, body);
    };
    window.addEventListener('dictionary-definition-changed', update);
    return () => window.removeEventListener('dictionary-definition-changed', update);
  });

  // Show the reader's choice immediately. On the next visit the chapter loader reads the saved
  // correction.
  let lemmaCorrections = $state(new Map<string, string>());
  // Mirror of personal-translation edits made in the popup so the
  // hover tooltip refreshes without a chapter reload. Value is the
  // new primary personal body, or null when the viewer has just
  // deleted their last one for this lemma. Keys with a `null` value
  // mean "override to no personal gloss"; absent keys defer to the
  // server-side payload.
  let personalGlossOverrides = $state(
    new Map<string, string | null>(),
  );

  // Apply any pending optimistic status flips to the token list
  // before paragraph splitting so the .status-* classes update live.
  const dictionaryTokens = dictionaryChapterTokens(() => chapter, () => textId, () => language, (lemmaId) => {
    const selected = activeToken && tokensById.get(activeToken.id);
    if (selected && (selected.lemmaId === lemmaId || activeToken?.lemmaId === lemmaId)) activeToken = selected;
    const hovered = preview.token && tokensById.get(preview.token.id);
    if (hovered && (hovered.lemmaId === lemmaId || preview.token?.lemmaId === lemmaId)) preview.token = hovered;
  });
  const readings = $derived.by(() => {
    const tokens = dictionaryTokens();
    if (!tokens) return null;
    if (
      statusOverrides.size === 0 && definitionOverrides.size === 0 && contextOverrides.size === 0 &&
      lemmaCorrections.size === 0 &&
      personalGlossOverrides.size === 0
    ) {
      return tokens;
    }
    return tokens.map((t) => {
      t = contextOverrides.get(t.id) ?? t;
      let next = withLemmaCorrection(t, lemmaCorrections.get(t.id));
      if (next.lemmaId && statusOverrides.has(next.lemmaId)) {
        next = { ...next, status: statusOverrides.get(next.lemmaId)! };
      }
      if (next.lemmaId && personalGlossOverrides.has(next.lemmaId)) {
        next = {
          ...next,
          personalGloss: personalGlossOverrides.get(next.lemmaId) ?? null,
        };
      }
      if (next.lemmaId && definitionOverrides.has(next.lemmaId)) {
        next = { ...next, glossDefault: definitionOverrides.get(next.lemmaId) ?? null };
      }
      next = { ...next, candidates: next.candidates.map((candidate) => ({
        ...candidate,
        glossDefault: definitionOverrides.get(candidate.lemmaId) ?? candidate.glossDefault,
        status: statusOverrides.get(candidate.lemmaId) ?? candidate.status,
        personalGloss: personalGlossOverrides.has(candidate.lemmaId)
          ? personalGlossOverrides.get(candidate.lemmaId) ?? null : candidate.personalGloss,
      })) };
      return next;
    });
  });

  const tokensWithOverrides = $derived(readings && joinDictionaryEntries(readings));
  const serverParagraphs = $derived(
    tokensWithOverrides ? paragraphsOfServerTokens(tokensWithOverrides) : null,
  );
  const fallbackParagraphs = $derived(
    chapter.tokens || chapter.body == null
      ? null
      : paragraphsOfTokens(tokenize(chapter.body)),
  );

  // Show the longest phrase when matches overlap. Keep the shorter phrases as alternatives.
  const phraseSpans = $derived(chapter.phraseSpans ?? []);
  const segmentedParagraphs = $derived.by(() => {
    if (!serverParagraphs) return null;
    return serverParagraphs.map((paragraph) =>
      segmentParagraphPhrases(paragraph, phraseSpans),
    );
  });
  // Map from phraseId to its rendered span — used by the popup
  // when the user clicks a token inside a phrase wrapper.
  const phraseSpanById = $derived.by(() => {
    const map = new Map<string, ChapterPhraseSpan>();
    for (const s of phraseSpans) {
      const existing = map.get(s.phraseId);
      // The same phrase may appear multiple times in a chapter;
      // any occurrence is sufficient for the popup header (which
      // surfaces phrase-level metadata, not occurrence-specific
      // info).
      if (!existing) map.set(s.phraseId, s);
    }
    return map;
  });

  // Lookup helper — server tokens are keyed by id.
  const tokensById = $derived.by(() => {
    if (!tokensWithOverrides) return new Map<string, ServerToken>();
    return new Map(tokensWithOverrides.map((t) => [t.id, t]));
  });

  // PDF image reader: word tokens that carry a bounding box, rendered as
  // absolutely-positioned hotspots over the page image.
  const overlayTokens = $derived.by(() => {
    if (!pageImage || !tokensWithOverrides) return [];
    return tokensWithOverrides.filter((t) => t.isWord && t.bbox);
  });
  const pageAspect = $derived(
    pageImage && pageImage.width && pageImage.height
      ? `${pageImage.width} / ${pageImage.height}`
      : null,
  );

  // Click → side panel (locked until closed). Hover → tooltip
  // (transient). Click and hover are independent so the side panel
  // doesn't change as you graze other words with the cursor.
  let activeToken = $state<ServerToken | null>(null);
  let activeRect = $state<{
    top: number;
    left: number;
    bottom: number;
    right: number;
  } | null>(null);
  let activePhrase = $state<ChapterPhraseSpan | null>(null);
  // pending phrase-create selection. Set when the user
  // shift-clicks a token that's at least 2 tokens away from the
  // anchor — the popup opens in create mode showing the
  // surfaces and a Save/Cancel pair. Cleared on close.
  type PendingPhraseSelection = {
    language: import('@ciareader/shared-types').LanguageCode;
    surfaces: string[];
    /** Span of `text_tokens.idx` for the selection, inclusive. */
    rangeIdx: { start: number; end: number };
  };
  let pendingSelection = $state<PendingPhraseSelection | null>(null);
  let selectionError = $state<string | null>(null);

  // while the user is constructing a phrase via shift-
  // click, bracket the contiguous run of segments whose tokens
  // fall inside the proposed range under a single `pending` group.
  // The renderer wraps that group in a `<phrase>`-like element so
  // the highlight reads as one continuous pill including the
  // whitespace between words — a per-token `.pending` class would
  // leave gaps where the spaces sit. With no pending selection,
  // every segment passes through as plain.
  const displayParagraphs = $derived.by(() => {
    if (!segmentedParagraphs) return null;
    const range = pendingSelection?.rangeIdx ?? null;
    return segmentedParagraphs.map((paragraph) =>
      groupPendingSegments(paragraph, range),
    );
  });

  // Show the selected words together while the reader creates a phrase. Looking up the first word
  // here would display the wrong translations.
  const popupToken = $derived.by<ServerToken | null>(() => {
    if (pendingSelection) {
      return {
        id: `pending:${pendingSelection.rangeIdx.start}-${pendingSelection.rangeIdx.end}`,
        idx: pendingSelection.rangeIdx.start,
        surface: pendingSelection.surfaces.join(' '),
        isWord: true,
        isAmbiguous: false,
        isOov: false,
        lemmaId: null,
        romanization: null,
        glossDefault: null,
        personalGloss: null,
        candidates: [],
        // Synthetic phrase token has no morphology features — the
        // popup's features-pill row is a no-op for this case.
        features: {},
        numberForms: null,
        status: 'unknown',
      };
    }
    return activeToken;
  });
  $effect(() => {
    onLookupChange?.(!!popupToken);
  });

  function findPhrase(target: HTMLElement | null): ChapterPhraseSpan | null {
    if (!target) return null;
    const wrapper = target.closest('[data-phrase-id]') as HTMLElement | null;
    if (!wrapper) return null;
    const phraseId = wrapper.getAttribute('data-phrase-id');
    if (!phraseId) return null;
    return phraseSpanById.get(phraseId) ?? null;
  }

  const preview = new WordPreview();

  function findToken(target: HTMLElement | null): {
    token: ServerToken;
    el: HTMLElement;
  } | null {
    if (!target) return null;
    const span = target.closest('[data-token-id]') as HTMLElement | null;
    if (!span) return null;
    const tokenId = span.getAttribute('data-token-id');
    if (!tokenId) return null;
    const token = tokensById.get(tokenId);
    if (!token || (!token.isWord && !token.numberForms && !looksLikeNumberToken(token.surface))) return null;
    return { token, el: span };
  }

  /**
   * build a pending phrase-create selection from the
   * range `[anchorIdx, targetIdx]`. Pure validation logic lives
   * in `phrase-selection.ts` so it can be unit-tested without
   * the Svelte component shell; this wrapper just adapts the
   * result to the popup's prop shape.
   */
  function buildPendingSelection(
    anchorIdx: number,
    targetIdx: number,
  ): PendingPhraseSelection | null {
    if (!tokensWithOverrides) return null;
    const result = validatePhraseSelection(
      tokensWithOverrides,
      anchorIdx,
      targetIdx,
    );
    if (result.kind === 'error') {
      selectionError = result.message;
      return null;
    }
    selectionError = null;
    return {
      language,
      surfaces: result.surfaces,
      rangeIdx: result.rangeIdx,
    };
  }

  // shift-click in a browser would otherwise extend the
  // native text selection from the previous caret position to the
  // click target, drawing the system selection colour over our
  // pending-phrase highlight. Suppressing the gesture on
  // mousedown — when there's already an anchor and the target is
  // a different word token — stops that selection from forming;
  // the regular `onChapterClick` still fires afterwards and
  // promotes the gesture into a phrase-create.
  function onChapterMousedown(event: MouseEvent) {
    if (!event.shiftKey || !activeToken) return;
    const found = findToken(event.target as HTMLElement);
    if (!found || found.token.id === activeToken.id) return;
    event.preventDefault();
  }

  function onChapterClick(event: MouseEvent) {
    const found = findToken(event.target as HTMLElement);
    if (!found) {
      // Clicking off a word clears the selection outline (and closes the
      // mobile sheet); the desktop side panel falls back to its empty state.
      closePopup();
      return;
    }

    if (longPressOpened) {
      longPressOpened = false;
      return;
    }
    if (preview.firstTap(event, found)) {
      closePopup();
      seekAudioForToken(found.token.id);
      return;
    }

    // shift-click range select. When the user clicks
    // a second token while holding shift and an existing
    // anchor (`activeToken`) is set, treat the pair as a
    // phrase-create selection. Falls through to the regular
    // single-token open when the validation fails (e.g. the
    // range crosses a sentence boundary or has only one word).
    if (event.shiftKey && activeToken && activeToken.id !== found.token.id) {
      const pending = buildPendingSelection(activeToken.idx, found.token.idx);
      if (pending) {
        pendingSelection = pending;
        // Position the popup at the *end* of the selected range
        // so the side panel feels anchored to the phrase.
        const rect = found.el.getBoundingClientRect();
        activeRect = {
          top: rect.top,
          left: rect.left,
          bottom: rect.bottom,
          right: rect.right,
        };
        // Keep the existing token / phrase open so the popup's
        // standard body still renders below the phrase-create
        // section. The user can compare the proposed phrase
        // against the underlying lemma.
        preview.close();
        return;
      }
      // selectionError is set inside buildPendingSelection;
      // surface it via the popup's existing error slot below.
      // Fall through to the regular click handling so the user
      // doesn't lose their click entirely.
    }

    const rect = found.el.getBoundingClientRect();
    activeToken = found.token;
    activeRect = {
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.right,
    };
    activePhrase = findPhrase(event.target as HTMLElement);
    // Clear any pending phrase-create state, a regular
    // click cancels the create flow.
    pendingSelection = null;
    // Hide the hover tooltip so it doesn't double up with the panel.
    preview.close();
    // tap-to-seek. If audio is loaded for this text and the
    // tapped token has an alignment row, seek the player to that
    // word's startMs and pause so the user can read at their own
    // pace. The popup stays open (it auto-pauses by definition —
    // the user is interacting with the side panel).
    seekAudioForToken(found.token.id);
  }

  // Accepts both MouseEvent (mouseover) and FocusEvent (focusin) so
  // the tooltip surfaces for pointer hovers AND keyboard tabbing.
  // We deliberately keep showing the tooltip for the locked word —
  // the user might want a quick re-read of the gloss without taking
  // their eyes off the chapter to read the side panel.
  function showHoverTooltip(event: Event) {
    if ('pointerType' in event && event.pointerType === 'touch') return;
    const found = findToken(event.target as HTMLElement);
    if (!found) {
      preview.close();
      return;
    }
    preview.show(found);
  }

  function hideHoverTooltip(event: Event) {
    if ('pointerType' in event && event.pointerType === 'touch') return;
    // Only clear if the cursor / focus genuinely leaves the chapter
    // region — moving between two adjacent words shouldn't flicker
    // the tooltip off and on.
    const related =
      'relatedTarget' in event ? (event.relatedTarget as HTMLElement | null) : null;
    if (related && (event.currentTarget as HTMLElement).contains(related)) {
      return;
    }
    if (related?.closest?.('[role=tooltip]')) return;
    preview.close();
  }

  function closePopup() {
    activeToken = null;
    activeRect = null;
    activePhrase = null;
    pendingSelection = null;
    selectionError = null;
  }

  async function onPhraseCreated(_phraseId: string) {
    void _phraseId;
    closePopup();
  }

  // long-press as a tap alternative on touch devices. A
  // 500ms hold over a word fires the same WordPopup the click
  // handler does. The detector cancels on movement so a scroll-y
  // touch never triggers a spurious popup.
  let longPressOpened = false;
  const longPress = new LongPressDetector((point) => {
    const target = document.elementFromPoint(point.x, point.y);
    const found = findToken(target as HTMLElement | null);
    if (!found) return;
    longPressOpened = true;
    const rect = found.el.getBoundingClientRect();
    activeToken = found.token;
    activeRect = {
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.right,
    };
    activePhrase = findPhrase(target as HTMLElement | null);
    preview.close();
  });

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) {
      longPress.cancel();
      return;
    }
    const t = e.touches[0]!;
    longPress.begin({ x: t.clientX, y: t.clientY });
  }
  function onTouchMove(e: TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    longPress.move({ x: t.clientX, y: t.clientY });
  }
  function onTouchEnd() {
    longPress.release();
  }

  function onStatusChange(
    lemmaId: string,
    status: ServerToken['status'],
  ) {
    // Mutate the override map; the $derived chain re-runs so every
    // other token tied to the same lemma flips its highlight too.
    const next = new Map(statusOverrides);
    next.set(lemmaId, status);
    statusOverrides = next;
  }

  function onPersonalTranslationChange(
    lemmaId: string,
    gloss: string | null,
  ) {
    const next = new Map(personalGlossOverrides);
    next.set(lemmaId, gloss);
    personalGlossOverrides = next;
  }

  // after a correction commits, surface a toast offering
  // bulk-apply across the rest of the chapter / text.
  let toastTokenId = $state<string | null>(null);

  function onCorrectionApplied(tokenId: string, chosenLemmaId: string | null) {
    const next = new Map(lemmaCorrections);
    if (chosenLemmaId == null) {
      // Clear the previous choice when the reader marks a token as something other than a word.
      next.delete(tokenId);
    } else {
      next.set(tokenId, chosenLemmaId);
    }
    lemmaCorrections = next;
    if (chosenLemmaId && activeToken?.id === tokenId) {
      activeToken = tokensById.get(tokenId) ?? activeToken;
    }
    toastTokenId = tokenId;
  }

  function applyEverywhereLocally(scope: 'same-context' | 'all-contexts') {
    void scope;
    // Other occurrences will show the saved correction the next time their chapter loads.
  }
  void applyEverywhereLocally; // referenced in toast onApplied wiring
</script>

{#snippet renderSegment(segment: ParagraphSegment)}{#if segment.kind === 'token'}<TokenSpan
      token={segment.token}
      {showRomanization}
      isAnchor={!pendingSelection && activeToken?.id === segment.token.id}
    />{:else}<phrase
      class="phrase"
      data-phrase-id={segment.span.phraseId}
      data-s={statusToCode(segment.span.status)}
      data-phrase-overlap={segment.overlaps.length > 0
        ? segment.overlaps.map((o) => o.phraseId).join(' ')
        : undefined}
      >{#each segment.tokens as token (token.id)}<TokenSpan
          {token}
          {showRomanization}
          isAnchor={!pendingSelection && activeToken?.id === token.id}
        />{/each}</phrase>{/if}{/snippet}

<!-- The hover tooltip is decorative chrome — keyboard / focus users get
     the full side panel via Enter on a focused word. mouseover/mouseout
     are paired with focusin/focusout (the bubbling versions of focus /
     blur) so the tooltip also appears for keyboard navigation. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  dir={textDirection}
  use:wordReturnOutline={activeToken?.id}
  onmousedown={onChapterMousedown}
  onclick={onChapterClick}
  onpointerdown={(event) => { longPressOpened = false; preview.rememberPointer(event); }}
  onpointerover={showHoverTooltip}
  onpointerout={hideHoverTooltip}
  onfocusin={showHoverTooltip}
  onfocusout={hideHoverTooltip}
  ontouchstart={onTouchStart}
  ontouchmove={onTouchMove}
  ontouchend={onTouchEnd}
  ontouchcancel={onTouchEnd}
>
  {#if pageImage}
    <!-- PDF image reader: the original page with transparent, clickable
         word hotspots positioned by each token's normalized bbox. The
         real page is always visible so OCR mistakes can be verified. -->
    <div
      class="page-overlay"
      data-testid="page-overlay"
      style={pageAspect ? `aspect-ratio: ${pageAspect}` : undefined}
    >
      <img class="page-img" src={pageImage.url} alt={`Page ${chapter.idx + 1}`} />
      {#each overlayTokens as t (t.id)}
        <span
          class="ovl-hotspot"
          class:anchor={activeToken?.id === t.id}
          class:no-definition={!isIgnoredHere(t, occurrenceIgnores) && t.hasDefinition === false}
          data-token-id={t.id}
          data-token-idx={t.idx}
          data-lemma-id={t.lemmaId ?? undefined}
          data-s={statusToCode(isIgnoredHere(t, occurrenceIgnores) ? 'ignored' : t.status)}
          title={t.surface}
          style={`left:${(t.bbox!.x * 100).toFixed(3)}%;top:${(t.bbox!.y * 100).toFixed(3)}%;width:${(t.bbox!.w * 100).toFixed(3)}%;height:${(t.bbox!.h * 100).toFixed(3)}%`}
        ></span>
      {/each}
    </div>
  {:else if displayParagraphs}
    {#each displayParagraphs as paragraph, pIdx (pIdx)}
      <p class="body">
        {#each paragraph as group, gIdx (gIdx)}{#if group.kind === 'plain'}{@render renderSegment(group.segment)}{:else}<phrase
              class="phrase pending-phrase"
              data-testid="pending-phrase"
              >{#each group.segments as segment, sIdx (sIdx)}{@render renderSegment(segment)}{/each}</phrase>{/if}{/each}
      </p>
    {/each}
  {:else if fallbackParagraphs}
    {#each fallbackParagraphs as paragraph, pIdx (pIdx)}
      <p class="body">
        {#each paragraph as token (token.idx)}<span
            class:word={token.isWord}
            data-token-idx={token.idx}>{token.surface}</span>{/each}
      </p>
    {/each}
  {/if}
</div>

{#if preview.token && preview.rect}
  <WordTooltip token={preview.token} anchorRect={preview.rect} {language} onClose={preview.close} />
{/if}

<!-- WordPopup mounts unconditionally so the side panel can stay
     visible on desktop even before the user picks a word. The popup
     itself decides whether to render its full body or an empty-state
     prompt based on whether `token` is null. -->
<WordPopup
  chapterTokens={tokensWithOverrides}
  token={popupToken}
  phrase={activePhrase}
  pendingSelection={pendingSelection ?? undefined}
  selectionError={selectionError ?? undefined}
  anchorRect={activeRect ?? undefined}
  {language}
  {isOwner}
  {isAdmin}
  {textId}
  {pageImage}
  onClose={closePopup}
  onPhraseCreated={(phraseId: string) => {
    void onPhraseCreated(phraseId);
  }}
  {onStatusChange}
  {onCorrectionApplied}
  {onPersonalTranslationChange}
/>

<CorrectionToast
  open={toastTokenId !== null}
  sourceTokenId={toastTokenId ?? ''}
  onDismiss={() => (toastTokenId = null)}
/>

<style>
  /* Inherit the reader's font size and line height so a paragraph looks the same in each layout. */
  .body {
    margin: 0 0 1rem;
  }
  .word {
    cursor: pointer;
    border-radius: 3px;
    transition: background 80ms ease;
  }
  .word:hover {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  /* PDF image reader (overlay). The page image fills a centered column;
     transparent hotspots sit over each word so clicks open the same
     WordPopup the text reader uses. */
  .page-overlay {
    position: relative;
    width: 100%;
    max-width: 100%;
    margin: 0 auto;
    line-height: 0;
  }
  .page-img {
    display: block;
    width: 100%;
    height: auto;
    user-select: none;
  }
  .ovl-hotspot {
    position: absolute;
    cursor: pointer;
    border-radius: 2px;
    /* A faint fill marks every recognized word as clickable without
       drowning the page; status tints below layer on top. */
    background: color-mix(in oklch, var(--accent, var(--color-accent)) 8%, transparent);
    transition: background 80ms ease, box-shadow 80ms ease;
  }
  .ovl-hotspot:hover {
    background: color-mix(in oklch, var(--accent, var(--color-accent)) 24%, transparent);
  }
  /* Learning words get the saffron study tint, mirroring tokens.css. */
  .ovl-hotspot[data-s='2'] {
    background: color-mix(in oklch, var(--w-l2-bg, #f4c95d) 45%, transparent);
  }
  /* Known + ignored words drop the fill — the learner already has them. */
  :global([data-hl='none']) .ovl-hotspot[data-s],
  :global([data-highlight-learning='off']) .ovl-hotspot[data-s='2'],
  .ovl-hotspot[data-s='4'],
  .ovl-hotspot[data-s='5'] {
    background: transparent;
  }
  :global([data-hl='none']) .ovl-hotspot:hover,
  :global([data-highlight-learning='off']) .ovl-hotspot[data-s='2']:hover,
  .ovl-hotspot[data-s='4']:hover,
  .ovl-hotspot[data-s='5']:hover {
    background: color-mix(in oklch, var(--accent, var(--color-accent)) 14%, transparent);
  }
  /* Selected word: a clear accent ring (meets the 3:1 non-text UI
     contrast guidance over the page image). */
  .ovl-hotspot.anchor {
    box-shadow: 0 0 0 2px var(--accent, var(--color-accent));
    background: color-mix(in oklch, var(--accent, var(--color-accent)) 18%, transparent);
  }
  /* Admin "flag undefined words" overlay — dashed magenta box, matching
     the text reader's no-definition affordance. */
  :global(html[data-flag-undefined]) .ovl-hotspot.no-definition {
    box-shadow: 0 0 0 1px var(--magenta, #c026d3);
  }
  /* Phrase wrappers are an unknown element so we
     have to opt them into inline display explicitly. The visible
     highlight is a soft accent fill behind the run plus a
     continuous bottom-bar — both painted via box-shadow so the
     wrapper doesn't claim line-box height (a real `border-bottom`
     would). `box-decoration-break: clone` ensures each line-
     fragment gets the full decoration when a phrase wraps mid-
     line, so "इंतज़ार करना" split across two lines reads as one
     unit rather than two stranded underlines. The per-token
     status tints from tokens.css still paint *above* this layer
     (the inner `<span>`s have their own background), so a known
     lemma inside an unknown phrase keeps its colour. */
  .phrase {
    display: inline;
    background: color-mix(in oklch, var(--accent, var(--color-accent)) 8%, transparent);
    box-shadow: inset 0 -2px 0
      color-mix(in oklch, var(--accent, var(--color-accent)) 40%, transparent);
    border-radius: 3px;
    /* Tiny horizontal padding so the pill extends a hair past the
       outer characters; the negative margin keeps the layout
       advance unchanged. */
    padding: 0 1px;
    margin: 0 -1px;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }
  .phrase[data-s='2'] {
    /* learning phrase — slightly stronger fill so it reads as
       active progress rather than passive grouping. */
    background: color-mix(in oklch, var(--accent, var(--color-accent)) 14%, transparent);
    box-shadow: inset 0 -2px 0
      color-mix(in oklch, var(--accent, var(--color-accent)) 55%, transparent);
  }
  :global([data-highlight-learning='off']) .phrase[data-s='2'],
  .phrase[data-s='4'] {
    /* known phrase — quietest fill, no bottom bar. The user has
       learnt this expression; we still want the grouping cue but
       not the "draw your eye here" emphasis. */
    background: color-mix(in oklch, var(--accent, var(--color-accent)) 4%, transparent);
    box-shadow: none;
  }
  :global([data-hl='none']) .phrase[data-s],
  .phrase[data-s='5'] {
    /* ignored — drop the highlight entirely. */
    background: transparent;
    box-shadow: none;
  }
  /* in-progress shift-click selection. Soft accent fill
     plus a 2px outer accent ring so the proposed range reads as
     one clear unit — the per-word anchor outline is suppressed
     while pending is active (see `isAnchor` wiring in this file),
     so this ring is the primary "your selection" indicator. The
     ring uses the same accent the committed `.phrase` bottom-bar
     uses, so the visual resolves smoothly into the saved-phrase
     look once the user clicks Save.

     `box-decoration-break: slice` overrides the `.phrase` base
     (which uses `clone` for its bottom-bar — each line wants its
     own bar). For a phrase-as-range, `slice` is the right
     convention: the ring opens on the right at a mid-line wrap
     and opens on the left where the run continues, signaling
     continuity instead of looking like two separate selections. */
  .phrase.pending-phrase {
    background: color-mix(in oklch, var(--accent, var(--color-accent)) 22%, transparent);
    box-shadow: 0 0 0 2px var(--accent, var(--color-accent));
    box-decoration-break: slice;
    -webkit-box-decoration-break: slice;
  }
</style>
