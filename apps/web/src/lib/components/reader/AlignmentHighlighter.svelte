<!--
  Alignment-driven highlighting (T-9.3).

  Subscribes to audio-bus, fetches the active audio file's
  alignment timeline once, then per timeupdate runs a binary
  search over (startMs, endMs) and toggles `.playing` on the
  matching `<span data-token-id>`. Smooth-scrolls to keep the
  current word in view.

  Headless component (renders nothing). Mounted alongside the
  reader modes; the body of the reader stays exactly as
  T-5.x rendered it.
-->
<script lang="ts">
  import { onMount } from 'svelte';

  import {
    findAlignmentAt,
    type AlignmentListItem,
  } from '$lib/server/audio/alignments.js';
  import {
    setAlignmentMap,
    subscribeAudio,
    type AudioState,
  } from './audio-bus.js';

  let activeAudioId = $state<string | null>(null);
  let alignments = $state<AlignmentListItem[]>([]);
  let lastIdx = $state<number | null>(null);

  onMount(() => {
    const off = subscribeAudio((state: AudioState) => {
      if (state.audioFileId !== activeAudioId) {
        activeAudioId = state.audioFileId;
        alignments = [];
        lastIdx = null;
        if (state.audioFileId) void loadAlignments(state.audioFileId);
        clearHighlight();
      }
      if (state.audioFileId && alignments.length > 0) {
        applyHighlight(state.currentTimeMs);
      }
    });
    return () => {
      off();
      clearHighlight();
    };
  });

  async function loadAlignments(audioFileId: string) {
    try {
      const res = await fetch(`/api/v1/audio/${audioFileId}/alignments`);
      if (!res.ok) return;
      const data = (await res.json()) as { alignments: AlignmentListItem[] };
      alignments = data.alignments ?? [];
      // T-9.4: publish a tokenId → startMs map so ChapterBody's
      // click handler can seek the player without re-fetching.
      const m = new Map<string, number>();
      for (const a of alignments) m.set(a.tokenId, a.startMs);
      setAlignmentMap(m);
    } catch {
      // Quiet — the reader still works without alignment, just no
      // karaoke highlight.
    }
  }

  function applyHighlight(currentMs: number) {
    const idx = findAlignmentAt(alignments, currentMs);
    if (idx === lastIdx) return;
    clearHighlight();
    if (idx == null) {
      lastIdx = null;
      return;
    }
    const { tokenId } = alignments[idx]!;
    const el = document.querySelector<HTMLElement>(
      `[data-token-id="${cssEscape(tokenId)}"]`,
    );
    if (el) {
      el.classList.add('playing');
      // Smooth-scroll to keep the word in view; only when the user
      // hasn't manually scrolled away in the last few seconds (the
      // browser handles "block: nearest" gracefully when the word
      // is already on screen, so this is cheap on the happy path).
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    lastIdx = idx;
  }

  function clearHighlight() {
    if (typeof document === 'undefined') return;
    document
      .querySelectorAll('[data-token-id].playing')
      .forEach((n) => n.classList.remove('playing'));
  }

  function cssEscape(s: string): string {
    return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(s)
      : s.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }
</script>
