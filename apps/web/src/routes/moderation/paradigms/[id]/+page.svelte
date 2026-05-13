<script lang="ts">
  import { enhance } from '$app/forms';
  import { dismissToast, pushToast } from '$lib/components/toast/toast-store.js';
  import type { ActionData, PageData } from './$types';

  let {
    data,
    form,
  }: { data: PageData; form: ActionData } = $props();

  const saveResult = $derived(form?.section === 'saveAll' ? form : null);
  const slotResult = $derived(form?.section === 'slot' ? form : null);
  const deleteResult = $derived(form?.section === 'delete' ? form : null);
  const regenResult = $derived(form?.section === 'regenerate' ? form : null);

  function featuresToString(feats: Record<string, string>): string {
    return Object.entries(feats)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
  }

  const FEAT_SEP = /\s*,\s*/;
  function parseFeatureString(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const piece of raw.split(FEAT_SEP)) {
      if (!piece) continue;
      const eq = piece.indexOf('=');
      if (eq <= 0) continue;
      const k = piece.slice(0, eq).trim();
      const v = piece.slice(eq + 1).trim();
      if (k && v) out[k] = v;
    }
    return out;
  }

  // ─── Editable state ─────────────────────────────────────────────────
  // Every field the curator can edit lives in `$state`. We diff against
  // `data.paradigm` / `data.slots` (the server's last-known truth) to
  // compute `dirty`. After a successful save the loader re-runs and
  // `data` changes; the $effect below resets the local copy so the
  // save bar de-activates.

  type EditableSlot = {
    id: string;
    slotKey: string;
    features: string;
    suffix: string;
  };

  // `sort_order` is intentionally absent — it's derived server-side
  // from the slot's index in the saveAll payload, so the curator
  // never touches it directly. Drag handle = source of truth.
  function toEditable(slots: typeof data.slots): EditableSlot[] {
    return slots.map((s) => ({
      id: s.id,
      slotKey: s.slotKey,
      features: featuresToString(s.features),
      suffix: s.suffix,
    }));
  }

  // Seed the editable copies from the loader's data on first render so
  // SSR + hydration produces correctly-filled inputs (no empty flash,
  // no chance of submitting an empty `pos` / `name`). The `data` access
  // here is intentional — we want the snapshot at mount, not a live
  // reference; subsequent reloads are picked up by the $effect below.
  // The function wrapper keeps svelte-check from misreading this as a
  // bare prop reference that should be a $derived.
  function snapshotParadigm() {
    return {
      language: data.paradigm.language,
      pos: data.paradigm.pos,
      name: data.paradigm.name,
      description: data.paradigm.description ?? '',
    };
  }
  function snapshotSlots() {
    return toEditable(data.slots);
  }
  function snapshotKey() {
    // Slot order itself is the only "order" signal — sortOrder isn't
    // part of the key because it's an implementation detail the
    // server derives from index.
    return [
      data.paradigm.id,
      data.paradigm.language,
      data.paradigm.pos,
      data.paradigm.name,
      data.paradigm.description ?? '',
      ...data.slots.map(
        (s) => `${s.id}|${s.slotKey}|${s.suffix}|${featuresToString(s.features)}`,
      ),
    ].join('::');
  }

  let paradigmDraft = $state(snapshotParadigm());
  let slotDrafts = $state<EditableSlot[]>(snapshotSlots());

  // Re-seed the local copies whenever the loader returns a different
  // server state (after add / remove / save). Without this the saved
  // values would persist as "dirty" after a successful reload, and a
  // fresh add wouldn't appear in the slot list.
  const serverKey = $derived(snapshotKey());
  let lastSeenServerKey = $state(snapshotKey());
  $effect(() => {
    if (serverKey !== lastSeenServerKey) {
      paradigmDraft = snapshotParadigm();
      slotDrafts = snapshotSlots();
      lastSeenServerKey = serverKey;
    }
  });

  // ─── Dirty detection ────────────────────────────────────────────────

  const paradigmDirty = $derived(
    paradigmDraft.language !== data.paradigm.language ||
      paradigmDraft.pos !== data.paradigm.pos ||
      paradigmDraft.name !== data.paradigm.name ||
      paradigmDraft.description !== (data.paradigm.description ?? ''),
  );
  const slotsDirty = $derived(
    slotDrafts.length !== data.slots.length ||
      slotDrafts.some((d, i) => {
        const original = data.slots[i];
        if (!original) return true;
        // Comparing by index detects reorder (server's sort_order
        // derives from index) — no need to compare sort_order itself.
        return (
          d.id !== original.id ||
          d.slotKey !== original.slotKey ||
          d.suffix !== original.suffix ||
          d.features !== featuresToString(original.features)
        );
      }),
  );
  const dirty = $derived(paradigmDirty || slotsDirty);

  // ─── Reorder (drag + keyboard) ──────────────────────────────────────
  // The drag handle is the only place a slot row can be picked up.
  // Native HTML5 DnD: `dragstart` on the handle stamps the source
  // index into dataTransfer, `dragover` on a row sets the visual
  // indicator + signals the position the drop will land at, `drop`
  // splices `slotDrafts` to the new order. Keyboard users focus the
  // handle and press ArrowUp / ArrowDown — same swap as the legacy
  // arrow buttons, just hung off the handle.

  let draggingIdx = $state<number | null>(null);
  // Indicates where a drop would land: the index of the row the
  // dragged item would slot ABOVE. Used purely for the visual
  // top-border indicator on the target row.
  let dropTargetIdx = $state<number | null>(null);

  function moveSlot(from: number, to: number) {
    if (from === to) return;
    if (from < 0 || from >= slotDrafts.length) return;
    if (to < 0 || to > slotDrafts.length) return;
    const next = slotDrafts.slice();
    const [picked] = next.splice(from, 1);
    if (!picked) return;
    // When dragging downward, the target index shifts left by one
    // after the splice removal.
    const insertAt = from < to ? to - 1 : to;
    next.splice(insertAt, 0, picked);
    slotDrafts = next;
  }

  function onDragStart(e: DragEvent, i: number) {
    if (!e.dataTransfer) return;
    draggingIdx = i;
    e.dataTransfer.effectAllowed = 'move';
    // Some browsers require *some* data on the transfer for the drag
    // to be allowed. Setting plain text with the source index keeps
    // any external listener (which we don't have) sensible.
    e.dataTransfer.setData('text/plain', String(i));
  }

  function onDragOver(e: DragEvent, i: number) {
    if (draggingIdx === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    // Decide whether the drop would land above or below this row,
    // based on the pointer's position within the row. This makes the
    // indicator follow the user instead of snapping to "above" only.
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const below = e.clientY > rect.top + rect.height / 2;
    dropTargetIdx = below ? i + 1 : i;
  }

  function onDragLeaveList(e: DragEvent) {
    // The `dragleave` fires for every child boundary; only clear when
    // the pointer actually leaves the list container.
    const related = e.relatedTarget;
    const current = e.currentTarget as HTMLElement;
    if (
      !related ||
      !(related instanceof globalThis.Node) ||
      !current.contains(related)
    ) {
      dropTargetIdx = null;
    }
  }

  function onDrop(e: DragEvent) {
    if (draggingIdx === null || dropTargetIdx === null) return;
    e.preventDefault();
    moveSlot(draggingIdx, dropTargetIdx);
    draggingIdx = null;
    dropTargetIdx = null;
  }

  function onDragEnd() {
    draggingIdx = null;
    dropTargetIdx = null;
  }

  function onHandleKeydown(e: KeyboardEvent, i: number) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (i > 0) {
        moveSlot(i, i - 1);
        // Keep keyboard focus on the now-moved row's handle so the
        // user can repeat without re-tabbing.
        window.requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(
            `[data-handle-idx="${i - 1}"]`,
          );
          el?.focus();
        });
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (i < slotDrafts.length - 1) {
        moveSlot(i, i + 2);
        window.requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(
            `[data-handle-idx="${i + 1}"]`,
          );
          el?.focus();
        });
      }
    }
  }

  // ─── Build save payload ─────────────────────────────────────────────

  const savePayload = $derived(
    JSON.stringify({
      paradigm: {
        language: paradigmDraft.language,
        pos: paradigmDraft.pos,
        name: paradigmDraft.name,
        description:
          paradigmDraft.description.trim().length === 0
            ? null
            : paradigmDraft.description,
      },
      slots: slotDrafts.map((s) => ({
        id: s.id,
        slotKey: s.slotKey,
        features: parseFeatureString(s.features),
        suffix: s.suffix,
      })),
    }),
  );

  // ─── Inline-confirm state ───────────────────────────────────────────
  // One slot at a time can be in the "confirming delete" state, and
  // separately the paradigm-delete confirmation has its own flag. The
  // delete row replaces the icon button with Cancel / Delete buttons.

  let confirmingSlotId = $state<string | null>(null);
  let confirmingParadigmDelete = $state(false);

  // ─── Regen prompt (modal) ───────────────────────────────────────────
  // After a successful save, if any lemmas use this paradigm we open
  // a confirmation modal. The dismissed flag is keyed off the
  // action-result identity so it resets on every new save — we never
  // want to silently suppress the prompt for a different save.
  let regenDialog = $state<globalThis.HTMLDialogElement | null>(null);
  let regenPending = $state(false);
  // Plain `let` (not `$state`) — see the regen-result effect below
  // for the proxy-equality rationale. Same trap: assigning `form`
  // into a `$state` slot proxies it and breaks `=== form` checks.
  let dismissedRegenForSave: unknown = null;
  /** Id of the sticky "Regenerating…" toast we show while the request
   *  is in flight, so the result handler below can dismiss it the
   *  moment the response lands. */
  let regenProgressToastId = $state<string | null>(null);
  // Re-evaluating the derived needs *some* reactive trigger for
  // dismissal — we bump this counter when the curator dismisses, and
  // read it inside the derived so Svelte knows to recompute.
  let dismissBump = $state(0);
  const regenPromptVisible = $derived(
    !!(
      saveResult &&
      saveResult.ok &&
      saveResult.affectedLemmaCount > 0 &&
      // Read the counter so the derived recomputes when dismiss
      // fires; the actual identity check uses the non-reactive slot.
      dismissBump >= 0 &&
      dismissedRegenForSave !== form &&
      !regenResult
    ),
  );

  // Auto-open / auto-close the modal in response to `regenPromptVisible`.
  // Tracking `dialog.open` keeps us idempotent — Svelte's $effect may
  // re-run if any dep flips, but we only `showModal()` once per open.
  $effect(() => {
    if (!regenDialog) return;
    if (regenPromptVisible && !regenDialog.open) {
      regenDialog.showModal();
    } else if (!regenPromptVisible && regenDialog.open) {
      regenDialog.close();
    }
  });

  function dismissRegenPrompt() {
    dismissedRegenForSave = form; dismissBump += 1;
    regenDialog?.close();
  }

  // ─── Regen result → toast ───────────────────────────────────────────
  // When the regen action returns, surface the summary as a toast so
  // the curator gets the confirmation without the save bar carrying
  // long-lived result text. We key the "already toasted" check by the
  // result identity so we don't re-fire the toast on incidental
  // re-renders (e.g. a fresh `dirty` flip).
  //
  // IMPORTANT: this guard is a plain `let`, not `$state`. Svelte 5
  // deeply proxies any object assigned to a `$state` slot — which
  // would make `regenResult === toastedRegenResult` permanently
  // false after the first assignment, re-firing the effect on every
  // reactive tick and pushing a fresh toast each time (see
  // regen-effect.test.ts for the repro). Plain `let` keeps the
  // reference identical and stops the effect tracking writes here.
  let toastedRegenResult: unknown = null;
  $effect(() => {
    if (!regenResult || regenResult === toastedRegenResult) return;
    toastedRegenResult = regenResult;
    // Dismiss the in-flight "Regenerating…" toast (if any) before the
    // result toast goes up, so the two don't briefly stack.
    if (regenProgressToastId) {
      dismissToast(regenProgressToastId);
      regenProgressToastId = null;
    }
    if (regenResult.ok) {
      // Single toast captures the whole outcome — partial failures
      // fold into the same line instead of stacking a second toast.
      const { lemmasProcessed, lemmasFailed, removed, inserted, failures } =
        regenResult;
      const total = lemmasProcessed + lemmasFailed;
      const lemmaWord = total === 1 ? 'lemma' : 'lemmas';
      let message: string;
      if (lemmasFailed === 0) {
        message = `Regenerated ${lemmasProcessed} ${lemmaWord} · removed ${removed} · inserted ${inserted}`;
      } else {
        const failedNames = failures
          .slice(0, 2)
          .map((f) => f.headword)
          .join(', ');
        const more = lemmasFailed > 2 ? ` (+${lemmasFailed - 2})` : '';
        message = `Regenerated ${lemmasProcessed} of ${total} ${lemmaWord} · ${lemmasFailed} failed: ${failedNames}${more}`;
      }
      // Use the error variant only when NOTHING succeeded; partial
      // success is still a success worth confirming.
      const kind = lemmasProcessed === 0 ? 'error' : 'success';
      pushToast({ kind, message });
    } else {
      pushToast({
        kind: 'error',
        message: `Regenerate failed: ${regenResult.message}`,
      });
    }
  });
