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
  import {
    paragraphsOfServerTokens,
    paragraphsOfTokens,
    tokenize,
    type ChapterView,
    type ServerToken,
  } from './types.js';

  let {
    chapter,
    showRomanization = false,
    isOwner = false,
  }: {
    chapter: ChapterView;
    showRomanization?: boolean;
    isOwner?: boolean;
  } = $props();

  // Local override map: lemmaId → user's most recent status. The
  // popup's optimistic update writes through here so every other
  // token tied to the same lemma flips its highlight in real time
  // (the next page load reflects the same state via the loader).
  let statusOverrides = $state(new Map<string, ServerToken['status']>());

  // Apply any pending optimistic status flips to the token list
  // before paragraph splitting so the .status-* classes update live.
  const tokensWithOverrides = $derived.by(() => {
    if (!chapter.tokens) return null;
    if (statusOverrides.size === 0) return chapter.tokens;
    return chapter.tokens.map((t) =>
      t.lemmaId && statusOverrides.has(t.lemmaId)
        ? { ...t, status: statusOverrides.get(t.lemmaId)! }
        : t,
    );
  });

  const serverParagraphs = $derived(
    tokensWithOverrides ? paragraphsOfServerTokens(tokensWithOverrides) : null,
  );
  const fallbackParagraphs = $derived(
    chapter.tokens ? null : paragraphsOfTokens(tokenize(chapter.body)),
  );

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

  function onChapterClick(event: MouseEvent) {
    const found = findToken(event.target as HTMLElement);
    if (!found) return;
    const rect = found.el.getBoundingClientRect();
    activeToken = found.token;
    activeRect = {
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.right,
    };
    // Hide the hover tooltip so it doesn't double up with the panel.
    hoverToken = null;
    hoverRect = null;
  }

  // Accepts both MouseEvent (mouseover) and FocusEvent (focusin) so
  // the tooltip surfaces for pointer hovers AND keyboard tabbing.
  function showHoverTooltip(event: Event) {
    const found = findToken(event.target as HTMLElement);
    if (!found) {
      hoverToken = null;
      hoverRect = null;
      return;
    }
    // Skip the tooltip when the side panel is locked on the same
    // word — redundant.
    if (activeToken && activeToken.id === found.token.id) {
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
>
  {#if serverParagraphs}
    {#each serverParagraphs as paragraph, pIdx (pIdx)}
      <p class="body">
        {#each paragraph as token (token.id)}<TokenSpan
            {token}
            {showRomanization}
          />{/each}
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
  <WordTooltip token={hoverToken} anchorRect={hoverRect} />
{/if}

{#if activeToken && activeRect}
  <WordPopup
    token={activeToken}
    anchorRect={activeRect}
    {isOwner}
    onClose={closePopup}
    {onStatusChange}
  />
{/if}

<style>
  .body {
    margin: 0 0 1rem;
    line-height: 1.85;
    font-size: 1.05rem;
  }
  .word {
    cursor: pointer;
    border-radius: 3px;
    transition: background 80ms ease;
  }
  .word:hover {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
</style>
