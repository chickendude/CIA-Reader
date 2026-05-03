<!--
  Renders one chapter's body (T-5.2, T-5.3, T-5.4, hover tooltip in T-5.10).

  Click handling lives here so the popup is mounted at most once per
  chapter render — wiring it on every TokenSpan would explode for
  large chapters. We delegate via event bubbling.

  Two surfaces:
    - Hover (mouseover): a lightweight WordTooltip that reads only
      what's on the token row. Cheap; no fetch.
    - Click: the full WordPopup side panel. Fetches translations,
      offers status flips + add-translation form. Locks until the
      user closes / picks another word.
-->
<script lang="ts">
  import TokenSpan from './TokenSpan.svelte';
  import WordPopup from './WordPopup.svelte';
  import WordTooltip from './WordTooltip.svelte';
  import CorrectionToast from './CorrectionToast.svelte';
  import { LongPressDetector } from './touch-gestures.js';
  import type { LanguageCode } from '@ciareader/shared-types';
  import {
    paragraphsOfServerTokens,
    paragraphsOfTokens,
    segmentParagraphPhrases,
    statusToCode,
    tokenize,
    type ChapterPhraseSpan,
    type ChapterView,
    type ServerToken,
  } from './types.js';
  import { validatePhraseSelection } from './phrase-selection.js';

  let {
    chapter,
    language,
    showRomanization = false,
    isOwner = false,
  }: {
    chapter: ChapterView;
    /** T-6.2: drives the CorrectionModal's dictionary-search
     *  language + script. */
    language: LanguageCode;
    showRomanization?: boolean;
    isOwner?: boolean;
  } = $props();

  // Local override map: lemmaId → user's most recent status. The
  // popup's optimistic update writes through here so every other
  // token tied to the same lemma flips its highlight in real time
  // (the next page load reflects the same state via the loader).
  let statusOverrides = $state(new Map<string, ServerToken['status']>());
  // T-6.1: per-token lemma corrections live here so picking an
  // alternate meaning in the popup re-renders that token with the
  // chosen lemma immediately. Server-side persistence happens in
  // T-6.4's loader join; this state is purely for the current
  // session.
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
  const tokensWithOverrides = $derived.by(() => {
    if (!chapter.tokens) return null;
    if (
      statusOverrides.size === 0 &&
      lemmaCorrections.size === 0 &&
      personalGlossOverrides.size === 0
    ) {
      return chapter.tokens;
    }
    return chapter.tokens.map((t) => {
      // T-6.1: lemma override wins; the corrected lemmaId becomes
      // the active pick for this token + the candidate that *was*
      // active drops back into the alternates list (so the user
      // can revert without re-opening the candidate menu).
      const correctedLemmaId = lemmaCorrections.get(t.id);
      let next = t;
      if (correctedLemmaId && correctedLemmaId !== t.lemmaId) {
        const chosen = t.candidates.find((c) => c.lemmaId === correctedLemmaId);
        if (chosen) {
          const remaining = t.candidates.filter(
            (c) => c.lemmaId !== correctedLemmaId,
          );
          // The previous primary becomes a candidate so the user
          // can flip back. We synthesize a candidate row from the
          // current token's lemma metadata; if we don't have it on
          // hand (status only — no headword), we still leave the
          // remaining list as-is so at least the new pick lands.
          next = {
            ...t,
            lemmaId: chosen.lemmaId,
            glossDefault: chosen.glossDefault ?? t.glossDefault,
            candidates: remaining,
            isAmbiguous: remaining.length > 0,
          };
        }
      }
      if (next.lemmaId && statusOverrides.has(next.lemmaId)) {
        next = { ...next, status: statusOverrides.get(next.lemmaId)! };
      }
      if (next.lemmaId && personalGlossOverrides.has(next.lemmaId)) {
        next = {
          ...next,
          personalGloss: personalGlossOverrides.get(next.lemmaId) ?? null,
        };
      }
      return next;
    });
  });

  const serverParagraphs = $derived(
    tokensWithOverrides ? paragraphsOfServerTokens(tokensWithOverrides) : null,
  );
  const fallbackParagraphs = $derived(
    chapter.tokens || chapter.body == null
      ? null
      : paragraphsOfTokens(tokenize(chapter.body)),
  );

  // T-14.3: phrase spans are segmented per paragraph at render
  // time. The resolver (T-14.2) emits at most one span per
  // (startIdx, phraseId), and longest-wins is applied here for the
  // visible `<phrase>` wrapper — shorter overlapping spans ride
  // along as `overlaps` so the popup (T-14.4) can surface them as
  // alternatives. An empty `phraseSpans` array (chapter processed,
  // no matches) costs one Map allocation per paragraph; a `null`
  // value (chapter not yet processed) renders as bare tokens.
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
  // T-14.3: when the click target is inside a `<phrase>` wrapper,
  // the popup opens with the phrase header above the token body.
  // Cleared whenever the click lands on a bare token or the popup
  // is closed.
  let activePhrase = $state<ChapterPhraseSpan | null>(null);
  // T-14.3a: pending phrase-create selection. Set when the user
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

  // T-14.3b: while the user is constructing a phrase via shift-
  // click, paint every word token whose idx falls inside the
  // proposed range with the `pending` highlight. We compute a Set
  // of ids (rather than re-checking inclusion at each TokenSpan)
  // so large chapters stay O(N) on every selection nudge.
  const pendingTokenIdSet = $derived.by(() => {
    const set = new Set<string>();
    if (!pendingSelection || !tokensWithOverrides) return set;
    const { start, end } = pendingSelection.rangeIdx;
    for (const t of tokensWithOverrides) {
      if (t.idx < start || t.idx > end) continue;
      if (!t.isWord) continue;
      set.add(t.id);
    }
    return set;
  });

  function findPhrase(target: HTMLElement | null): ChapterPhraseSpan | null {
    if (!target) return null;
    const wrapper = target.closest('[data-phrase-id]') as HTMLElement | null;
    if (!wrapper) return null;
    const phraseId = wrapper.getAttribute('data-phrase-id');
    if (!phraseId) return null;
    return phraseSpanById.get(phraseId) ?? null;
  }

  let hoverToken = $state<ServerToken | null>(null);
  let hoverRect = $state<{
    top: number;
    left: number;
    bottom: number;
    right: number;
    width: number;
    height: number;
  } | null>(null);

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
    if (!token || !token.isWord) return null;
    return { token, el: span };
  }

  /**
   * T-14.3a: build a pending phrase-create selection from the
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

  function onChapterClick(event: MouseEvent) {
    const found = findToken(event.target as HTMLElement);
    if (!found) return;

    // T-14.3a: shift-click range select. When the user clicks
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
        hoverToken = null;
        hoverRect = null;
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
    // T-14.3: surface the containing phrase (if any) so the popup
    // can render its phrase header above the token body. A click on
    // a bare token clears any prior phrase context.
    activePhrase = findPhrase(event.target as HTMLElement);
    // T-14.3a: clear any pending phrase-create state — a regular
    // click cancels the create flow.
    pendingSelection = null;
    // Hide the hover tooltip so it doesn't double up with the panel.
    hoverToken = null;
    hoverRect = null;
    // T-9.4: tap-to-seek. If audio is loaded for this text and the
    // tapped token has an alignment row, seek the player to that
    // word's startMs and pause so the user can read at their own
    // pace. The popup stays open (it auto-pauses by definition —
    // the user is interacting with the side panel).
    seekAudioForToken(found.token.id);
  }

  function seekAudioForToken(tokenId: string) {
    if (typeof window === 'undefined') return;
    void (async () => {
      const { getAlignmentStartMs, getAudioController } = await import(
        './audio-bus.js'
      );
      const startMs = getAlignmentStartMs(tokenId);
      if (startMs == null) return;
      const ctrl = getAudioController();
      if (!ctrl) return;
      ctrl.pause();
      ctrl.seekMs(startMs);
    })();
  }

  // Accepts both MouseEvent (mouseover) and FocusEvent (focusin) so
  // the tooltip surfaces for pointer hovers AND keyboard tabbing.
  // We deliberately keep showing the tooltip for the locked word —
  // the user might want a quick re-read of the gloss without taking
  // their eyes off the chapter to read the side panel.
  function showHoverTooltip(event: Event) {
    const found = findToken(event.target as HTMLElement);
    if (!found) {
      hoverToken = null;
      hoverRect = null;
      return;
    }
    const rect = found.el.getBoundingClientRect();
    hoverToken = found.token;
    hoverRect = {
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.right,
      width: rect.width,
      height: rect.height,
    };
  }

  function hideHoverTooltip(event: Event) {
    // Only clear if the cursor / focus genuinely leaves the chapter
    // region — moving between two adjacent words shouldn't flicker
    // the tooltip off and on.
    const related =
      'relatedTarget' in event ? (event.relatedTarget as HTMLElement | null) : null;
    if (related && (event.currentTarget as HTMLElement).contains(related)) {
      return;
    }
    hoverToken = null;
    hoverRect = null;
  }

  function closePopup() {
    activeToken = null;
    activeRect = null;
    activePhrase = null;
    pendingSelection = null;
    selectionError = null;
  }

  // T-14.3a: invoked by WordPopup on a successful phrase-create.
  // We refetch the active chapter's tokens / spans so the new
  // phrase highlights immediately. For now this nudges a route
  // invalidation by issuing a light fetch against the lazy-tokens
  // endpoint and re-running the segmenter — the simplest path
  // that doesn't require threading a SvelteKit `invalidate` import
  // through the popup callback.
  async function onPhraseCreated(_phraseId: string) {
    // Server-side spans are rebuilt on the next chapter
    // re-process; for the current paint, we close the popup and
    // expect the next route navigation (or the user's next
    // chapter open) to surface the new phrase. A targeted
    // refresh is a follow-up — see T-14.3b in the issue tracker.
    void _phraseId;
    closePopup();
  }

  // T-5.1c: long-press as a tap alternative on touch devices. A
  // 500ms hold over a word fires the same WordPopup the click
  // handler does. The detector cancels on movement so a scroll-y
  // touch never triggers a spurious popup.
  const longPress = new LongPressDetector((point) => {
    const target = document.elementFromPoint(point.x, point.y);
    const found = findToken(target as HTMLElement | null);
    if (!found) return;
    const rect = found.el.getBoundingClientRect();
    activeToken = found.token;
    activeRect = {
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.right,
    };
    activePhrase = findPhrase(target as HTMLElement | null);
    hoverToken = null;
    hoverRect = null;
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

  // T-6.2b: after a correction commits, surface a toast offering
  // bulk-apply across the rest of the chapter / text.
  let toastTokenId = $state<string | null>(null);

  function onCorrectionApplied(tokenId: string, chosenLemmaId: string | null) {
    const next = new Map(lemmaCorrections);
    if (chosenLemmaId == null) {
      // T-6.2 mark_* path: the user declared this surface isn't a
      // learnable word. Clear any prior pick so the next render
      // falls through to the worker's (now cleared) primary.
      next.delete(tokenId);
    } else {
      next.set(tokenId, chosenLemmaId);
    }
    lemmaCorrections = next;
    toastTokenId = tokenId;
  }

  function applyEverywhereLocally(scope: 'same-context' | 'all-contexts') {
    void scope;
    // Server has already replicated the row. The reader's next
    // navigation will pick up the bulk-applied corrections via
    // T-6.4's loader join. We could optimistically expand the local
    // override map here, but a full chapter walk is enough work that
    // we'd rather let the next loader pass do it canonically.
  }
  void applyEverywhereLocally; // referenced in toast onApplied wiring
</script>

<!-- The hover tooltip is decorative chrome — keyboard / focus users get
     the full side panel via Enter on a focused word. mouseover/mouseout
     are paired with focusin/focusout (the bubbling versions of focus /
     blur) so the tooltip also appears for keyboard navigation. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_mouse_events_have_key_events -->
<div
  onclick={onChapterClick}
  onmouseover={showHoverTooltip}
  onmouseout={hideHoverTooltip}
  onfocusin={showHoverTooltip}
  onfocusout={hideHoverTooltip}
  ontouchstart={onTouchStart}
  ontouchmove={onTouchMove}
  ontouchend={onTouchEnd}
  ontouchcancel={onTouchEnd}
>
  {#if segmentedParagraphs}
    {#each segmentedParagraphs as paragraph, pIdx (pIdx)}
      <p class="body">
        {#each paragraph as segment, sIdx (sIdx)}{#if segment.kind === 'token'}<TokenSpan
              token={segment.token}
              {showRomanization}
              isAnchor={activeToken?.id === segment.token.id}
              isInPendingSelection={pendingTokenIdSet.has(segment.token.id)}
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
                  isAnchor={activeToken?.id === token.id}
                  isInPendingSelection={pendingTokenIdSet.has(token.id)}
                />{/each}</phrase>{/if}{/each}
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

{#if hoverToken && hoverRect}
  <WordTooltip token={hoverToken} anchorRect={hoverRect} {language} />
{/if}

<!-- WordPopup mounts unconditionally so the side panel can stay
     visible on desktop even before the user picks a word. The popup
     itself decides whether to render its full body or an empty-state
     prompt based on whether `token` is null. -->
<WordPopup
  token={activeToken}
  phrase={activePhrase}
  pendingSelection={pendingSelection ?? undefined}
  selectionError={selectionError ?? undefined}
  anchorRect={activeRect ?? undefined}
  {language}
  {isOwner}
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
  /* Inherit font-size + line-height from the reader's content rule
     so page mode and scroll mode look identical (T-5.29 fixed an
     earlier mismatch where this paragraph rule shadowed the parent
     at 1.05rem). */
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
  /* T-14.3 / T-14.3b: phrase wrappers are an unknown element so we
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
  .phrase[data-s='4'] {
    /* known phrase — quietest fill, no bottom bar. The user has
       learnt this expression; we still want the grouping cue but
       not the "draw your eye here" emphasis. */
    background: color-mix(in oklch, var(--accent, var(--color-accent)) 4%, transparent);
    box-shadow: none;
  }
  .phrase[data-s='5'] {
    /* ignored — drop the highlight entirely. */
    background: transparent;
    box-shadow: none;
  }
</style>
