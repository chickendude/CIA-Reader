<script lang="ts">
  import { untrack } from 'svelte';
  import { workshop } from '$lib/dictionary/workshop-client';
  import {
    emptyDraft,
    partsOfSpeech,
    type Draft,
    type WorkshopWord as Word,
    type Inventory,
    type Match,
    type Reference,
    type Excerpt,
    type ReviewItem,
  } from '$lib/dictionary/hindi-workshop';
  import { hindiPatterns } from '$lib/dictionary/hindi-patterns';
  let {
    word,
    draft = $bindable(),
    working = $bindable(),
    ai,
    observed,
    context,
    review,
    onsaved,
    onopen,
    ondeleted,
  }: {
    word: Word;
    draft: Draft;
    working: boolean;
    ai: boolean;
    observed: string;
    context?: ReviewItem['samples'][number]['context'];
    review: boolean;
    onsaved: (w: Word, advance?: boolean) => void;
    onopen: (id: string | null, lemma: string, pos: string, attach?: string) => void;
    ondeleted?: () => void;
  } = $props();
  let message = $state(''),
    previewError = $state(''),
    preview = $state<Record<string, string[]>>({}),
    template = $state<Inventory | null>(null);
  let panel = $state(''),
    search = $state(''),
    matches = $state<Match[]>([]),
    group = $state<string[]>(untrack(() => [...word.group]));
  let spelling = $state(''),
    pattern = $state('invariant'),
    verb = $state(''),
    negative = $state(false),
    alternative = $state(false);
  let provider = $state<'hindwi' | 'rekhta'>('hindwi'),
    lookup = $state(untrack(() => draft.lemma)),
    sourceUrl = $state(''),
    excerpt = $state(''),
    english = $state('');
  type WikiWord = {
    lemma: string;
    pos: string;
    definitions: {
      original: string;
      language: string;
      source_url?: string;
      translation?: string;
    }[];
  };
  let wiki = $state<WikiWord[]>([]);
  async function findWiki() {
    await act(async () => {
      wiki = await workshop<WikiWord[]>('wiktionary', { query: lookup });
      if (!wiki.length) message = 'No matches in the imported Wiktionary data';
    });
  }
  let results = $state<Reference[]>([]),
    page = $state(''),
    retrieved = $state(''),
    addPOS = $state('VERB');
  const patterns = $derived(hindiPatterns(draft.lemma, draft.pos, word.draft.paradigm));
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
    if (!hindiPatterns(draft.lemma, draft.pos, '').some((p) => p.id === draft.paradigm))
      draft.paradigm = 'invariant';
    lookup = draft.lemma;
  }
  $effect(() => {
    const d: Draft = JSON.parse(JSON.stringify(draft));
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      if (!d.lemma.trim()) {
        preview = {};
        template = null;
        previewError = '';
        return;
      }
      try {
        const r = await workshop<{ forms: Record<string, string[]>; inventory?: Inventory }>(
          'preview',
          { draft: d, inventory: true },
          ctrl.signal,
        );
        if (ctrl.signal.aborted) return;
        preview = r.forms;
        template = r.inventory ?? null;
        if (!r.inventory) {
          previewError = 'Inflection slot suggestions are unavailable.';
          return;
        }
        previewError = '';
        const inv = d.inventory;
        if (!inv || inv.lemma !== d.lemma || inv.pos !== d.pos || inv.paradigm !== d.paradigm) {
          const slots = r.inventory.slots.map((s) => {
            const prior =
              inv?.lemma === d.lemma && inv.pos === d.pos
                ? inv.slots.find((p) => p.id === s.id)
                : null;
            return prior ?? { ...s, forms: [], include: false, applicability: 'unknown' as const };
          });
          draft.inventory = { ...r.inventory, slots };
        }
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
    if (name === 'forms') {
      spelling = draft.lemma;
      pattern = draft.paradigm;
      verb =
        spelling
          .split(/\s+/)
          .reverse()
          .find((w) => w.endsWith('ना')) ?? '';
    }
  }
  function fillSlots() {
    if (!template || !draft.inventory) return;
    let count = 0;
    for (const slot of draft.inventory.slots) {
      const attested = template.slots.find((r) => r.id === slot.id);
      if (!attested?.forms.length || slot.forms.length || slot.applicability === 'not_applicable')
        continue;
      slot.forms = [...new Set([...slot.forms, ...attested.forms])];
      slot.applicability = 'applicable';
      slot.include = true;
      count++;
    }
    message = count
      ? 'Filled ' + count + ' slots from imported evidence.'
      : 'No tagged Wiktionary forms available for this entry.';
  }
  function addForms() {
    return act(async () => {
      const r =
        pattern === 'phrase'
          ? await workshop<{ forms: Record<string, string[]> }>('phrase', {
              phrase: spelling,
              verb,
              negative,
            })
          : await workshop<{ forms: Record<string, string[]> }>('preview', {
              draft: { ...emptyDraft(spelling, draft.pos), paradigm: pattern },
              inventory: false,
            });
      draft.other = [...new Set([...draft.other, ...Object.keys(r.forms)])];
      if (alternative && spelling !== draft.lemma)
        draft.alternatives = [...new Set([...draft.alternatives, spelling.trim()])];
      panel = '';
      message = 'Forms added to draft';
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
  function findRefs(refresh: boolean) {
    return act(async () => {
      const res = await workshop<{ result: Reference[] }>('reference', {
        provider,
        query: lookup,
        refresh,
      });
      results = res.result;
      if (!results.length) message = 'No dictionary matches';
    });
  }
  function loadPage(refresh: boolean) {
    return act(async () => {
      const res = await workshop<{ result: { text: string }; retrievedAt: string }>('reference', {
        url: sourceUrl,
        refresh,
      });
      page = res.result.text;
      retrieved = new Date(res.retrievedAt).toLocaleString();
    });
  }
  function useWiki(w: WikiWord) {
    if (draft.id && (draft.lemma !== w.lemma || draft.pos !== w.pos)) {
      message = 'Choose the matching headword and POS use before applying this source.';
      return;
    }
    draft.lemma = w.lemma;
    draft.pos = w.pos;
    identity();
    for (const d of w.definitions ?? [])
      addExcerpt({
        url: d.source_url ?? '',
        original: d.original,
        english: d.translation ?? (d.language === 'en' ? d.original : ''),
      });
  }
  function addExcerpt(e: Excerpt) {
    if (
      !draft.excerpts.some(
        (x) => x.original === e.original && x.url === e.url && x.english === e.english,
      )
    )
      draft.excerpts = [...draft.excerpts, e];
    if (
      e.english &&
      !draft.meaning
        .split(';')
        .map((x) => x.trim())
        .includes(e.english)
    )
      draft.meaning = [draft.meaning, e.english].filter(Boolean).join('; ');
  }
  // A generated empty slot template is presentation until the user enters forms.
  function signature(d: Draft) {
    return JSON.stringify({
      ...d,
      inventory: d.inventory?.slots.some((s) => s.include || s.forms.length) ? d.inventory : null,
    });
  }
  const dirty = $derived(signature(draft) !== signature(word.draft));
  const questionWord = $derived(context?.match ?? draft.lemma.trim());
  const sentence = $derived(context ? (context.before + context.match + context.after).trim() : '');
  const question = $derived(
    `Explain the Hindi word 【${questionWord}】 in English. Give its dictionary form, part of speech, full range of meanings, gender where relevant, and inflections. Check Hindwi or Rekhta and explain any spelling variants or disagreements between sources.` +
      (sentence ? `\nContext: ${sentence}` : ''),
  );
</script>

<svelte:window onkeydown={keyboard} />
<fieldset class="editor" disabled={working}>
  <div class="heading">
    <h2 lang="hi">{draft.lemma || 'Edit a word'}</h2>
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
        lang="hi"
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
        lang="hi"
        value={draft.alternatives.join(', ')}
        onchange={(e) => (draft.alternatives = split(e.currentTarget.value, /[,;\n]/))}
        placeholder="Comma-separated spellings"
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
          placeholder="Hindi or English"
        /></label
      >
      {#each matches.filter((m) => m.id !== draft.id) as m}<button
          class="result"
          onclick={() => choose(m)}>{m.lemma} <small>{m.pos}</small> {m.meaning}</button
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
  <label class="meaning"
    >English meaning<textarea
      rows="3"
      bind:value={draft.meaning}
      placeholder="synonym, synonym; another meaning"
    ></textarea></label
  >
  <fieldset>
    <legend>Inflection pattern</legend>
    <nav>
      {#each patterns as p}<label class="check"
          ><input type="radio" bind:group={draft.paradigm} value={p.id} />{p.label}</label
        >{/each}
    </nav>
  </fieldset>
  <div class="chips" lang="hi">
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
      Observed form <strong lang="hi">{observed}</strong>
      <button
        onclick={() => {
          draft.other = [...new Set([...draft.other, observed])];
          draft.excluded = draft.excluded.filter((s) => s !== observed);
        }}>Include form</button
      >
    </p>{/if}
  {#if previewError}<p role="alert">{previewError}</p>{/if}
  <div class="heading">
    <h3 id="inflection">Inflected forms</h3>
    <nav>
      <button onclick={() => changePanel('forms')}>Add forms</button><button
        disabled={!template}
        onclick={fillSlots}>Fill from Wiktionary</button
      >
    </nav>
  </div>
  {#if panel === 'forms'}<div class="sub">
      <label
        >Spelling or phrase<input
          lang="hi"
          bind:value={spelling}
          oninput={() => (pattern = 'invariant')}
        /></label
      >
      <label
        >Inflection pattern<select bind:value={pattern}
          >{#each hindiPatterns(spelling, draft.pos, '') as p}<option value={p.id}>{p.label}</option
            >{/each}{#if spelling.includes(' ')}<option value="phrase"
              >Inflect a verb in this phrase</option
            >{/if}</select
        ></label
      >
      {#if pattern === 'phrase'}<label>Verb to inflect<input lang="hi" bind:value={verb} /></label
        ><label class="check"
          ><input type="checkbox" bind:checked={negative} /> Include न / नहीं variants</label
        >{/if}
      <label class="check"
        ><input type="checkbox" bind:checked={alternative} /> Show as alternative headword</label
      ><button onclick={addForms}>Add forms to draft</button>
    </div>{/if}
  {#each draft.inventory?.slots ?? [] as slot (slot.id)}
    <div class="slot">
      <label class="check"
        ><input
          type="checkbox"
          disabled={!slot.forms.length}
          bind:checked={slot.include}
        />{slot.label}</label
      >
      <input
        lang="hi"
        aria-label={slot.label + ' forms'}
        placeholder="Forms separated by ;"
        value={slot.forms.join('; ')}
        onchange={(e) => {
          slot.forms = split(e.currentTarget.value, /[;\n]/);
          slot.include = !!slot.forms.length;
          slot.applicability = slot.include ? 'applicable' : 'unknown';
        }}
      />
    </div>
  {/each}
  <details>
    <summary>Other attested forms ({draft.other.length})</summary><label
      >One form per line<textarea
        rows="4"
        lang="hi"
        value={draft.other.join('\n')}
        onchange={(e) => (draft.other = split(e.currentTarget.value, /\n/))}
      ></textarea></label
    >
  </details>
  <details>
    <summary>Dictionary lookup</summary>
    <nav>
      <a
        href={'https://en.wiktionary.org/wiki/' + encodeURIComponent(lookup) + '#Hindi'}
        target="_blank"
        rel="noreferrer">Wiktionary ↗</a
      >
      {#each ['hindwi', 'rekhta'] as p}<a
          href={'https://www.google.com/search?q=' +
            encodeURIComponent('site:' + p + 'dictionary.com ' + lookup)}
          target="_blank"
          rel="noreferrer">{p === 'hindwi' ? 'Hindwi' : 'Rekhta'} ↗</a
        >{/each}
    </nav>
    <div class="row">
      <input aria-label="Look up word" bind:value={lookup} /><select
        aria-label="Source dictionary"
        bind:value={provider}
        ><option value="hindwi">Hindwi</option><option value="rekhta">Rekhta</option></select
      ><button onclick={() => findRefs(false)}>Find entries</button><button
        onclick={() => findRefs(true)}>Refresh search</button
      >
    </div>
    <button onclick={findWiki}>Look up imported Wiktionary entries</button>
    {#each wiki as w}<div class="sub">
        <strong>{w.lemma}</strong> <small>{w.pos}</small>
        <p>{w.definitions?.map((d) => d.translation || d.original).join('; ')}</p>
        <button onclick={() => useWiki(w)}>Use as draft</button>
      </div>{/each}
    {#each results as r}<button
        onclick={() => {
          sourceUrl = r.source_url;
          page = '';
          excerpt = '';
          english = '';
          void loadPage(false);
        }}>{r.label}</button
      >{/each}
    <label
      >Source page URL<input
        type="url"
        bind:value={sourceUrl}
        oninput={() => {
          page = '';
          retrieved = '';
        }}
      /></label
    >
    <nav>
      <button disabled={!sourceUrl} onclick={() => loadPage(false)}>Load page</button><button
        disabled={!sourceUrl}
        onclick={() => loadPage(true)}>Refresh page</button
      >
    </nav>
    {#if page}<details>
        <summary>Cached source page ({retrieved})</summary>
        <pre>{page}</pre>
      </details>{/if}
    <label>Source excerpt<textarea bind:value={excerpt} rows="3"></textarea></label><label
      >English draft<textarea bind:value={english} rows="2"></textarea></label
    >
    <nav>
      <button
        disabled={!excerpt || !ai}
        title={ai ? 'Translate this excerpt' : 'Configure an AI key to translate excerpts'}
        onclick={() =>
          act(async () => {
            english = (await workshop<{ english: string }>('translate', { excerpt })).english;
          })}>Draft English with AI</button
      >
      <button
        disabled={!excerpt.trim()}
        onclick={() => addExcerpt({ url: sourceUrl, original: excerpt, english })}
        >Use excerpt</button
      >
    </nav>
    {#each [...word.evidence, ...draft.excerpts] as e}<button
        class="result"
        onclick={() => {
          sourceUrl = e.url;
          excerpt = e.original;
          english = e.english;
          page = '';
        }}>{e.original}</button
      >{/each}
  </details>
  <div class="save">
    <button class="primary" disabled={!draft.lemma.trim()} onclick={() => save()}>Save</button>
    {#if review}<button disabled={!draft.lemma.trim()} onclick={() => save(true)}
        >Save and next</button
      >{/if}
    {#if draft.id && ondeleted}<button
        disabled={dirty}
        title={dirty ? 'Save edits before merging' : ''}
        onclick={() => changePanel('merge')}>Merge into…</button
      >
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
  .heading h2,
  .heading h3 {
    margin: 0.5rem 0;
  }
  .heading a,
  nav a {
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
  .slot {
    display: grid;
    grid-template-columns: minmax(8rem, 1fr) minmax(6rem, 1fr);
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--rule);
  }
  details,
  .sub {
    padding: 0.7rem 0;
  }
  summary {
    cursor: pointer;
    font-weight: 600;
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
  pre {
    white-space: pre-wrap;
    overflow: auto;
    max-height: 16rem;
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