</script>

<svelte:head>
  <title>{data.paradigm.name} — Paradigms — CIA Reader</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
  <p class="crumb">
    <a href="/moderation/paradigms">← Back to paradigms</a>
  </p>

  <header>
    <h1>{data.paradigm.name}</h1>
    <p class="sub">
      <span class="lang-badge">{data.paradigm.language}</span>
      <span class="pos-badge">{data.paradigm.pos}</span>
      · {data.slots.length} slot{data.slots.length === 1 ? '' : 's'}
    </p>
  </header>

  <!-- 1. Paradigm metadata -------------------------------------------------- -->
  <section>
    <h2>Paradigm</h2>
    <div class="stack">
      <label>
        Language
        <select bind:value={paradigmDraft.language} required>
          {#each data.languages as l (l.code)}
            <option value={l.code}>{l.displayName} ({l.nativeName})</option>
          {/each}
        </select>
      </label>
      <label>
        POS
        <input bind:value={paradigmDraft.pos} required maxlength="32" />
      </label>
      <label>
        Name
        <input bind:value={paradigmDraft.name} required maxlength="128" />
      </label>
      <label>
        Description
        <textarea
          bind:value={paradigmDraft.description}
          rows="3"
          maxlength="1000"
        ></textarea>
      </label>
    </div>
  </section>

  <!-- 2. Slot table ------------------------------------------------------- -->
  <section>
    <h2>Slots</h2>
    <p class="sub">
      Each slot defines one cell in the conjugation/declension grid. The
      generator appends <code>suffix</code> to a lemma's <code>stem</code> to
      produce the surface form. Features are emitted onto the resulting
      <code>lemma_forms.features</code> blob so the popup pills render
      correctly. Drag the grip handle to reorder (or focus a handle and
      press ↑ / ↓); delete to remove a slot entirely.
    </p>

    {#if slotResult}
      {#if slotResult.ok}
        <p class="ok">
          {#if slotResult.action === 'add'}Slot added.
          {:else if slotResult.action === 'remove'}Slot removed.
          {/if}
        </p>
      {:else}
        <p class="err">{slotResult.message}</p>
      {/if}
    {/if}

    {#if slotDrafts.length === 0}
      <p class="empty">No slots yet. Add one below.</p>
    {:else}
      <div class="slot-table" ondragleave={onDragLeaveList} role="list">
        <div class="slot-row slot-header" aria-hidden="true">
          <span class="col-handle"></span>
          <span class="col-key">slot_key</span>
          <span class="col-suffix">suffix</span>
          <span class="col-features">features (Key=Value, comma-separated)</span>
          <span class="col-actions"></span>
        </div>
        {#each slotDrafts as slot, i (slot.id)}
          <div
            class="slot-row"
            role="listitem"
            class:dragging={draggingIdx === i}
            class:drop-above={dropTargetIdx === i && draggingIdx !== i}
            class:drop-below={dropTargetIdx === i + 1 && draggingIdx !== i}
            ondragover={(e) => onDragOver(e, i)}
            ondrop={onDrop}
          >
            <span
              class="col-handle drag-handle"
              role="button"
              tabindex="0"
              draggable="true"
              data-handle-idx={i}
              title="Drag to reorder · ↑/↓ to nudge"
              aria-label="Drag handle for slot {slot.slotKey}"
              ondragstart={(e) => onDragStart(e, i)}
              ondragend={onDragEnd}
              onkeydown={(e) => onHandleKeydown(e, i)}
            >
              <svg
                width="14"
                height="20"
                viewBox="0 0 14 20"
                aria-hidden="true"
                focusable="false"
              >
                <circle cx="4" cy="4" r="1.5" />
                <circle cx="10" cy="4" r="1.5" />
                <circle cx="4" cy="10" r="1.5" />
                <circle cx="10" cy="10" r="1.5" />
                <circle cx="4" cy="16" r="1.5" />
                <circle cx="10" cy="16" r="1.5" />
              </svg>
            </span>
            <label class="col-key">
              <span class="vh">slot_key</span>
              <input
                bind:value={slot.slotKey}
                required
                maxlength="64"
                pattern="[a-z0-9_]+"
                title="lowercase, digits, underscore"
              />
            </label>
            <label class="col-suffix">
              <span class="vh">suffix</span>
              <input bind:value={slot.suffix} maxlength="64" />
            </label>
            <label class="col-features">
              <span class="vh">features</span>
              <input
                bind:value={slot.features}
                placeholder="Tense=Past, Person=1, Number=Sing"
              />
            </label>
            <span class="col-actions">
              {#if confirmingSlotId === slot.id}
                <form
                  method="post"
                  action="?/removeSlot"
                  use:enhance
                  class="confirm-inline"
                >
                  <input type="hidden" name="slotId" value={slot.id} />
                  <button
                    type="button"
                    class="iconbtn"
                    title="Cancel"
                    aria-label="Cancel delete"
                    onclick={() => (confirmingSlotId = null)}
                  >
                    ✕
                  </button>
                  <button
                    type="submit"
                    class="iconbtn danger"
                    title="Confirm delete"
                    aria-label="Confirm delete slot"
                  >
                    ✓
                  </button>
                </form>
              {:else}
                <button
                  type="button"
                  class="iconbtn danger"
                  title="Delete slot"
                  aria-label="Delete slot"
                  onclick={() => (confirmingSlotId = slot.id)}
                >
                  🗑
                </button>
              {/if}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- 3. Add slot --------------------------------------------------------- -->
  <section>
    <h2>Add slot</h2>
    <form method="post" action="?/addSlot" use:enhance class="add-slot-row">
      <!-- Empty column so the form lines up under the grip column of
           the slot table above. -->
      <span class="col-handle" aria-hidden="true"></span>
      <label class="col-key">
        <span class="vh">slot_key</span>
        <input
          name="slotKey"
          required
          maxlength="64"
          pattern="[a-z0-9_]+"
          placeholder="slot_key"
        />
      </label>
      <label class="col-suffix">
        <span class="vh">suffix</span>
        <input name="suffix" maxlength="64" placeholder="suffix" />
      </label>
      <label class="col-features">
        <span class="vh">features</span>
        <input
          name="features"
          placeholder="Tense=Pres, Aspect=Hab, Person=3, Number=Sing"
        />
      </label>
      <span class="col-actions">
        <button type="submit">Add</button>
      </span>
    </form>
  </section>

  <!-- 4. Delete paradigm --------------------------------------------------- -->
  <section class="danger-zone">
    <h2>Delete paradigm</h2>
    <p class="sub">
      Lemmas referencing this paradigm keep their <code>stem</code> but their
      <code>paradigm_id</code> is reset to NULL. Generator-created form rows
      lose their slot pointer and become orphans (curators can clean them
      up from each lemma's form editor).
    </p>

    {#if deleteResult && !deleteResult.ok}
      <p class="err">{deleteResult.message}</p>
    {/if}

    {#if confirmingParadigmDelete}
      <form method="post" action="?/deleteParadigm" use:enhance class="confirm">
        <p>
          Really delete <strong>{data.paradigm.name}</strong>? This wipes
          {data.slots.length} slot{data.slots.length === 1 ? '' : 's'}.
        </p>
        <div class="confirm-actions">
          <button
            type="button"
            onclick={() => (confirmingParadigmDelete = false)}
          >
            Cancel
          </button>
          <button type="submit" class="danger">Yes, delete</button>
        </div>
      </form>
    {:else}
      <button
        type="button"
        class="danger"
        onclick={() => (confirmingParadigmDelete = true)}
      >
        Delete paradigm
      </button>
    {/if}
  </section>
</div>

<!-- Sticky save bar — only visible / active when there are unsaved
     edits or a post-save confirmation. Regen results land in the
     toast host, so the bar doesn't have to stay open for them. -->
<div
  class="save-bar"
  class:hidden={!dirty && !saveResult}
>
  <div class="save-bar-inner">
    <!-- Top row: save action + post-save status -->
    <form
      method="post"
      action="?/saveAll"
      use:enhance
      class="save-row"
    >
      <input type="hidden" name="payload" value={savePayload} />
      {#if saveResult}
        {#if saveResult.ok}
          <span class="ok">Saved.</span>
        {:else}
          <span class="err">{saveResult.message}</span>
        {/if}
      {/if}
      <span class="spacer"></span>
      <button type="submit" class="save" disabled={!dirty}>
        {dirty ? 'Save changes' : 'No unsaved changes'}
      </button>
    </form>

  </div>
</div>

<!-- Regen confirmation modal — opens automatically after a save that
     reports lemmas using this paradigm. Uses native <dialog> for the
     focus trap, ESC handling, and backdrop. -->
<dialog
  bind:this={regenDialog}
  class="regen-dialog"
  oncancel={dismissRegenPrompt}
  onclose={() => {
    if (regenPromptVisible) {
      // The dialog was dismissed via ESC or close() not initiated
      // by our own dismiss handler — mark it dismissed so the
      // $effect doesn't re-open it on the next reactive tick.
      dismissedRegenForSave = form; dismissBump += 1;
    }
  }}
>
  {#if saveResult?.ok && saveResult.affectedLemmaCount > 0}
    <h3>Regenerate forms?</h3>
    <p>
      <strong>{saveResult.affectedLemmaCount}</strong>
      {saveResult.affectedLemmaCount === 1 ? 'lemma uses' : 'lemmas use'}
      this paradigm. Their generator-created
      <code>lemma_forms</code> rows reflect the
      <em>previous</em> slot definitions and are now stale.
    </p>
    <p class="dialog-sub">
      Regenerating wipes every non-curator form row on each affected
      lemma and rebuilds from the current slots. Curator-edited forms
      are preserved.
    </p>
    <div class="dialog-actions">
      <button
        type="button"
        class="dismiss"
        disabled={regenPending}
        onclick={dismissRegenPrompt}
      >
        Not now
      </button>
      <form
        method="post"
        action="?/regenerateAffected"
        use:enhance={() => {
          // Close the modal immediately and surface progress as a
          // sticky toast. The regen loops over every affected lemma
          // sequentially (each makes an NLP romanize call) so it
          // can run for tens of seconds — leaving the modal open
          // would render the page `inert` for that whole window
          // and make the editor feel frozen.
          regenPending = true;
          regenProgressToastId = pushToast({
            kind: 'info',
            message: `Regenerating forms for ${saveResult?.ok ? saveResult.affectedLemmaCount : ''} lemmas…`.replace(
              '  ',
              ' ',
            ),
            duration: null,
          });
          dismissedRegenForSave = form; dismissBump += 1;
          regenDialog?.close();
          return async ({ update }) => {
            try {
              await update();
            } finally {
              // Reset even if update() threw — otherwise the next
              // attempt would see stale state. The result-watching
              // $effect handles dismissing the progress toast +
              // pushing the success/error toast.
              regenPending = false;
            }
          };
        }}
      >
        <button type="submit" class="regen" disabled={regenPending}>
          {regenPending ? 'Regenerating…' : 'Regenerate forms'}
        </button>
      </form>
    </div>
  {/if}
</dialog>

<style>
  .page {
    max-width: 64rem;
    margin: 0 auto;
    /* Reserve room at the bottom so the sticky save bar doesn't cover
       the last section. */
    padding: 1.5rem 1.25rem 6rem;
  }
  .crumb {
    margin: 0 0 1rem;
    font-size: 0.9rem;
  }
  .crumb a {
    color: var(--color-accent);
  }
  header h1 {
    margin: 0 0 0.25rem;
    font-size: 1.6rem;
  }
  .sub {
    margin: 0 0 0.75rem;
    color: var(--color-fg-muted);
    font-size: 0.9rem;
  }
  section {
    margin: 1.75rem 0;
    padding: 1rem 1.25rem;
    border: 1px solid var(--color-border);
    border-radius: 8px;
  }
  section h2 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
  }
  .lang-badge,
  .pos-badge {
    font-size: 0.7rem;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    background: var(--color-border);
    color: var(--color-fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .stack > * {
    margin-bottom: 0.75rem;
  }
  label {
    display: block;
    font-size: 0.9rem;
  }
  input,
  textarea,
  select {
    display: block;
    width: 100%;
    margin-top: 0.25rem;
    padding: 0.5rem 0.6rem;
    font: inherit;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-bg);
    color: var(--color-fg);
    min-height: 44px;
  }
  textarea {
    min-height: 5rem;
    resize: vertical;
  }
  button {
    min-height: 44px;
    padding: 0 1rem;
    background: var(--color-accent);
    color: var(--color-accent-fg, #fff);
    border: 0;
    border-radius: 6px;
    cursor: pointer;
  }
  button[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }
  button.danger {
    background: #b03131;
    color: #fff;
  }

  /* ── Slot grid ────────────────────────────────────────────────── */
  .slot-table {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .slot-row {
    /* Grip handle column is auto-width so it sticks to its 22px target
       regardless of viewport size; everything else shares the
       remaining space. */
    display: grid;
    grid-template-columns:
      28px
      minmax(7rem, 1fr)
      minmax(4rem, 0.8fr)
      minmax(10rem, 2.2fr)
      auto;
    gap: 0.4rem;
    align-items: end;
    padding: 0.35rem 0;
    border-top: 2px solid transparent;
    border-bottom: 1px solid var(--color-border);
    transition: opacity 80ms ease;
  }
  .slot-row:last-child {
    border-bottom: 0;
  }
  .slot-row.dragging {
    opacity: 0.4;
  }
  /* Drop indicators: a thicker accent-colored top or bottom border on
     the target row, so the user sees exactly where the dragged slot
     will land. */
  .slot-row.drop-above {
    border-top-color: var(--color-accent);
  }
  .slot-row.drop-below {
    border-bottom: 2px solid var(--color-accent);
  }
  .slot-header {
    border-bottom: 0;
    font-size: 0.75rem;
    color: var(--color-fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding-bottom: 0;
  }
  .slot-header > span {
    padding: 0 0.4rem;
  }
  .slot-row label {
    margin: 0;
  }
  .slot-row input {
    margin-top: 0;
    min-height: 36px;
    padding: 0.3rem 0.5rem;
    font-size: 0.9rem;
  }

  /* Drag handle — 28px square, vertical "grip" of six dots in an
     SVG. The whole element is focusable + draggable; the SVG is
     pointer-events:none so child events don't get in the way. */
  .col-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: stretch;
  }
  .drag-handle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 36px;
    color: var(--color-fg-muted);
    background: transparent;
    border-radius: 6px;
    cursor: grab;
    user-select: none;
    outline: none;
  }
  .drag-handle:hover,
  .drag-handle:focus-visible {
    background: var(--color-border);
    color: var(--color-fg);
  }
  .drag-handle:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }
  .drag-handle:active {
    cursor: grabbing;
  }
  .drag-handle svg {
    fill: currentColor;
    pointer-events: none;
  }
  .col-actions {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    justify-content: flex-end;
  }
  .iconbtn {
    min-height: 32px;
    min-width: 32px;
    padding: 0 0.4rem;
    background: var(--color-bg);
    color: var(--color-fg);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    font-size: 0.9rem;
    line-height: 1;
    cursor: pointer;
  }
  .iconbtn.danger {
    color: #b03131;
    border-color: rgba(176, 49, 49, 0.4);
    background: var(--color-bg);
  }
  .iconbtn.danger:hover:not([disabled]) {
    background: rgba(176, 49, 49, 0.08);
  }
  .confirm-inline {
    display: flex;
    gap: 0.3rem;
  }

  /* Visually-hidden header text — the column header row above acts
     as the visible label, but each input still carries a screen-
     reader-only label for assistive tech. */
  .vh {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  /* ── Add-slot row uses the same grid so columns line up ───────── */
  .add-slot-row {
    display: grid;
    grid-template-columns:
      28px
      minmax(7rem, 1fr)
      minmax(4rem, 0.8fr)
      minmax(10rem, 2.2fr)
      auto;
    gap: 0.4rem;
    align-items: end;
  }
  .add-slot-row input {
    margin-top: 0;
    min-height: 36px;
    padding: 0.3rem 0.5rem;
    font-size: 0.9rem;
  }
  .add-slot-row button {
    min-height: 36px;
    padding: 0 0.85rem;
  }

  /* ── Sticky save bar ──────────────────────────────────────────── */
  .save-bar {
    position: sticky;
    bottom: 0;
    left: 0;
    right: 0;
    margin: 0;
    background: var(--color-bg);
    border-top: 1px solid var(--color-border);
    padding: 0.6rem 1.25rem;
    transition: transform 150ms ease;
  }
  .save-bar.hidden {
    transform: translateY(120%);
    pointer-events: none;
  }
  .save-bar-inner {
    max-width: 64rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .save-row {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .save-bar .spacer {
    flex: 1;
  }
  .save-bar .save {
    min-height: 40px;
    padding: 0 1.2rem;
  }

  /* ── Regen confirmation dialog ─────────────────────────────────── */
  .regen-dialog {
    max-width: 30rem;
    width: calc(100% - 2rem);
    padding: 1.25rem 1.5rem;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    background: var(--color-bg);
    color: var(--color-fg);
    /* Browsers vary on default <dialog> centering; pin it explicitly
       so the modal lands middle of the viewport on every engine. */
    margin: auto;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
  }
  .regen-dialog::backdrop {
    background: rgba(0, 0, 0, 0.45);
  }
  .regen-dialog h3 {
    margin: 0 0 0.5rem;
    font-size: 1.15rem;
  }
  .regen-dialog p {
    margin: 0 0 0.6rem;
    font-size: 0.95rem;
    line-height: 1.5;
  }
  .regen-dialog .dialog-sub {
    font-size: 0.85rem;
    color: var(--color-fg-muted);
  }
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
  }
  .regen {
    min-height: 40px;
    padding: 0 1rem;
    background: var(--color-accent);
    color: var(--color-accent-fg, #fff);
    border: 0;
    border-radius: 6px;
    cursor: pointer;
  }
  .regen[disabled] {
    opacity: 0.6;
    cursor: progress;
  }
  .dismiss {
    min-height: 40px;
    padding: 0 0.85rem;
    background: transparent;
    color: var(--color-fg);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    cursor: pointer;
  }
  .dismiss[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }


  .empty {
    margin: 0.5rem 0;
    color: var(--color-fg-muted);
  }
  .ok {
    color: #197a2f;
  }
  .err {
    color: #b03131;
  }
  .danger-zone {
    border-color: rgba(176, 49, 49, 0.4);
  }
  .confirm {
    margin-top: 0.75rem;
  }
  .confirm-actions {
    display: flex;
    gap: 0.5rem;
  }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85em;
  }
</style>
