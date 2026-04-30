<!--
  Audio player (T-9.2).

  Anchors at the bottom of the reader as a sticky strip when audio
  is available. Custom transport on top of an `<audio>` element:
  play/pause, scrubber with current/total time, speed select
  (0.5×–2×). Forwards state to the audio-bus so T-9.3 (alignment-
  driven highlighting) and T-9.4 (tap-to-seek) consume it without
  importing the element directly.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  import {
    setAudioController,
    setAudioState,
    type AudioController,
  } from './audio-bus.js';

  interface AudioFile {
    id: string;
    url: string;
    mime: string;
    durationMs: number | null;
    attribution: string | null;
    license: string | null;
  }

  import { untrack } from 'svelte';

  let {
    audio,
    canRecordListening = false,
  }: { audio: AudioFile; canRecordListening?: boolean } = $props();

  let audioEl: HTMLAudioElement | null = $state(null);
  let isPlaying = $state(false);
  let currentSec = $state(0);
  let durationSec = $state(
    untrack(() => (audio.durationMs ? audio.durationMs / 1000 : 0)),
  );
  let speed = $state(1);
  let pendingListeningMs = 0;
  let pendingListeningAudioId: string | null = null;
  let lastMediaSec: number | null = null;

  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const LISTENING_FLUSH_MS = 10_000;

  function fmtTime(s: number): string {
    if (!Number.isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  function play() {
    if (!audioEl) return;
    void audioEl.play();
  }
  function pause() {
    if (!audioEl) return;
    audioEl.pause();
  }
  function toggle() {
    if (isPlaying) pause();
    else play();
  }
  function seekToSec(sec: number) {
    if (!audioEl) return;
    audioEl.currentTime = Math.max(0, Math.min(sec, durationSec || sec));
  }
  function setSpeed(n: number) {
    speed = n;
    if (audioEl) audioEl.playbackRate = n;
  }

  function onTimeUpdate() {
    if (!audioEl) return;
    const nextSec = audioEl.currentTime;
    if (isPlaying && canRecordListening && lastMediaSec !== null) {
      const deltaSec = nextSec - lastMediaSec;
      if (deltaSec > 0 && deltaSec <= 5) {
        pendingListeningAudioId = audio.id;
        pendingListeningMs += Math.round(deltaSec * 1000);
        if (pendingListeningMs >= LISTENING_FLUSH_MS) {
          void flushListening();
        }
      }
    }
    lastMediaSec = nextSec;
    currentSec = audioEl.currentTime;
    setAudioState({
      currentTimeMs: Math.round(audioEl.currentTime * 1000),
      isPlaying,
      audioFileId: audio.id,
    });
  }
  function onLoadedMetadata() {
    if (!audioEl) return;
    if (Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
      durationSec = audioEl.duration;
    }
  }
  function onPlay() {
    isPlaying = true;
    lastMediaSec = audioEl?.currentTime ?? currentSec;
    setAudioState({ isPlaying: true, audioFileId: audio.id });
  }
  function onPause() {
    isPlaying = false;
    void flushListening();
    lastMediaSec = null;
    setAudioState({ isPlaying: false, audioFileId: audio.id });
  }

  async function flushListening() {
    if (!canRecordListening || pendingListeningMs <= 0) return;
    const audioFileId = pendingListeningAudioId ?? audio.id;
    const listenedMs = pendingListeningMs;
    pendingListeningMs = 0;
    pendingListeningAudioId = null;
    try {
      await fetch('/api/v1/me/listening', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audioFileId, listenedMs }),
        keepalive: true,
      });
    } catch {
      pendingListeningAudioId = audioFileId;
      pendingListeningMs += listenedMs;
    }
  }

  function flushListeningOnPageHide() {
    if (!canRecordListening || pendingListeningMs <= 0) return;
    const audioFileId = pendingListeningAudioId ?? audio.id;
    const listenedMs = pendingListeningMs;
    pendingListeningMs = 0;
    pendingListeningAudioId = null;
    const body = JSON.stringify({ audioFileId, listenedMs });
    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon(
        '/api/v1/me/listening',
        new window.Blob([body], { type: 'application/json' }),
      );
      if (ok) return;
    }
    void fetch('/api/v1/me/listening', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      pendingListeningAudioId = audioFileId;
      pendingListeningMs += listenedMs;
    });
  }

  onMount(() => {
    setAudioState({ audioFileId: audio.id, isPlaying: false, currentTimeMs: 0 });
    window.addEventListener('pagehide', flushListeningOnPageHide);
    window.addEventListener('beforeunload', flushListeningOnPageHide);
    const controller: AudioController = {
      seekMs: (ms) => seekToSec(ms / 1000),
      play,
      pause,
    };
    setAudioController(controller);
    return () => {
      flushListeningOnPageHide();
      window.removeEventListener('pagehide', flushListeningOnPageHide);
      window.removeEventListener('beforeunload', flushListeningOnPageHide);
      setAudioController(null);
      setAudioState({ audioFileId: null, isPlaying: false, currentTimeMs: 0 });
    };
  });
  onDestroy(() => {
    setAudioController(null);
  });

  // Re-init when the audio file changes (e.g. user navigates to a
  // different chapter that has its own track).
  $effect(() => {
    void audio.id;
    void flushListening();
    if (audioEl) audioEl.load();
    currentSec = 0;
    isPlaying = false;
    lastMediaSec = null;
    setAudioState({ audioFileId: audio.id, currentTimeMs: 0, isPlaying: false });
  });
