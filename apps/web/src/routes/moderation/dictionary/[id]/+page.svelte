<script lang="ts">
  import { enhance } from '$app/forms';
  import ProvenanceBadge from '$lib/components/dictionary/ProvenanceBadge.svelte';
  import LemmaInlineField from './LemmaInlineField.svelte';
  import LemmaInlinePos from './LemmaInlinePos.svelte';
  import type { ActionData, PageData } from './$types';

  let {
    data,
    form,
  }: { data: PageData; form: ActionData } = $props();

  const lemma = $derived(data.lemma);
  const formsList = $derived(data.forms ?? []);
  const availableParadigms = $derived(data.availableParadigms ?? []);

  function msgFor(section: string): string | null {
    if (!form) return null;
    if (form.section !== section) return null;
    if (form.ok) return 'Saved.';
    return form.message;
  }

  /** Render `Tense=Past, Person=1` from a features blob — same shape
   *  the form input expects, so editing round-trips cleanly. */
  function featuresToString(features: Record<string, string>): string {
    return Object.entries(features)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
  }

  /**
   * Group a form's features into a display section ("Present habitual",
   * "Past", "Imperative", …). Used by the editor to lay out the 28-row
   * Odia regular verb output in a way a curator can scan. Sections are
   * sorted by `sortKey`; rows within a section are sorted by person +
   * number (1sg, 2sg, 3sg, 1pl, 2pl, 3pl), with non-finite forms
   * (infinitive, imperative familiar) treated as a single row each.
   *
   * The key derivation is heuristic — it covers the verb shapes the
   * Odia paradigm seeds today and falls back to "Other" for anything
   * a curator manually adds with no recognised tense / verb form. For
   * nominal paradigms (case + number declensions) "Declined forms" is
   * a stub bucket that future PRs will refine.
   */
  type FormSectionKind = {
    label: string;
    sortKey: number;
  };
  function sectionFor(features: Record<string, string>): FormSectionKind {
    if (features.Mood === 'Imp') return { label: 'Imperative', sortKey: 110 };
    if (features.VerbForm === 'Inf') return { label: 'Infinitive', sortKey: 5 };
    if (features.VerbForm === 'Part') return { label: 'Participle', sortKey: 200 };
    if (features.VerbForm === 'Ger') return { label: 'Gerund', sortKey: 210 };
    if (features.Tense === 'Pres') {
      if (features.Aspect === 'Hab') return { label: 'Present habitual', sortKey: 10 };
      if (features.Aspect === 'Prog') return { label: 'Present progressive', sortKey: 20 };
      if (features.Aspect === 'Perf') return { label: 'Present perfect', sortKey: 30 };
      return { label: 'Present', sortKey: 15 };
    }
    if (features.Tense === 'Past') {
      if (features.Aspect === 'Prog') return { label: 'Past progressive', sortKey: 50 };
      if (features.Aspect === 'Perf') return { label: 'Past perfect', sortKey: 60 };
      return { label: 'Past', sortKey: 40 };
    }
    if (features.Tense === 'Fut') {
      if (features.Aspect === 'Prog') return { label: 'Future progressive', sortKey: 80 };
      return { label: 'Future', sortKey: 70 };
    }
    if (features.Case || features.Gender) {
      return { label: 'Declined forms', sortKey: 500 };
    }
    return { label: 'Other', sortKey: 999 };
  }

  /** 1sg < 2sg < 3sg < 1pl < 2pl < 3pl < no-person. */
  function personSortKey(features: Record<string, string>): number {
    const personRaw = features.Person;
    const person = personRaw === '1' ? 1 : personRaw === '2' ? 2 : personRaw === '3' ? 3 : 9;
    const number = features.Number === 'Sing' ? 0 : features.Number === 'Plur' ? 1 : 2;
    // Politeness disambiguates the two 2pl rows in Odia regular verbs
    // ("tume raha" vs "semane raha…tu") — formal sorts after informal.
    const politeness = features.Politeness === 'Form' ? 1 : 0;
    return person * 100 + number * 10 + politeness;
  }

  type FormRow = (typeof formsList)[number];
  type FormSection = {
    label: string;
    sortKey: number;
    forms: FormRow[];
  };
  // Live (non-quarantined) rows grouped + sorted; quarantined rows
  // get their own bucket so a curator can spot them but they don't
  // pollute the verb table.
  const groupedForms = $derived.by<{ live: FormSection[]; quarantined: FormRow[] }>(
    () => {
      const sections = new Map<string, FormSection>();
      const quarantined: FormRow[] = [];
      for (const f of formsList) {
        if (f.quarantinedAt !== null) {
          quarantined.push(f);
          continue;
        }
        const kind = sectionFor(f.features);
        let bucket = sections.get(kind.label);
        if (!bucket) {
          bucket = { label: kind.label, sortKey: kind.sortKey, forms: [] };
          sections.set(kind.label, bucket);
        }
        bucket.forms.push(f);
      }
      const live = [...sections.values()].sort((a, b) => a.sortKey - b.sortKey);
      for (const s of live) {
        s.forms.sort((a, b) => {
          const personDelta = personSortKey(a.features) - personSortKey(b.features);
          if (personDelta !== 0) return personDelta;
          // Tie-break by surface so the order is deterministic across
          // re-renders even if two slots share Person + Number.
          return a.surface.localeCompare(b.surface);
        });
      }
      quarantined.sort((a, b) => a.surface.localeCompare(b.surface));
      return { live, quarantined };
    },
  );

  /** Compact label for forms that don't fit the person×number grid
   *  (infinitive, imperative variants, perfect aspect, etc.). The
   *  grid cells get their own person/number axis from the layout
   *  itself so they don't carry a slot label. */
  function slotLabel(features: Record<string, string>): string {
    if (features.Mood === 'Imp') {
      if (features.Politeness === 'Form') return 'imperative · polite';
      if (features.Politeness === 'Infm') return 'imperative · familiar';
      return 'imperative';
    }
    if (features.VerbForm === 'Inf') return 'infinitive';
    if (features.VerbForm === 'Part') return 'participle';
    if (features.VerbForm === 'Ger') return 'gerund';
    return '';
  }

  /**
   * One row in a tense grid — `(person, politeness)` is the row axis,
   * `Number` (Sing/Plur) is the column axis. Replaces the previous
   * stack-multiple-cells-in-one-bucket approach so the design's row
   * label (e.g. "2ⁿᵈ fam.") encodes the politeness instead of a
   * sublabel jammed into the cell.
   */
  type RowGroup = {
    key: string;
    label: string;
    sortKey: number;
    sing: FormRow[];
    plur: FormRow[];
  };
  type SectionGrid = {
    rows: RowGroup[];
    other: FormRow[];
    hasGrid: boolean;
  };

  // Ordinal renderings — the design uses superscript suffixes.
  const ORDINALS: Record<string, string> = { '1': '1ˢᵗ', '2': '2ⁿᵈ', '3': '3ʳᵈ' };

  /** Politeness suffix on the row label, plus a sub-sort key so row
   *  order is `1ˢᵗ < 2ⁿᵈ fam. < 2ⁿᵈ < 2ⁿᵈ pol. < 2ⁿᵈ honor. < 3ʳᵈ`. */
  function politenessSuffix(pol: string | undefined): { label: string; sub: number } {
    if (pol === 'Infm') return { label: ' fam.', sub: 1 };
    if (pol === 'Form') return { label: ' pol.', sub: 3 };
    if (pol === 'Elev') return { label: ' honor.', sub: 4 };
    return { label: '', sub: 2 };
  }

  /** Split a section's forms into rows (person × politeness, with
   *  number as the column) and a tail list for forms with no
   *  person/number axis (infinitive, imperative, perfect, etc.). */
  function splitGridForms(forms: FormRow[]): SectionGrid {
    const rowsMap = new Map<string, RowGroup>();
    const other: FormRow[] = [];
    for (const f of forms) {
      const p = f.features.Person;
      const pol = f.features.Politeness;
      const n = f.features.Number;
      const personOk = p === '1' || p === '2' || p === '3';
      const numberOk = n === 'Sing' || n === 'Plur';
      if (!personOk || !numberOk) {
        other.push(f);
        continue;
      }
      const key = `${p}-${pol ?? ''}`;
      let row = rowsMap.get(key);
      if (!row) {
        const suf = politenessSuffix(pol);
        row = {
          key,
          label: (ORDINALS[p] ?? p) + suf.label,
          sortKey: Number(p) * 10 + suf.sub,
          sing: [],
          plur: [],
        };
        rowsMap.set(key, row);
      }
      if (n === 'Sing') row.sing.push(f);
      else row.plur.push(f);
    }
    const rows = [...rowsMap.values()].sort((a, b) => a.sortKey - b.sortKey);
    return { rows, other, hasGrid: rows.length > 0 };
  }

  /**
   * Escape inside an open form-edit `<details>` cancels by collapsing
   * the details. We deliberately do NOT call `form.reset()` here:
   * Svelte 5 sets `value={...}` as the property rather than the HTML
   * attribute, so the inputs' `defaultValue` is the empty string and
   * reset would blank the fields on the next open. The cancel
   * semantic is preserved because nothing was submitted; if the
   * curator reopens, they see their typed text and can either submit
   * it or keep editing.
   *
   * Enter is intentionally not handled here — pressing Enter inside
   * any input already submits the form via the `<button type="submit">`
   * Save action, which is the "confirm edit" semantic the curator
   * expects.
   */
  function onFormEditKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    const details = (e.currentTarget as HTMLElement).closest('details');
    if (!details) return;
    details.open = false;
    e.stopPropagation();
  }

  function translationMsg(
    translationId: string,
  ): { ok: boolean; message: string } | null {
    if (!form || form.section !== 'translation') return null;
    if (form.translationId !== translationId) return null;
    return {
      ok: form.ok,
      message: form.ok ? 'Saved.' : form.message,
    };
  }

  /**
   * Operations dropdown — Lock / Unlock, Merge, Split, Delete behind
   * a single button. Merge + Split need form data (loserId / new
   * headword), so they expand to an inline form below the menu;
   * Lock and Delete fire directly. Closes on Escape and on outside
   * click (handled at the document level).
   */
  type OpsMode = null | 'menu' | 'merge' | 'split' | 'delete';
  let opsMode = $state<OpsMode>(null);
  function closeOps(): void {
    opsMode = null;
  }
  function openMenu(): void {
    opsMode = opsMode === 'menu' ? null : 'menu';
  }

  // ⌘S commits the focused field, R triggers regenerate, Esc closes
  // any open overlays. We stay out of `<input>` and `<textarea>` for
  // single-letter shortcuts so typing inside an inline edit doesn't
  // accidentally fire R.
  $effect(() => {
    function onKey(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null;
      const inField =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT');
      if (e.key === 'Escape') {
        closeOps();
      }
      // ⌘S inside a focused input commits via blur; we just suppress
      // the browser's "save page" handler.
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        if (inField && target instanceof HTMLElement) {
          e.preventDefault();
          target.blur();
        }
      }
      if (!inField && e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey) {
        const btn = document.querySelector<HTMLButtonElement>(
          '[data-shortcut="regenerate"]',
        );
        btn?.click();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Build the comma-separated orderedTranslationIds for swapping rows
  // (i, j). Returns the unswapped order if either index is out of
  // range — the corresponding button is disabled in that case anyway,
  // so the form value doesn't matter; the type-safe path keeps Svelte
  // happy.
  function swappedOrder(translations: Array<{ id: string }>, i: number, j: number): string {
    const ids = translations.map((t) => t.id);
    if (i < 0 || j < 0 || i >= ids.length || j >= ids.length) {
      return ids.join(',');
    }
    const tmp = ids[i] as string;
    ids[i] = ids[j] as string;
    ids[j] = tmp;
    return ids.join(',');
  }
</script>

<svelte:head>
  <title>Edit {lemma.headword} — CIA Reader</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page mod">
  <!-- ════════ Compact 3-col header strip ════════ -->
  <header class="mod-head">
    <nav class="mod-crumb" aria-label="Breadcrumb">
      <a href="/moderation">Moderation</a>
      <span class="mod-crumb-sep">/</span>
      <a href="/moderation/dictionary?language={lemma.language}">Dictionary</a>
      <span class="mod-crumb-sep">/</span>
      <span class="mod-crumb-cur">Edit lemma</span>
    </nav>

    <div class="mod-id">
      <span class="mod-hw-script" lang={lemma.language}>{lemma.headword}</span>
      <span class="mod-id-pos">{lemma.pos}</span>
    </div>

    <div class="mod-head-actions">
      {#if msgFor('lemma')}
        <span class:ok={form?.ok} class:err={!form?.ok} class="mod-flash">
          {msgFor('lemma')}
        </span>
      {/if}
      <div class="mod-ops-wrap">
        <button
          type="button"
          class="mod-btn-ghost"
          onclick={openMenu}
          aria-haspopup="menu"
          aria-expanded={opsMode === 'menu'}
        >
          Operations <span class="mod-ops-caret" aria-hidden="true">▾</span>
        </button>
        {#if opsMode === 'menu'}
          <div class="mod-ops-menu" role="menu">
            <form method="post" action="?/setLock" use:enhance={() => closeOps}>
              <input
                type="hidden"
                name="locked"
                value={lemma.curatorLocked ? 'false' : 'true'}
              />
              <button type="submit" class="mod-ops-item">
                <span>{lemma.curatorLocked ? '🔓 Unlock lemma' : '🔒 Lock lemma'}</span>
                <em>Skips re-imports while locked</em>
              </button>
            </form>
            <div class="mod-ops-div"></div>
            <button
              type="button"
              class="mod-ops-item"
              onclick={() => (opsMode = 'merge')}
            >
              <span>⤳ Merge into…</span>
              <em>Rewire translations + forms; deletes loser</em>
            </button>
            <button
              type="button"
              class="mod-ops-item"
              onclick={() => (opsMode = 'split')}
            >
              <span>⤴ Split off new lemma</span>
              <em>Move selected translations to a new curator lemma</em>
            </button>
            <div class="mod-ops-div"></div>
            <button
              type="button"
              class="mod-ops-item danger"
              onclick={() => (opsMode = 'delete')}
            >
              <span>⌫ Delete lemma…</span>
              <em>Removes lemma + cascades to forms</em>
            </button>
          </div>
        {/if}
      </div>
    </div>

    {#if lemma.curatorLocked}
      <div class="mod-id-meta">
        <span class="mod-locked">🔒 locked</span>
      </div>
    {/if}
  </header>

  <!-- Editable inline lemma row — click any field to edit. -->
  <div class="mod-lemma-inline">
    <LemmaInlineField
      field="headword"
      value={lemma.headword}
      placeholder="headword"
      lang={lemma.language}
      script
      class="mli-headword"
    />
    <span class="mli-divider"></span>
    <LemmaInlinePos value={lemma.pos} />
    <span class="mli-divider"></span>
    <LemmaInlineField
      field="glossDefault"
      value={lemma.glossDefault ?? ''}
      placeholder="add a gloss…"
      multiline
      class="mli-gloss"
    />
    <span class="mli-divider"></span>
    <label class="mli-fld">
      <span class="mli-fld-l">rank</span>
      <LemmaInlineField
        field="frequencyRank"
        value={lemma.frequencyRank?.toString() ?? ''}
        placeholder="—"
        numeric
        class="mli-freq"
      />
    </label>
    <button class="mli-translations" type="button" title="Translations">
      <span class="mli-tr-count">{data.translations.length}</span>
      <span class="mli-tr-l">translations</span>
      <span class="mli-tr-add" aria-hidden="true">＋</span>
    </button>
  </div>

  {#if opsMode === 'merge'}
    <div class="mod-ops-panel" data-mode="merge">
      <h2>Merge into this lemma</h2>
      {#if msgFor('merge')}
        <p class:ok={form?.ok} class:err={!form?.ok}>{msgFor('merge')}</p>
      {/if}
      <p class="sub">
        Rewires translations + forms from the loser into this one, then deletes
        the loser. Cross-language merges are rejected.
      </p>
      <form
        method="post"
        action="?/merge"
        use:enhance={() => closeOps}
        class="inline-form"
      >
        <input
          name="loserId"
          required
          placeholder="loser lemma uuid"
          class="grow"
        />
        <button type="submit" class="danger">Merge</button>
        <button type="button" onclick={closeOps}>Cancel</button>
      </form>
    </div>
  {/if}

  {#if opsMode === 'split'}
    <div class="mod-ops-panel" data-mode="split">
      <h2>Split off a new lemma</h2>
      {#if msgFor('split')}
        <p class:ok={form?.ok} class:err={!form?.ok}>
          {msgFor('split')}
          {#if form?.ok && form.section === 'split'}
            <a href={`/moderation/dictionary/${form.newLemmaId}`}>Open new lemma →</a>
          {/if}
        </p>
      {/if}
      <p class="sub">
        Creates a new curator-owned lemma and moves the selected translations
        onto it.
      </p>
      <form
        method="post"
        action="?/split"
        use:enhance={() => closeOps}
        class="stack"
      >
        <div class="row">
          <input name="newHeadword" required placeholder="new headword" />
          <input name="newPos" required placeholder="POS" />
          <input name="newGloss" placeholder="new gloss (optional)" />
        </div>
        <textarea
          name="translationIds"
          rows="2"
          placeholder="translation ids to move (comma- or space-separated)"
        ></textarea>
        <div class="row">
          <button type="submit" class="danger">Split</button>
          <button type="button" onclick={closeOps}>Cancel</button>
        </div>
      </form>
    </div>
  {/if}

  {#if opsMode === 'delete'}
    <div class="mod-ops-panel" data-mode="delete">
      <h2>Delete this lemma?</h2>
      {#if msgFor('delete')}
        <p class:err={true}>{msgFor('delete')}</p>
      {/if}
      <p class="sub">
        Permanently removes the lemma row. Cascades to its forms and
        translations. Audit history for this lemma is also dropped. There's no
        undo.
      </p>
      <form method="post" action="?/deleteLemma" use:enhance={() => closeOps}>
        <button type="submit" class="danger">Yes, delete</button>
        <button type="button" onclick={closeOps}>Cancel</button>
      </form>
    </div>
  {/if}

  <!-- Translations ------------------------------------------------------ -->
  <section>
    <h2>Translations ({data.translations.length})</h2>
    {#if msgFor('reorder')}
      <p class:ok={form?.ok} class:err={!form?.ok}>{msgFor('reorder')}</p>
    {/if}
    {#if data.translations.length === 0}
      <p class="muted">No translations.</p>
    {:else}
      <ul class="translations">
        {#each data.translations as t, i (t.id)}
          <li>
            <div class="meta">
              <ProvenanceBadge provenance={t.provenance} />
              <span class="muted">{t.targetLanguage}</span>
              {#if t.hidden}<span class="tag warn">hidden</span>{/if}
              {#if data.translations.length > 1}
                <span class="reorder-buttons">
                  <form method="post" action="?/reorderTranslations" use:enhance>
                    <input
                      type="hidden"
                      name="orderedTranslationIds"
                      value={swappedOrder(data.translations, i, i - 1)}
                    />
                    <button
                      type="submit"
                      class="arrow"
                      aria-label="Move up"
                      disabled={i === 0}
                    >↑</button>
                  </form>
                  <form method="post" action="?/reorderTranslations" use:enhance>
                    <input
                      type="hidden"
                      name="orderedTranslationIds"
                      value={swappedOrder(data.translations, i, i + 1)}
                    />
                    <button
                      type="submit"
                      class="arrow"
                      aria-label="Move down"
                      disabled={i === data.translations.length - 1}
                    >↓</button>
                  </form>
                </span>
              {/if}
            </div>
            {#if translationMsg(t.id)}
              {@const tm = translationMsg(t.id)!}
              <p class:ok={tm.ok} class:err={!tm.ok}>{tm.message}</p>
            {/if}
            <form method="post" action="?/updateTranslation" use:enhance class="stack">
              <input type="hidden" name="translationId" value={t.id} />
              <label>
                Body
                <textarea name="body" rows="2" required>{t.body}</textarea>
              </label>
              {#if t.source === 'user'}
                <label class="checkbox">
                  <input type="checkbox" name="promoteToCurator" value="true" />
                  Promote to curator (official)
                </label>
              {/if}
              <div class="row-actions">
                <button type="submit">Save</button>
                {#if t.source === 'user'}
                  <button
                    type="submit"
                    formaction="?/setTranslationHidden"
                    name="hidden"
                    value={t.hidden ? 'false' : 'true'}
                    class="secondary"
                  >
                    {t.hidden ? 'Unhide' : 'Hide'}
                  </button>
                {/if}
              </div>
            </form>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- Forms (paradigm + per-form CRUD) ---------------------------------- -->
  <section class="forms-sec">
    <h2 class="forms-h">
      Forms
      <span class="forms-h-count">{formsList.length}</span>
      <span class="mod-spread"></span>
      {#if lemma.paradigmId && lemma.stem}
        <form
          method="post"
          action="?/regenerateForms"
          use:enhance
          class="forms-h-regen"
        >
          <button type="submit" class="mod-btn-ghost" data-shortcut="regenerate">
            ⟳ Regenerate <kbd>R</kbd>
          </button>
        </form>
      {/if}
    </h2>

    <!-- Compact paradigm bar -->
    <form
      method="post"
      action="?/setParadigm"
      use:enhance
      class="paradigm-bar"
      data-testid="paradigm-form"
    >
      <label class="pb-fld">
        <span>PARADIGM</span>
        <select name="paradigmId" class="mod-in">
          <option value="none" selected={!lemma.paradigmId}>— none —</option>
          {#each availableParadigms as p (p.id)}
            <option value={p.id} selected={lemma.paradigmId === p.id}>
              {p.name}
            </option>
          {/each}
        </select>
      </label>
      <label class="pb-fld pb-stem">
        <span>STEM</span>
        <input
          name="stem"
          value={lemma.stem ?? ''}
          placeholder="ର ହ"
          maxlength="64"
          class="mod-in mod-in-script"
          lang={lemma.language}
        />
      </label>
      <button type="submit" class="mod-btn-ghost">Save</button>
      {#if msgFor('paradigm')}
        <span class:ok={form?.ok} class:err={!form?.ok} class="mod-flash">
          {msgFor('paradigm')}
        </span>
      {/if}
    </form>

    <!-- Existing forms list, grouped by tense / aspect -->
    {#snippet formCellRow(f: FormRow, alwaysShowSlotKey: boolean)}
      {@const sourceTitle =
        f.createdBy === 'curator'
          ? `Hand-edited by curator. Survives regenerate.`
          : f.createdBy === 'generator'
            ? `Generated from paradigm slot ${f.paradigmSlotKey ?? '?'}. Will be replaced on next regenerate.`
            : f.createdBy === 'import'
              ? 'Imported from a dictionary source. Will be replaced on next regenerate.'
              : 'Written by the NLP pipeline. Will be replaced on next regenerate.'}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <details
        class="pcell"
        class:quar={f.quarantinedAt !== null}
        data-testid="form-row"
        data-form-id={f.id}
        onkeydown={onFormEditKeydown}
      >
        <summary class="pcell-head" title={sourceTitle}>
          <span
            class="pcell-prov"
            data-created-by={f.createdBy}
            aria-hidden="true"
          ></span>
          <span class="pcell-script" lang={lemma.language}>{f.surface}</span>
          {#if f.romanization}
            <span class="pcell-roman">{f.romanization}</span>
          {/if}
        </summary>
        {#if alwaysShowSlotKey || f.paradigmSlotKey}
          <span class="pcell-slot">
            {f.paradigmSlotKey ?? slotLabel(f.features) ?? ''}
          </span>
        {/if}
        <form method="post" action="?/editForm" use:enhance class="form-edit">
          <input type="hidden" name="formId" value={f.id} />
          <label>
            Surface
            <input name="surface" value={f.surface} required maxlength="256" />
          </label>
          <label>
            Features
            <input
              name="features"
              value={featuresToString(f.features)}
              placeholder="Tense=Past, Person=1, Number=Sing"
              maxlength="1024"
            />
          </label>
          <label>
            Romanization
            <input
              name="romanization"
              value={f.romanization ?? ''}
              maxlength="256"
            />
          </label>
          <div class="form-edit-actions">
            <button type="submit">Save</button>
          </div>
        </form>
        <form method="post" action="?/removeForm" use:enhance class="form-remove">
          <input type="hidden" name="formId" value={f.id} />
          <button type="submit" class="danger small">Delete form</button>
        </form>
      </details>
    {/snippet}

    {#if formsList.length === 0}
      <p class="muted">No forms recorded yet.</p>
    {:else}
      <div class="paradigm" data-testid="forms-list">
        {#each groupedForms.live as section (section.label)}
          {@const split = splitGridForms(section.forms)}
          <article class="pgroup" data-section={section.label}>
            <header class="pgroup-h">
              <span>{section.label}</span>
            </header>

            {#if split.hasGrid}
              <div class="pgrid">
                <span></span>
                <span class="pcol-h">SINGULAR</span>
                <span class="pcol-h">PLURAL</span>
                {#each split.rows as row (row.key)}
                  <span class="prow-l">{row.label}</span>
                  <div class="pgrid-cell">
                    {#each row.sing as f (f.id)}
                      {@render formCellRow(f, true)}
                    {:else}
                      <span class="pcell empty">—</span>
                    {/each}
                  </div>
                  <div class="pgrid-cell">
                    {#each row.plur as f (f.id)}
                      {@render formCellRow(f, true)}
                    {:else}
                      <span class="pcell empty">—</span>
                    {/each}
                  </div>
                {/each}
              </div>
            {/if}

            {#if split.other.length > 0}
              <div class="pflat">
                {#each split.other as f (f.id)}
                  <div class="pflat-row">
                    <span class="prow-l">{slotLabel(f.features) || ''}</span>
                    <div class="pgrid-cell">
                      {@render formCellRow(f, true)}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </article>
        {/each}

        {#if groupedForms.quarantined.length > 0}
          <article
            class="pgroup pgroup-quar"
            data-section="Quarantined"
          >
            <header class="pgroup-h">
              <span>
                Quarantined
                <span class="muted small">({groupedForms.quarantined.length})</span>
              </span>
            </header>
            <p class="muted small">
              Excluded from reader lookup. Likely junk imports — review and
              delete or salvage.
            </p>
            <div class="pflat">
              {#each groupedForms.quarantined as f (f.id)}
                <div class="pflat-row">
                  <details
                    class="pcell quar"
                    data-testid="form-row"
                    data-form-id={f.id}
                  >
                    <summary class="pcell-head">
                      <span class="pcell-script">{f.surface}</span>
                      <span class="pcell-quar">
                        ⚠ {f.quarantineReason ?? 'quarantined'}
                      </span>
                    </summary>
                    <form
                      method="post"
                      action="?/removeForm"
                      use:enhance
                      class="form-remove"
                    >
                      <input type="hidden" name="formId" value={f.id} />
                      <button type="submit" class="danger small">Delete</button>
                    </form>
                  </details>
                </div>
              {/each}
            </div>
          </article>
        {/if}
      </div>
    {/if}

    <!-- Add new form -->
    <details class="add-form-details">
      <summary>+ Add new form</summary>
      <form
        method="post"
        action="?/addForm"
        use:enhance
        class="form-edit"
        data-testid="add-form"
      >
        <label>
          Surface
          <input name="surface" required maxlength="256" />
        </label>
        <label>
          Features
          <input
            name="features"
            placeholder="Tense=Past, Person=1, Number=Sing"
            maxlength="1024"
          />
        </label>
        <label>
          Romanization
          <input name="romanization" maxlength="256" />
        </label>
        <button type="submit">Add form</button>
      </form>
    </details>

    {#if msgFor('form')}
      <p class={form?.ok ? 'ok' : 'err'}>{msgFor('form')}</p>
    {/if}
  </section>

</div>

<style>
  /* ════════ Page wrapper — adopts the design's paper palette ════════ */
  .page.mod {
    /* Left-align with the rail / left nav, no centering. The page
       still caps its width so the paradigm grid doesn't blow out on
       ultra-wide screens. */
    max-width: 1100px;
    margin: 0;
    padding: 14px 22px 22px;
    color: var(--ink, var(--color-fg));
    background: var(--paper, var(--color-bg));
    font-family: var(--font-serif, ui-serif, Georgia, serif);
  }
  .ok { color: #197a2f; }
  .err { color: #b03131; }
  .muted { color: var(--ink, var(--color-fg, #111)); }
  .small { font-size: 0.78rem; }

  /* ════════ Header strip — 3 col + meta line ════════ */
  .mod-head {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    column-gap: 16px;
    row-gap: 4px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--rule, var(--color-border));
  }
  .mod-crumb {
    grid-column: 1;
    font-size: 13px;
    color: var(--ink, var(--color-fg, #111));
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .mod-crumb a {
    color: inherit;
    text-decoration: none;
  }
  .mod-crumb a:hover {
    color: var(--ink, var(--color-fg));
  }
  .mod-crumb-sep { color: var(--ink, var(--color-fg, #111)); }
  .mod-crumb-cur {
    color: var(--ink, var(--color-fg));
    font-weight: 500;
  }
  .mod-id {
    grid-column: 2;
    display: inline-flex;
    align-items: baseline;
    gap: 12px;
    justify-self: center;
  }
  .mod-hw-script {
    font-size: 28px;
    font-family: var(--font-script, var(--font-serif, ui-serif, serif));
    color: var(--ink, var(--color-fg));
    line-height: 1.05;
  }
  .mod-id-pos {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 11.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent-ink, var(--color-accent));
    background: var(--accent-soft, color-mix(in srgb, var(--color-accent) 14%, transparent));
    padding: 3px 8px;
    border-radius: 999px;
    line-height: 1;
  }
  .mod-head-actions {
    grid-column: 3;
    justify-self: end;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .mod-flash {
    font-size: 12.5px;
    padding: 2px 8px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--ink, var(--color-fg)) 4%, transparent);
  }
  .mod-flash.ok {
    background: color-mix(in srgb, #197a2f 14%, transparent);
    color: #197a2f;
  }
  .mod-flash.err {
    background: color-mix(in srgb, #b03131 14%, transparent);
    color: #b03131;
  }
  .mod-id-meta {
    grid-column: 1 / -1;
    font-size: 12.5px;
    color: var(--ink, var(--color-fg, #111));
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
    margin-top: 2px;
  }
  .mod-locked {
    color: var(--accent-ink, var(--color-accent));
    font-weight: 500;
  }

  /* ════════ Operations dropdown (in header actions) ════════ */
  .mod-ops-wrap { position: relative; }
  .mod-btn-ghost {
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg, #111));
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 6px;
    padding: 5px 12px;
    font-size: 13px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: inherit;
  }
  .mod-btn-ghost:hover {
    border-color: var(--ink, var(--color-fg, #111));
    color: var(--ink, var(--color-fg));
  }
  .mod-btn-ghost kbd {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 11.5px;
    background: var(--rule, var(--color-border));
    border-radius: 3px;
    padding: 0 4px;
    color: var(--ink, var(--color-fg, #111));
    margin-left: 2px;
  }
  .mod-ops-caret { opacity: 0.6; font-size: 11.5px; }
  .mod-ops-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    min-width: 18rem;
    background: var(--card, var(--color-bg));
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 7px;
    padding: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    z-index: 50;
    display: flex;
    flex-direction: column;
  }
  .mod-ops-menu form { margin: 0; }
  .mod-ops-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    width: 100%;
    text-align: left;
    padding: 6px 8px;
    background: transparent;
    border: 0;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    color: var(--ink, var(--color-fg));
  }
  .mod-ops-item:hover {
    background: color-mix(in srgb, var(--ink, var(--color-fg)) 5%, transparent);
  }
  .mod-ops-item span:first-child {
    font-weight: 500;
    font-size: 13.5px;
  }
  .mod-ops-item em {
    font-size: 12.5px;
    color: var(--ink, var(--color-fg, #111));
    font-style: normal;
  }
  .mod-ops-item.danger span:first-child { color: #b03131; }
  .mod-ops-item.danger:hover { background: color-mix(in srgb, #b03131 12%, transparent); }
  .mod-ops-div {
    height: 1px;
    background: var(--rule, var(--color-border));
    margin: 4px 6px;
  }
  .mod-ops-panel {
    margin: 8px 0 12px;
    padding: 12px 14px;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    background: var(--card, var(--color-bg));
  }
  .mod-ops-panel h2 { margin: 0 0 4px; font-size: 15px; }
  .mod-ops-panel .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .mod-ops-panel .grow { flex: 1 1 16rem; }
  .mod-ops-panel input,
  .mod-ops-panel textarea {
    background: var(--paper, var(--color-bg));
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 6px;
    padding: 5px 8px;
    font: inherit;
    font-size: 14.5px;
    color: var(--ink, var(--color-fg));
  }

  /* ════════ Inline lemma row — editable strip ════════ */
  .mod-lemma-inline {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--rule, var(--color-border));
    flex-wrap: wrap;
    font-size: 15px;
  }
  .mli-divider {
    width: 1px;
    height: 18px;
    background: var(--rule, var(--color-border));
  }
  /* `!important` is needed because `LemmaInlineField`'s scoped
     `.lif-show { font: inherit }` has higher specificity (Svelte
     scoping adds an extra class selector) than a single-class
     `:global(.mli-headword)` rule. The class IS the styling intent —
     overriding font-size from outside the component is the
     contract the prop-passed `class` is for. */
  :global(.mli-headword) {
    font-family: var(--font-script, var(--font-serif, ui-serif, serif)) !important;
    font-size: 36px !important;
    line-height: 1.05 !important;
    color: var(--ink, var(--color-fg));
  }
  :global(.mli-gloss) {
    flex: 1;
    min-width: 14rem;
    font-size: 15px !important;
    color: var(--ink, var(--color-fg, #111));
  }
  :global(.mli-freq) {
    min-width: 3rem;
    font-size: 14px !important;
  }
  .mli-fld {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    font-size: 12.5px;
    color: var(--ink, var(--color-fg, #111));
  }
  .mli-fld-l {
    font-family: var(--font-mono, ui-monospace, monospace);
    text-transform: lowercase;
  }
  .mli-translations {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
    color: var(--ink, var(--color-fg, #111));
    border: 1px solid var(--card-edge, var(--color-border));
    background: var(--card, var(--color-bg));
    border-radius: 6px;
    padding: 4px 9px;
    cursor: pointer;
    font-family: inherit;
  }
  .mli-tr-count {
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--ink, var(--color-fg, #111));
  }
  .mli-tr-add { color: var(--accent-ink, var(--color-accent)); font-size: 14.5px; line-height: 1; }

  /* ════════ Forms section ════════ */
  .forms-sec { margin-top: 14px; }
  .forms-h {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 8px;
    font-family: var(--font-serif, ui-serif, serif);
    font-weight: 500;
    font-size: 18px;
  }
  .forms-h-count {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 12.5px;
    color: var(--ink, var(--color-fg, #111));
    background: var(--rule-2, var(--color-surface-2));
    padding: 1px 8px;
    border-radius: 999px;
    font-weight: 400;
  }
  .mod-spread { flex: 1; }
  .forms-h-regen { margin: 0; }

  /* Paradigm bar */
  .paradigm-bar {
    display: flex;
    align-items: end;
    gap: 12px;
    padding: 4px 0 14px;
    flex-wrap: wrap;
  }
  .pb-fld {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    max-width: 240px;
  }
  .pb-fld span {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--ink, var(--color-fg, #111));
    text-transform: uppercase;
  }
  .pb-stem { max-width: 140px; }
  .mod-in {
    background: var(--card, var(--color-bg));
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 14.5px;
    color: var(--ink, var(--color-fg));
    font-family: inherit;
  }
  .mod-in-script {
    font-family: var(--font-script, var(--font-serif, ui-serif, serif));
  }

  /* Paradigm groups + grid */
  .paradigm {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .pgroup {
    background: var(--card, var(--color-bg));
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    padding: 10px 12px 12px;
  }
  .pgroup-h {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 0 0 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--rule-2, var(--color-surface-2));
  }
  .pgroup-h > span:first-child {
    font-family: var(--font-serif, ui-serif, serif);
    font-weight: 500;
    font-size: 16px;
    color: var(--ink, var(--color-fg));
  }
  .pgroup-quar {
    border-color: color-mix(in srgb, #b03131 25%, var(--rule, var(--color-border)));
  }
  .pgrid {
    display: grid;
    grid-template-columns: 64px 1fr 1fr;
    gap: 6px 8px;
    align-items: start;
  }
  .pcol-h {
    font-family: var(--font-sans, system-ui, sans-serif);
    font-size: 13px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink, var(--color-fg, #111));
    padding: 0 0 4px 8px;
  }
  .prow-l {
    font-family: var(--font-sans, system-ui, sans-serif);
    font-size: 14px;
    color: var(--ink, var(--color-fg, #111));
    padding-top: 10px;
  }
  .pgrid-cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  /* Flat list for sections without person×number axis */
  .pflat {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .pflat-row {
    display: grid;
    grid-template-columns: 64px 1fr;
    gap: 8px;
    align-items: start;
  }

  /* ════════ Cell ════════ */
  .pcell {
    position: relative;
    border-radius: 6px;
    background: var(--paper, var(--color-bg));
    border: 1px solid var(--rule, var(--color-border));
    display: block;
  }
  .pcell.empty {
    text-align: center;
    color: var(--ink, var(--color-fg, #111));
    font-family: var(--font-mono, ui-monospace, monospace);
    padding: 10px;
    font-size: 13px;
    background: transparent;
    border-style: dashed;
  }
  .pcell.quar { opacity: 0.6; }
  .pcell.quar .pcell-script {
    text-decoration: line-through;
    text-decoration-color: #b03131;
  }
  /* `<details><summary>` strips its default marker so the cell head
     reads as a clean row. */
  .pcell-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 6px 8px 4px 24px;
    background: transparent;
    cursor: pointer;
    position: relative;
    border-radius: 6px;
    list-style: none;
  }
  .pcell-head::-webkit-details-marker { display: none; }
  .pcell-head::marker { content: ''; }
  .pcell-head:hover {
    background: color-mix(in srgb, var(--ink, var(--color-fg)) 3%, transparent);
  }
  .pcell-script {
    font-family: var(--font-script, var(--font-serif, ui-serif, serif));
    font-size: 22px;
    line-height: 1.1;
    color: var(--ink, var(--color-fg));
  }
  .pcell-roman {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 14px;
    color: var(--ink, var(--color-fg, #111));
  }
  .pcell-prov {
    position: absolute;
    left: 8px;
    top: 50%;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    transform: translateY(-50%);
    background: var(--ink-2, var(--color-fg));
  }
  .pcell-prov[data-created-by='curator'] {
    background: var(--accent, var(--color-accent));
  }
  .pcell-prov[data-created-by='generator'] {
    background: color-mix(in srgb, var(--ink-2, var(--color-fg)) 60%, transparent);
  }
  .pcell-prov[data-created-by='import'] {
    background: oklch(0.65 0.10 280);
  }
  .pcell-prov[data-created-by='pipeline'] {
    background: oklch(0.65 0.08 200);
  }
  .pcell-quar {
    font-size: 11.5px;
    color: #b03131;
    margin-left: auto;
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .pcell-slot {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 12px;
    color: var(--ink, var(--color-fg, #111));
    padding: 0 8px 6px 24px;
    text-transform: lowercase;
    display: block;
  }
  .pcell[open] .pcell-slot { display: none; }

  /* Inline edit form inside the cell */
  .form-edit {
    border-top: 1px dashed var(--rule, var(--color-border));
    padding: 8px 12px 8px;
    display: grid;
    gap: 6px;
    grid-template-columns: 1fr 1fr;
  }
  .form-edit label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12.5px;
    color: var(--ink, var(--color-fg, #111));
  }
  .form-edit label:nth-child(1) { grid-column: 1 / 2; }
  .form-edit label:nth-child(2) { grid-column: 2 / 3; }
  .form-edit label:nth-child(3) { grid-column: 1 / -1; }
  .form-edit input {
    background: var(--card, var(--color-bg));
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 5px;
    padding: 4px 7px;
    font-size: 13px;
    color: var(--ink, var(--color-fg));
    font-family: inherit;
  }
  .form-edit-actions {
    grid-column: 1 / -1;
    display: flex;
    justify-content: flex-end;
  }
  .form-edit-actions button {
    background: var(--accent, var(--color-accent));
    color: var(--paper, white);
    border: 0;
    border-radius: 5px;
    padding: 4px 12px;
    font-size: 13px;
    cursor: pointer;
    font-family: inherit;
  }
  .form-remove {
    padding: 4px 12px 8px;
    display: flex;
    justify-content: flex-end;
  }
  .form-remove button {
    background: transparent;
    color: #b03131;
    border: 0;
    font-size: 12.5px;
    cursor: pointer;
    text-decoration: underline;
    font-family: inherit;
  }

  /* Add new form */
  .add-form-details {
    margin-top: 10px;
    border-top: 1px solid var(--rule, var(--color-border));
    padding-top: 8px;
  }
  .add-form-details summary {
    font-size: 13px;
    color: var(--accent-ink, var(--color-accent));
    cursor: pointer;
    list-style: none;
    padding: 4px 0;
  }
  .add-form-details summary::-webkit-details-marker { display: none; }
  .add-form-details summary::marker { content: ''; }
  .add-form-details .form-edit {
    border-top: 0;
    padding: 8px 0 0;
  }

  /* Translations section — keep the existing pattern but tone down */
  .translations {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .translations li {
    padding: 8px 0;
    border-bottom: 1px solid var(--rule, var(--color-border));
  }
  .translations li:last-child { border-bottom: 0; }
  .translations .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
    font-size: 12.5px;
  }
  .translations .arrow {
    background: transparent;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 4px;
    padding: 0 6px;
    color: var(--ink, var(--color-fg, #111));
    cursor: pointer;
    font-size: 12.5px;
  }
  .translations .arrow[disabled] { opacity: 0.35; cursor: not-allowed; }
  .translations textarea {
    background: var(--card, var(--color-bg));
    border: 1px solid var(--card-edge, var(--color-border));
    border-radius: 5px;
    padding: 5px 8px;
    font-size: 14.5px;
    color: var(--ink, var(--color-fg));
    font-family: inherit;
    width: 100%;
  }
  .translations .stack {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .translations .row-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }
  .reorder-buttons {
    display: inline-flex;
    gap: 3px;
    margin-left: auto;
  }
  .checkbox {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
  }
  .checkbox input { margin: 0; }
  .tag {
    font-size: 11.5px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--rule, var(--color-border));
    color: var(--ink, var(--color-fg, #111));
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .tag.warn {
    background: color-mix(in srgb, #b03131 18%, transparent);
    color: #b03131;
  }
  section { margin: 18px 0; }
  section h2 {
    font-family: var(--font-serif, ui-serif, serif);
    font-weight: 500;
    font-size: 18px;
    margin: 0 0 8px;
  }
  .danger {
    background: color-mix(in srgb, #b03131 12%, transparent);
    color: #b03131;
    border: 1px solid color-mix(in srgb, #b03131 30%, transparent);
    border-radius: 5px;
    padding: 4px 10px;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
  }
  .danger:hover {
    background: color-mix(in srgb, #b03131 18%, transparent);
  }
</style>
