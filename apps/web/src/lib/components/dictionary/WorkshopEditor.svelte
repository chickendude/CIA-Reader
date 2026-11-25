<script lang="ts">
  import MeaningInput from '$lib/components/input/MeaningInput.svelte';
  import { numberedMeanings } from '$lib/dictionary/meanings';
  import { untrack } from 'svelte';
  import { workshop as send } from '$lib/dictionary/workshop-client';
  import {
    type Draft,
    type WorkshopWord as Word,
    type Match,
    type ReviewItem,
    formatAlternativeHeadwords,
    parseAlternativeHeadwords,
  } from '$lib/dictionary/workshop';
  import { dictionaryProfile } from '$lib/dictionary/profiles';
  import { getLanguage, type LanguageCode } from '@ciareader/shared-types';
  let {
    language,
    word,
    draft = $bindable(),
    working = $bindable(),
    observed,
    context,
    review,
    sheet = false,
    onsaved,
    onopen,
    ondeleted,
  }: {
    language: LanguageCode;
    word: Word;
    draft: Draft;
    working: boolean;
    observed: string;
    context?: ReviewItem['samples'][number]['context'];
    review: boolean;
    sheet?: boolean;
    onsaved: (w: Word, advance?: boolean) => void;
    onopen: (id: string | null, lemma: string, pos: string, attach?: string) => void;
    ondeleted?: () => void;
  } = $props();
  const meaningId = $props.id();
  const profile = $derived(dictionaryProfile(language));
  const languageName = $derived(getLanguage(language).displayName);
  const partsOfSpeech = $derived(Object.hasOwn(profile.partsOfSpeech, draft.pos)
    ? profile.partsOfSpeech : { ...profile.partsOfSpeech, [draft.pos]: draft.pos });
  function workshop<T>(action: string, fields: Record<string, unknown>, signal?: AbortSignal) {
    return send<T>(action, fields, signal, language);
  }
  let message = $state(''),
    previewError = $state(''),
    preview = $state<Record<string, string[]>>({});
  let panel = $state(''),
    search = $state(''),
    matches = $state<Match[]>([]),
    group = $state<string[]>(untrack(() => [...word.group]));
  let savedPatterns = $state<{ id: string; label: string }[]>([]);
  let savedPattern = $state('');
  let stem = $state('');
  let alternativeHeadwordsText = $state<string | null>(null);
  let otherFormsText = $state<string | null>(null);
  let addPOS = $state('VERB');
  const patterns = $derived(profile.patterns(draft.lemma, draft.pos, word.draft.paradigm));
  const selectedForms = $derived(Object.keys(preview));
  const split = (s: string, delim: RegExp) => [
    ...new Set(
      s
        .split(delim)
        .map((w) => w.trim().normalize('NFC'))
        .filter(Boolean),
    ),
  ];
  function identity() {
    draft.lemma = draft.lemma.normalize('NFC');
    if (!profile.patterns(draft.lemma, draft.pos, '').some((p) => p.id === draft.paradigm))
      draft.paradigm = 'invariant';
    preserveReviewedForms();
  }
  function preserveReviewedForms() {
    const inventory = draft.inventory;
    if (!inventory || (inventory.lemma === draft.lemma && inventory.pos === draft.pos && inventory.paradigm === draft.paradigm)) return;
    // A reviewed slot belongs to its original pattern. Carry its accepted spellings into the new entry.
    const reviewed = inventory.slots.filter((slot) => slot.include).flatMap((slot) => slot.forms);
    draft.other = [...new Set([...draft.other, ...reviewed])];
    draft.inventory = null;
  }
  function editOtherForms(text: string) {
    otherFormsText = text;
    draft.other = split(text, /[,\n]/u);
  }
  $effect(() => {
    const d: Draft = JSON.parse(JSON.stringify(draft));
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      if (!d.lemma.trim()) {
        preview = {};
        previewError = '';
        return;
      }
      try {
        const r = await workshop<{ forms: Record<string, string[]> }>(
          'preview',
          { draft: d, inventory: false },
          ctrl.signal,
        );
        if (ctrl.signal.aborted) return;
        preview = r.forms;
        previewError = '';
      } catch (e) {
        if (!ctrl.signal.aborted) previewError = (e as Error).message;
      }
    }, 220);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  });
  $effect(() => {
    const q = search,
      p = panel,
      ctrl = new AbortController();
    const timer = setTimeout(async () => {
      if (!q || !['merge', 'attach'].includes(p)) {
        matches = [];
        return;
      }
      try {
        matches = await workshop<Match[]>('search', { query: q, limit: 18 }, ctrl.signal);
      } catch (e) {
        if (!ctrl.signal.aborted) message = (e as Error).message;
      }
    }, 120);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  });
  $effect(() => {
    const pos = draft.pos;
    savedPatterns = [];
    savedPattern = '';
    const ctrl = new AbortController();
    workshop<{ id: string; label: string }[]>('patterns', { pos }, ctrl.signal)
      .then((rows) => { if (!ctrl.signal.aborted) savedPatterns = rows; })
      .catch((e) => { if (!ctrl.signal.aborted) message = (e as Error).message; });
    return () => ctrl.abort();
  });
  async function act(fn: () => Promise<void>) {
    if (working) return;
    working = true;
    message = '';
    try {
      await fn();
    } catch (e) {
      message = (e as Error).message;
    } finally {
      working = false;
    }
  }
  function save(advance = false) {
    return act(async () => {
      const w = await workshop<Word>('save', { draft });
      onsaved(w, advance);
    });
  }
  function saveMeaning() {
    if (draft.lemma.trim()) void save();
  }

  function keyboard(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      void save();
    }
  }
  function changePanel(name: string) {
    panel = panel === name ? '' : name;
    matches = [];
    if (name === 'attach' || name === 'merge') search = draft.lemma;
  }
  function applySavedPattern() {
    return act(async () => {
      const forms = await workshop<string[]>('patternForms', { id: savedPattern, stem, pos: draft.pos });
      draft.other = [...new Set([...draft.other, ...forms])];
    });
  }
  function choose(i: Match) {
    if (panel === 'attach') {
      onopen(i.id, '', i.pos, observed);
      return;
    }
    if (
      !confirm(
        'Merge the saved entry ' +
          word.draft.lemma +
          ' (' +
          word.draft.pos +
          ') into ' +
          i.lemma +
          ' (' +
          i.pos +
          ')?',
      )
    )
      return;
    void act(async () =>
      onsaved(
        await workshop<Word>('merge', { id: draft.id, target: i.id, version: draft.version }),
      ),
    );
  }
  function order(i: number, step: number) {
    const a = [...group];
    [a[i], a[i + step]] = [a[i + step]!, a[i]!];
    group = a;
  }
  const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(word.draft));
  const questionWord = $derived(context?.match ?? draft.lemma.trim());
  const sentence = $derived(context ? (context.before + context.match + context.after).trim() : '');
  const question = $derived(
    `Explain the ${languageName} word 【${questionWord}】 in English. Give its dictionary form, part of speech, full range of meanings, gender where relevant, and inflections.${profile.sources.length ? ' Check ' + profile.sources.map((s) => s.name).join(' or ') + ' and explain any spelling variants or disagreements between sources.' : ''}` +
      (sentence ? `\nContext: ${sentence}` : ''),
  );