</script>

<aside class="ap" data-audio-id={audio.id} aria-label="Audio player">
  <!-- The reader IS the caption: per-token alignment lights up
       words on the page in sync with playback (T-9.3). A separate
       <track> would be redundant. -->
  <audio
    bind:this={audioEl}
    src={audio.url}
    preload="metadata"
    ontimeupdate={onTimeUpdate}
    onloadedmetadata={onLoadedMetadata}
    onplay={onPlay}
    onpause={onPause}
  ></audio>

  <button
    type="button"
    class="ap-toggle"
    onclick={toggle}
    aria-label={isPlaying ? 'Pause' : 'Play'}
  >
    {isPlaying ? '⏸' : '▶'}
  </button>

  <div class="ap-times">
    <span class="ap-now">{fmtTime(currentSec)}</span>
    <span class="ap-sep">/</span>
    <span class="ap-total">{fmtTime(durationSec)}</span>
  </div>

  <input
    type="range"
    class="ap-scrub"
    min="0"
    max={durationSec || 0}
    step="0.1"
    value={currentSec}
    oninput={(e) => seekToSec(Number((e.target as HTMLInputElement).value))}
    aria-label="Seek"
  />

  <label class="ap-speed">
    <span class="ap-speed-l">Speed</span>
    <select
      value={speed}
      onchange={(e) => setSpeed(Number((e.target as HTMLSelectElement).value))}
    >
      {#each SPEEDS as s}
        <option value={s}>{s}×</option>
      {/each}
    </select>
  </label>

  {#if audio.attribution || audio.license}
    <p class="ap-attr">
      {#if audio.attribution}<span class="ap-attr-text">{audio.attribution}</span>{/if}
      {#if audio.license}
        <span class="ap-license" title="Audio license">{audio.license}</span>
      {/if}
    </p>
  {/if}
</aside>

<style>
  .ap {
    position: sticky;
    bottom: 0;
    z-index: 6;
    display: grid;
    grid-template-columns: auto auto 1fr auto auto;
    gap: 0.6rem;
    align-items: center;
    padding: 0.5rem 1rem;
    background: var(--paper, var(--color-bg));
    border-top: 1px solid var(--rule, var(--color-border));
    color: var(--ink, var(--color-fg));
  }
  .ap-toggle {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 1px solid var(--card-edge, var(--color-border));
    background: var(--card, var(--color-bg));
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
  }
  .ap-toggle:hover {
    background: var(--accent-soft, color-mix(in oklch, var(--accent, var(--color-accent)) 14%, transparent));
  }
  .ap-times {
    display: flex;
    gap: 0.3rem;
    font-family: var(--font-mono-display, var(--font-mono));
    font-feature-settings: 'tnum';
    font-size: 0.78rem;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .ap-scrub {
    width: 100%;
  }
  .ap-speed {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.78rem;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .ap-speed select {
    padding: 0.2rem 0.4rem;
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 4px;
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    font: inherit;
    font-size: 0.78rem;
  }
  .ap-attr {
    grid-column: 1 / -1;
    margin: 0;
    font-size: 0.66rem;
    color: var(--ink-4, var(--color-fg-subtle));
    text-align: center;
    display: flex;
    gap: 0.45rem;
    justify-content: center;
    flex-wrap: wrap;
  }
  .ap-license {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 6%, transparent);
    border-radius: 999px;
    padding: 0.05rem 0.4rem;
    font-family: var(--font-mono-display, var(--font-mono));
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
</style>
