<script lang="ts">
  /**
   * Scan-page pane with a drag-to-draw crop rectangle.
   *
   * The crop is a normalized {x,y,w,h} in 0..1 of the page image — the
   * same convention as the reader overlay (ChapterBody) and
   * `text_tokens.bbox`, so it renders as %-positioned divs and is
   * resolution-independent. Deliberately a dumb rectangle over an
   * <img>: no canvas, no rotation, no resize handles — redraw to
   * adjust. Zoom scales the container width only.
   */
  type Crop = { x: number; y: number; w: number; h: number };

  let {
    imageUrl,
    alt,
    crop = $bindable(null),
  }: {
    imageUrl: string;
    alt: string;
    crop: Crop | null;
  } = $props();

  let zoom = $state(1);
  let container: HTMLDivElement | undefined = $state();
  let drawing = $state<{ x: number; y: number } | null>(null);
  let preview = $state<Crop | null>(null);

  function toNormalized(event: PointerEvent): { x: number; y: number } {
    const rect = container!.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }

  function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): Crop {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drawing = toNormalized(event);
    preview = null;
  }

  function onPointerMove(event: PointerEvent) {
    if (!drawing) return;
    preview = rectFrom(drawing, toNormalized(event));
  }

  function onPointerUp(event: PointerEvent) {
    if (!drawing) return;
    const rect = rectFrom(drawing, toNormalized(event));
    drawing = null;
    preview = null;
    // Ignore accidental clicks; keep the previous crop.
    if (rect.w > 0.005 && rect.h > 0.005) crop = rect;
  }

  const shown = $derived(preview ?? crop);
</script>

<div class="pane">
  <div class="toolbar">
    <label>
      Zoom
      <input type="range" min="1" max="3" step="0.25" bind:value={zoom} />
    </label>
    <span class="hint">Drag on the page to mark the entry.</span>
    {#if crop}
      <button type="button" class="clear" onclick={() => (crop = null)}>
        Clear crop
      </button>
    {/if}
  </div>
  <div class="scroll">
    <div
      class="canvas"
      bind:this={container}
      style={`width: ${zoom * 100}%;`}
      role="application"
      aria-label="Scan page; drag to mark the printed entry"
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
    >
      <img src={imageUrl} {alt} draggable="false" />
      {#if shown}
        <div
          class="crop"
          style={`left:${shown.x * 100}%;top:${shown.y * 100}%;` +
            `width:${shown.w * 100}%;height:${shown.h * 100}%;`}
        ></div>
      {/if}
    </div>
  </div>
</div>

<style>
  .pane {
    border: 1px solid var(--border, #ccc);
    border-radius: 8px;
    overflow: hidden;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid var(--border, #ddd);
    font-size: 0.85rem;
  }
  .toolbar label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .hint {
    color: var(--text-secondary, #444);
  }
  .clear {
    margin-left: auto;
  }
  .scroll {
    overflow: auto;
    max-height: 70vh;
  }
  .canvas {
    position: relative;
    touch-action: none;
    user-select: none;
    cursor: crosshair;
  }
  .canvas img {
    display: block;
    width: 100%;
    height: auto;
    pointer-events: none;
  }
  .crop {
    position: absolute;
    border: 2px solid var(--accent, #2563eb);
    background: rgba(37, 99, 235, 0.12);
    pointer-events: none;
  }
</style>
