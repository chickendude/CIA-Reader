<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  type Mark = { startMs: number; endMs: number };
  let audioEl: HTMLAudioElement | null = $state(null);
  let active = $state(0); // current sentence index
  let isPlaying = $state(false);
  let pressStart = $state<number | null>(null); // ms when current press started
  let marks = $state<Map<number, Mark>>(new Map());

  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let saveOk = $state(false);

  function nowMs(): number {
    return audioEl ? Math.round(audioEl.currentTime * 1000) : 0;
  }

  function press() {
    if (!audioEl || pressStart != null) return;
    pressStart = nowMs();
  }
  function release() {
    if (pressStart == null) return;
    const startMs = pressStart;
    const endMs = nowMs();
    pressStart = null;
    if (endMs <= startMs) return;
    const sentenceIdx = data.sentences[active]?.sentenceIdx;
    if (sentenceIdx === undefined) return;
    const next = new Map(marks);
    next.set(sentenceIdx, { startMs, endMs });
    marks = next;
    if (active < data.sentences.length - 1) active += 1;
  }

  function onKey(e: KeyboardEvent) {
    if (e.target instanceof HTMLElement) {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (e.repeat) return;
      press();
    }
  }
  function onKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') {
      e.preventDefault();
      release();
    }
  }

  function togglePlay() {
    if (!audioEl) return;
    if (audioEl.paused) void audioEl.play();
    else audioEl.pause();
  }

  async function save() {
    saving = true;
    saveError = null;
    saveOk = false;
    try {
      const { interpolateSentenceMarks } = await import(
        '$lib/server/audio/sentence-tokens.js'
      );
      // Browser-side import works because the helper is pure (no
      // server-only deps). We pass the loader-provided sentences +
      // the user's marks straight through.
      const flat = Array.from(marks.entries()).map(([sentenceIdx, m]) => ({
        sentenceIdx,
        startMs: m.startMs,
        endMs: m.endMs,
      }));
      const alignments = interpolateSentenceMarks(
        data.sentences,
        flat,
      );
      const res = await fetch(`/api/v1/audio/${data.audio.id}/alignments`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'manual', alignments }),
      });
      if (!res.ok) {
        saveError = (await res.text().catch(() => '')) || `HTTP ${res.status}`;
        return;
      }
      saveOk = true;
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>Align audio — CIA Reader</title>
</svelte:head>

<svelte:window onkeydown={onKey} onkeyup={onKeyUp} />

<div class="ae">
  <header><h1>Align audio</h1></header>

  <audio
    bind:this={audioEl}
    src={data.audio.url}
    controls
    preload="metadata"
    onplay={() => (isPlaying = true)}
    onpause={() => (isPlaying = false)}
  ></audio>

  <p class="ae-hint">
    Press &amp; hold <kbd>Space</kbd> while a sentence is being spoken.
    Release at the end. The next sentence advances automatically.
    Per-word timings are linearly interpolated within each sentence.
  </p>

  <ol class="ae-sentences">
    {#each data.sentences as s, i (s.sentenceIdx)}
      <li
        class="ae-sentence"
        data-active={i === active ? '1' : '0'}
        data-marked={marks.has(s.sentenceIdx) ? '1' : '0'}
      >
        <span class="ae-pos">{i + 1}</span>
        <p class="ae-body">
          {#each s.tokens as t (t.id)}<span>{t.surface}</span>{/each}
        </p>
        {#if marks.get(s.sentenceIdx)}
          {@const m = marks.get(s.sentenceIdx)!}
          <span class="ae-mark">
            {(m.startMs / 1000).toFixed(2)}s → {(m.endMs / 1000).toFixed(2)}s
          </span>
        {/if}
      </li>
    {/each}
  </ol>

  <footer class="ae-foot">
    <button type="button" onclick={togglePlay}>
      {isPlaying ? 'Pause' : 'Play'}
    </button>
    <button type="button" disabled={marks.size === 0} onclick={() => (marks = new Map())}>
      Clear marks
    </button>
    <button type="button" class="ae-save" disabled={saving || marks.size === 0} onclick={save}>
      {saving ? 'Saving…' : `Save ${marks.size} sentence${marks.size === 1 ? '' : 's'}`}
    </button>
    {#if saveOk}
      <span class="ae-ok">Saved.</span>
    {/if}
    {#if saveError}
      <span class="ae-err" role="alert">{saveError}</span>
    {/if}
  </footer>

  <p class="ae-back">
    <button type="button" class="ae-link" onclick={() => window.history.back()}>← back</button>
  </p>
</div>

<style>
  .ae {
    max-width: 48rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
    color: var(--ink, var(--color-fg));
  }
  .ae h1 {
    margin: 0 0 1rem;
    font-family: var(--font-serif, system-ui);
  }
  audio {
    width: 100%;
    margin-bottom: 0.5rem;
  }
  .ae-hint {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.85rem;
    margin: 0 0 1rem;
  }
  kbd {
    background: var(--card, var(--color-bg));
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 4px;
    padding: 0.05rem 0.35rem;
    font-family: var(--font-mono-display, var(--font-mono));
    font-size: 0.78rem;
  }
  .ae-sentences {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .ae-sentence {
    display: grid;
    grid-template-columns: 2rem 1fr auto;
    gap: 0.55rem;
    align-items: baseline;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    background: var(--card, var(--color-bg));
  }
  .ae-sentence[data-active='1'] {
    border-color: var(--accent, var(--color-accent));
    box-shadow: 0 0 0 1px var(--accent, var(--color-accent));
  }
  .ae-sentence[data-marked='1'] {
    background: color-mix(in oklch, var(--accent, var(--color-accent)) 6%, var(--card, var(--color-bg)));
  }
  .ae-pos {
    font-family: var(--font-mono-display, var(--font-mono));
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.8rem;
    text-align: right;
  }
  .ae-body {
    margin: 0;
    font-family: var(--font-serif-dev, var(--font-serif));
  }
  .ae-mark {
    font-family: var(--font-mono-display, var(--font-mono));
    font-size: 0.75rem;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .ae-foot {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-top: 1rem;
  }
  .ae-foot button {
    background: var(--card, var(--color-bg));
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 6px;
    padding: 0.4rem 0.8rem;
    font: inherit;
    cursor: pointer;
    color: var(--ink, var(--color-fg));
  }
  .ae-save {
    background: var(--accent, var(--color-accent)) !important;
    color: var(--accent-ink, var(--color-bg)) !important;
    border-color: var(--accent, var(--color-accent)) !important;
  }
  .ae-foot button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .ae-ok {
    color: var(--accent, var(--color-accent));
    font-size: 0.85rem;
  }
  .ae-err {
    color: var(--err, #b94545);
    font-size: 0.85rem;
  }
  .ae-back {
    margin-top: 1rem;
  }
  .ae-link {
    background: none;
    border: 0;
    color: var(--accent, var(--color-accent));
    cursor: pointer;
    font: inherit;
  }
</style>