</script>

<svelte:window onkeydown={keyboard} />
<fieldset class="editor" disabled={working}>
  <div class="heading">
    <h2 lang={language} dir="auto">{draft.lemma || 'Edit a word'}</h2>
    {#if questionWord}<a
        href={'https://chatgpt.com/?q=' + encodeURIComponent(question)}
        target="_blank"
        rel="noreferrer">Ask ChatGPT ↗</a
      >{/if}
  </div>
  {#if word.group.length > 1}<nav aria-label="Grouped uses">
      {#each word.group as id}<button
          class:current={id === draft.id}
          onclick={() => onopen(id, '', '')}>{word.uses.find((u) => u.id === id)?.pos}</button
        >{/each}
    </nav>{/if}
  <div class="identity">
    <label
      >Dictionary form<input
        lang={language} dir="auto"
        value={draft.lemma}
        oninput={(e) => {
          draft.lemma = e.currentTarget.value;
          identity();
          search = draft.lemma;
          panel = 'attach';
        }}
        placeholder="Search or enter a word"
      /></label
    >
    <label
      >Alternative headwords<input
        lang={language} dir="auto"
        value={alternativeHeadwordsText ?? formatAlternativeHeadwords(draft.alternatives, draft.hiddenAlternatives).join(', ')}
        oninput={(e) => {
          alternativeHeadwordsText = e.currentTarget.value;
          Object.assign(draft, parseAlternativeHeadwords(split(alternativeHeadwordsText, /[,;\n]/)));
        }}
        onblur={() => (alternativeHeadwordsText = null)}
        title="Prefix a spelling with a period to hide it from the headword list."
        placeholder="Separate with commas. Prefix hidden spellings with a period."
      /></label
    >
    <label
      >Part of speech<select
        value={draft.pos}
        onchange={(e) => {
          draft.pos = e.currentTarget.value;
          identity();
        }}
        >{#each Object.entries(partsOfSpeech) as [p, label]}<option value={p}>{p} ({label})</option
          >{/each}</select
      ></label
    >
  </div>
  <nav>
    <label class="check"><input type="checkbox" bind:checked={draft.loan} /> English loan</label>
    <button onclick={() => changePanel('attach')}
      >{observed ? 'Attach to existing entry' : 'Find existing entry'}</button
    >
    {#if draft.id && ondeleted}<button onclick={() => changePanel('uses')}>POS uses</button>{/if}
  </nav>
  {#if panel === 'attach' || panel === 'merge'}
    <div class="sub">
      <label
        >{panel === 'attach' ? 'Find dictionary entry' : 'Merge saved entry into'}<input
          type="search"
          bind:value={search}
          placeholder={languageName + ' or English'}
        /></label
      >
      {#each matches.filter((m) => m.id !== draft.id) as m}<button
          class="result"
          onclick={() => choose(m)}>{m.lemma} <small>{m.pos}</small> {numberedMeanings(m.meaning)}</button
        >{/each}
    </div>
  {/if}
  {#if panel === 'uses'}<div class="sub">
      <h3>POS uses</h3>
      {#each group as id, i}<div class="row">
          {word.uses.find((u) => u.id === id)?.pos}
          {i === 0 ? '(primary)' : ''}
          <button disabled={i === 0} onclick={() => order(i, -1)}>Move up</button><button
            disabled={i === group.length - 1}
            onclick={() => order(i, 1)}>Move down</button
          >
          <button onclick={() => (group = group.filter((m) => m !== id))}>Remove</button>
        </div>{/each}
      {#each word.uses.filter((u) => !group.includes(u.id)) as u}<button
          onclick={() => (group = [...group, u.id])}>Include {u.pos}</button
        >{/each}
      <button
        disabled={dirty}
        onclick={() =>
          act(async () =>
            onsaved(
              await workshop<Word>('group', {
                id: draft.id,
                members: group.length < 2 ? [] : group,
              }),
            ),
          )}>Save grouping</button
      >
      <div class="row">
        <select aria-label="New use" bind:value={addPOS}
          >{#each Object.keys(partsOfSpeech) as p}<option value={p}>{p}</option>{/each}</select
        >
        <button
          onclick={() =>
            onopen(word.uses.find((u) => u.pos === addPOS)?.id ?? null, draft.lemma, addPOS)}
          >Open or add POS use</button
        >
      </div>
    </div>{/if}
  <div class="meaning">
    <label for={meaningId}>English meaning</label>
    <MeaningInput id={meaningId} bind:value={draft.meaning} label="English meaning" {sheet} newlineOnEnter
      oncancel={sheet ? () => { draft.meaning = word.draft.meaning; } : undefined}
      onsave={saveMeaning} />
  </div>
  <fieldset id="inflection">
    <legend>Inflection pattern</legend>
    <nav>
      {#each patterns as p}<label class="check"
          ><input type="radio" checked={draft.paradigm === p.id} name="inflection-pattern" value={p.id}
          onchange={() => { draft.paradigm = p.id; preserveReviewedForms(); }} />{p.label}</label
        >{/each}
    </nav>
    {#if savedPatterns.length}
      <label>Saved pattern<select bind:value={savedPattern} onchange={() => (stem = draft.lemma)}>
        <option value="">Choose a pattern</option>
        {#each savedPatterns as p}<option value={p.id}>{p.label}</option>{/each}
      </select></label>
      {#if savedPattern}<div class="row">
        <label>Stem<input lang={language} dir="auto" bind:value={stem} /></label>
        <button disabled={!stem.trim()} onclick={applySavedPattern}>Apply pattern</button>
      </div>{/if}
    {/if}
  </fieldset>
  <div class="chips" lang={language} dir="auto">
    {#each selectedForms as f}<button
        disabled={f === draft.lemma || draft.alternatives.includes(f)}
        title={'Exclude ' + f}
        onclick={() => (draft.excluded = [...new Set([...draft.excluded, f])])}>{f}</button
      >{/each}
    {#each draft.excluded as f}<button
        title={'Restore ' + f}
        onclick={() => (draft.excluded = draft.excluded.filter((x) => x !== f))}
        ><s>{f}</s> ↶</button
      >{/each}
  </div>
  {#if observed && !selectedForms.includes(observed)}<p>
      Observed form <strong lang={language} dir="auto">{observed}</strong>
      <button
        onclick={() => {
          draft.other = [...new Set([...draft.other, observed])];
          draft.excluded = draft.excluded.filter((s) => s !== observed);
        }}>Include form</button
      >
    </p>{/if}
  {#if previewError}<p role="alert">{previewError}</p>{/if}
  <label>Other forms<textarea
    lang={language} dir="auto" rows="2" placeholder="Separate forms with commas"
    value={otherFormsText ?? draft.other.join(', ')}
    oninput={(e) => editOtherForms(e.currentTarget.value)}
    onblur={() => (otherFormsText = null)}
  ></textarea></label>
  <div class="save">
    <button class="primary" disabled={!draft.lemma.trim()} onclick={() => save()}>Save</button>
    {#if review}<button disabled={!draft.lemma.trim()} onclick={() => save(true)}
        >Save and next</button
      >{/if}
    {#if draft.id && ondeleted}<button
        disabled={dirty}
        title={dirty ? 'Save edits before merging' : ''}
        onclick={() => changePanel('merge')}>Merge into…</button>
      <button
        onclick={() => {
          if (
            confirm(
              'Delete ' + word.draft.lemma + ' (' + word.draft.pos + ') and its dictionary entry?',
            )
          )
            void act(async () => {
              await workshop('delete', { id: draft.id, version: draft.version });
              ondeleted?.();
            });
        }}>Delete entry</button
      >{/if}
    {#if working}<span role="status">Working…</span>{:else if message}<span role="status"
        >{message}</span
      >{/if}
  </div>
</fieldset>

<style>
  fieldset.editor {
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
  }
  .heading,
  nav,
  .row,
  .chips,
  .save {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.55rem;
  }
  .heading {
    justify-content: space-between;
  }
  .heading h2 {
    margin: 0.5rem 0;
  }
  .heading a {
    color: var(--accent);
  }
  .identity {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.75rem;
    margin: 1.1rem 0 0.6rem;
  }
  label,
  legend {
    font-weight: 600;
    font-size: 0.88rem;
  }
  label:not(.check) {
    display: grid;
    gap: 0.3rem;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  input,
  textarea,
  select,
  button {
    color: inherit;
    font: inherit;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 0.4rem;
    padding: 0.45rem 0.6rem;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    cursor: default;
    opacity: 0.6;
  }
  textarea {
    width: 100%;
    resize: vertical;
  }
  input[type='radio'],
  input[type='checkbox'] {
    accent-color: var(--accent);
  }
  .meaning {
    display: grid;
    gap: 0.3rem;
    margin: 1rem 0;
  }
  .editor fieldset {
    border: 0;
    padding: 0;
    margin: 0.7rem 0;
  }
  .chips {
    margin: 0.8rem 0;
  }
  .chips button {
    padding: 0.15rem 0.45rem;
  }
  .result {
    display: block;
    width: 100%;
    text-align: left;
    margin: 0.2rem 0;
  }
  .save {
    position: sticky;
    bottom: 0;
    padding: 0.75rem 0.25rem;
    background: var(--paper);
    border-top: 1px solid var(--rule);
    z-index: 2;
  }
  .primary,
  button.current {
    background: var(--accent);
    color: var(--paper);
  }
  nav {
    margin: 0.5rem 0;
  }
  .sub {
    padding: 0.75rem;
    border: 1px solid var(--rule);
    border-radius: 0.5rem;
    margin: 0.5rem 0;
  }
  @media (max-width: 720px) {
    .identity {
      grid-template-columns: 1fr 1fr;
    }
    .identity label:first-child {
      grid-column: 1/-1;
    }
    .save {
      padding-bottom: max(0.7rem, env(safe-area-inset-bottom));
    }
  }
</style>
