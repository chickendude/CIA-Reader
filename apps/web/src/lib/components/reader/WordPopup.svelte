<!--
  Word side panel (T-5.4 → T-5.10).

  Opens on tap/click of a word. Renders inside a <Sheet> so it slides
  up from the bottom on <960px and in from the right on >=960px,
  matching the CIAR design's reader side-panel.

  Content (unchanged from T-5.4):
    a. Surface form + romanization + headword + POS
    b. Personal → official → community translations (T-3.3 ordering)
    c. "+ Add my translation" form (T-3.2)
    d. Status buttons — Learning / Known / Ignored (T-5.5)
    e. "N alternate meanings" disclosure when is_ambiguous=true
       (T-6.1 wires the candidate-pick action)
    f. "No dictionary match" copy when is_oov=true (T-5.4a)

  Keyboard: Sheet handles Esc + focus trap. We keep k/l/i status
  shortcuts so the existing keyboard-first flow (T-5.7) still works.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import Sheet from '../overlay/Sheet.svelte';
  import CorrectionModal from './CorrectionModal.svelte';
  import FeaturePill from './FeaturePill.svelte';
  import PosPill from './PosPill.svelte';
  import ReportTranslationModal from './ReportTranslationModal.svelte';
  import { getFeaturePills } from './feature-labels.js';
  import { customizableOfficialIds } from './customize-eligibility.js';
  import {
    definitionLanguageName,
    HIDDEN_DEFINITION_LANGUAGES_KEY,
    parseHiddenDefinitionLanguages,
    serializeHiddenDefinitionLanguages,
    ACTIVE_REFERENCE_LANGUAGE_KEY,
    parseReferenceLanguage,
    REFERENCE_LANGUAGE_TABS,
    referenceSourceLanguage,
    type ReferenceLanguage,
  } from './definition-languages.js';
  import { browser } from '$app/environment';
  import type { LanguageCode } from '@ciareader/shared-types';
  import { looksLikeNumberToken, type ServerToken } from './types.js';

  type Provenance =
    | { kind: 'personal'; attribution: null }
    | { kind: 'curator'; attribution: string | null }
    | { kind: 'imported'; attribution: string | null }
    | { kind: 'community'; attribution: null };

  type PublicTranslation = {
    id: string;
    source: 'official_dictionary' | 'curator' | 'user';
    submittedBy: string | null;
    body: string;
    targetLanguage: string;
    sourceAttribution: string | null;
    parentTranslationId: string | null;
    provenance: Provenance;
    voteScore: number;
    viewerVote: 'up' | 'down' | null;
  };

  type LemmaPayload = {
    lemma: {
      id: string;
      headword: string;
      pos: string;
      glossDefault: string | null;
    };
    translations: {
      personal: PublicTranslation[];
      official: PublicTranslation[];
      community: PublicTranslation[];
    };
    /** Distinct definition languages present across the buckets (T-… Basque
     *  dictionary). Drives the per-language filter chips. */
    definitionLanguages?: string[];
  };

  type NumberDisplay = {
    label: string;
    nativeDigits: string;
    spelled: string;
    romanized: string;
  };

  // anchorRect is accepted but unused — anchor positioning was used
  // before T-5.10 switched to Sheet. Kept on the prop signature for
  // backward compat with callers that still pass it.
  // `token` is nullable now: the side panel renders unconditionally
  // on desktop (static layout) and shows an empty-state prompt when
  // the user hasn't picked a word yet.
  let {
    token,
    phrase = null,
    pendingSelection,
    selectionError,
    language,
    isOwner,
    isAdmin = false,
    textId = '',
    onClose,
    onStatusChange,
    onCorrectionApplied,
    onPhraseCreated,
    onPersonalTranslationChange,
  }: {
    token: ServerToken | null;
    /** T-14.3: surface the longest phrase containing the click
     *  target. When non-null, the popup renders a phrase banner
     *  (status flips + gloss + headword) above the existing token
     *  body. The component lemma stays underneath so a click on a
     *  phrase token still surfaces the lemma's translations. */
    phrase?: import('./types.js').ChapterPhraseSpan | null;
    /** T-14.3a: a multi-token selection waiting to be saved as a
     *  new phrase. When non-null, the popup renders a "Create
     *  phrase" surface listing the selected words with Save /
     *  Cancel buttons; on save it POSTs to /api/v1/phrases and
     *  notifies the parent via `onPhraseCreated`. */
    pendingSelection?: {
      language: LanguageCode;
      surfaces: string[];
      rangeIdx: { start: number; end: number };
    };
    /** T-14.3a: surface from the parent if shift-click validation
     *  failed (e.g. selection crossed a sentence boundary). */
    selectionError?: string;
    /** Drives the CorrectionModal's dictionary search + script
     *  selection. Required from T-6.2 forward. */
    language: LanguageCode;
    anchorRect?: { top: number; left: number; bottom: number; right: number };
    isOwner: boolean;
    /** T-… Basque dictionary: gates the admin-only Elhuyar/Euskaltzaindia
     *  reference panel. Threaded from the reader loader's `isAdmin`. */
    isAdmin?: boolean;
    /** Owning text id — drives the "appears N× in this book" lookup.
     *  Optional so tests can mount without it; always supplied by the reader. */
    textId?: string;
    onClose: () => void;
    onStatusChange?: (
      lemmaId: string,
      status: 'unknown' | 'learning' | 'known' | 'ignored',
    ) => void;
    /** T-6.1: parent applies the new lemma to the token's render so
     *  the reader reflects the correction without a page reload. */
    onCorrectionApplied?: (tokenId: string, chosenLemmaId: string | null) => void;
    /** T-14.3a: fired after a successful phrase-create POST so
     *  the parent can refetch chapter spans / close the popup. */
    onPhraseCreated?: (phraseId: string) => void;
    /** Fired after a personal translation is added, edited, or
     *  deleted. The parent uses it to update the chapter's hover
     *  tooltip without a full reload. `gloss` is the new primary
     *  personal translation body, or null when the viewer no longer
     *  has any. */
    onPersonalTranslationChange?: (
      lemmaId: string,
      gloss: string | null,
    ) => void;
  } = $props();

  // T-14.3: optimistic phrase status, mirroring the lemma path.
  // Re-syncs from the prop whenever the user clicks into a
  // different phrase. The PATCH happens against
  // /api/v1/me/known-phrases/:phraseId.
  let optimisticPhraseStatus = $state<
    'unknown' | 'learning' | 'known' | 'ignored'
  >(untrack(() => phrase?.status ?? 'unknown'));
  let phraseStatusError = $state<string | null>(null);
  $effect(() => {
    optimisticPhraseStatus = phrase?.status ?? 'unknown';
    phraseStatusError = null;
  });

  async function setPhraseStatus(
    next: 'unknown' | 'learning' | 'known' | 'ignored',
  ) {
    if (!phrase) return;
    const prev = optimisticPhraseStatus;
    optimisticPhraseStatus = next;
    phraseStatusError = null;
    try {
      const res = await fetch(`/api/v1/me/known-phrases/${phrase.phraseId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        optimisticPhraseStatus = prev;
        phraseStatusError = `Could not update phrase status (${res.status})`;
      }
    } catch (e) {
      optimisticPhraseStatus = prev;
      phraseStatusError = `Network error: ${(e as Error).message}`;
    }
  }

  // T-14.4: phrase translations. Mirrors the lemma translation
  // fetch below — when a phrase is active, GET the phrase detail
  // (which includes its visible translations) and render them
  // inside the phrase banner. The "Add translation" form posts to
  // POST /api/v1/phrases/:id/translations (T-14.1), the same path
  // T-3.5's customize fork uses for lemma-target rows.
  type PhraseTranslation = {
    id: string;
    body: string;
    targetLanguage: string;
    source: 'official_dictionary' | 'curator' | 'user';
    submittedBy: string | null;
    sourceAttribution: string | null;
  };
  let phraseTranslations = $state<PhraseTranslation[]>([]);
  let phraseTranslationsError = $state<string | null>(null);
  let phraseTranslationDraft = $state('');
  let phraseSubmitting = $state(false);
  let phraseSubmitError = $state<string | null>(null);

  $effect(() => {
    const p = phrase;
    if (!p) {
      phraseTranslations = [];
      phraseTranslationsError = null;
      phraseTranslationDraft = '';
      phraseSubmitError = null;
      return;
    }
    let cancelled = false;
    phraseTranslations = [];
    phraseTranslationsError = null;
    void (async () => {
      try {
        const res = await fetch(`/api/v1/phrases/${p.phraseId}`);
        if (cancelled) return;
        if (res.ok) {
          const json = (await res.json()) as {
            translations: Array<PhraseTranslation>;
          };
          phraseTranslations = json.translations ?? [];
        } else {
          phraseTranslationsError = `Could not load phrase translations (${res.status})`;
        }
      } catch (e) {
        if (!cancelled) {
          phraseTranslationsError = `Network error: ${(e as Error).message}`;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  async function submitPhraseTranslation() {
    if (!phrase) return;
    const body = phraseTranslationDraft.trim();
    if (body.length === 0) return;
    phraseSubmitting = true;
    phraseSubmitError = null;
    try {
      const res = await fetch(
        `/api/v1/phrases/${phrase.phraseId}/translations`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body }),
        },
      );
      if (res.ok) {
        const json = (await res.json()) as { translation: PhraseTranslation };
        // Optimistic prepend — server-side sort still wins on the
        // next popup open, but for the current popup session the
        // user sees their submission instantly.
        phraseTranslations = [json.translation, ...phraseTranslations];
        phraseTranslationDraft = '';
      } else {
        phraseSubmitError = `Could not add translation (${res.status})`;
      }
    } catch (e) {
      phraseSubmitError = `Network error: ${(e as Error).message}`;
    } finally {
      phraseSubmitting = false;
    }
  }

  let payload = $state<LemmaPayload | null>(null);
  let loadError = $state<string | null>(null);
  let showAlternates = $state(false);
  // T-6.2: opens the CorrectionModal layered on top of the popup.
  let showCorrectionModal = $state(false);
  let optimisticStatus = $state<'unknown' | 'learning' | 'known' | 'ignored'>(
    untrack(() => token?.status ?? 'unknown'),
  );
  let writeError = $state<string | null>(null);
  // T-6.1: tracks the in-flight candidate pick so the "This one"
  // button can disable itself while the POST resolves and so the
  // user sees a visible "saving" state.
  let pickingLemmaId = $state<string | null>(null);
  let pickError = $state<string | null>(null);

  // Desktop (>=960px) shows the panel as a static right column —
  // always rendered. Mobile slides it up only when a word is active.
  let isDesktop = $state(false);
  $effect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 960px)');
    const apply = () => (isDesktop = mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  });
  const sheetOpen = $derived(isDesktop || token !== null);

  // Book-wide occurrence count for the current lemma ("appears N× in this
  // book"), fetched lazily per word so a learner can prioritise frequent ones.
  let bookFrequency = $state<number | null>(null);

  // OpenAI sentence translation for the sentence the current token sits in.
  let sentenceTranslation = $state<string | null>(null);
  let translatedSentence = $state<string | null>(null);
  let translating = $state(false);
  let translateError = $state<string | null>(null);

  // Re-fetch translations whenever the token prop changes. `$effect`
  // runs the body each time `token` (and thus `token.id` / `lemmaId`)
  // changes — which happens when the parent rebinds the popup to a
  // different word — so navigating word-to-word loads the new entry
  // instead of leaving the old one stuck.
  $effect(() => {
    const t = token;
    // Clear the reference panel whenever the popup rebinds to a different
    // word; the auto-load effect refetches for the new word. The active
    // tab is intentionally preserved across words.
    adminRefResults = null;
    adminRefWord = null;
    adminRefAutoFor = null;
    adminRefError = null;
    adminRefLoading = false;
    adminRefSearch = '';
    adminRefSuggestions = [];
    headwordEdited = false;
    internalResults = [];
    bookFrequency = null;
    sentenceTranslation = null;
    translatedSentence = null;
    translating = false;
    translateError = null;
    if (!t) {
      payload = null;
      loadError = null;
      optimisticStatus = 'unknown';
      return;
    }
    optimisticStatus = t.status;
    if (!t.lemmaId) {
      payload = null;
      loadError = null;
      return;
    }
    let cancelled = false;
    payload = null;
    loadError = null;
    void (async () => {
      try {
        const res = await fetch(`/api/v1/lemmas/${t.lemmaId}/translations`);
        if (cancelled) return;
        if (res.ok) {
          payload = (await res.json()) as LemmaPayload;
        } else {
          loadError = `Could not load translations (${res.status})`;
        }
      } catch (e) {
        if (!cancelled) {
          loadError = `Network error: ${(e as Error).message}`;
        }
      }
    })();
    // Book-wide frequency — best-effort, non-blocking, doesn't affect the rest
    // of the popup if it fails.
    void (async () => {
      if (!textId) return;
      try {
        const res = await fetch(
          `/api/v1/texts/${textId}/lemmas/${t.lemmaId}/frequency`,
        );
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as { book: number; text: number };
        bookFrequency = data.book;
      } catch {
        /* frequency is a nice-to-have; ignore failures */
      }
    })();
    // If this sentence was already translated (globally cached), show it the
    // moment the word opens — no button click, no OpenAI call (cachedOnly).
    void (async () => {
      if (!t.chapterId || !t.isWord || isNumberToken) return;
      try {
        const res = await fetch('/api/v1/translate-sentence', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chapterId: t.chapterId,
            tokenIdx: t.idx,
            language,
            cachedOnly: true,
          }),
        });
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as {
          sentence: string;
          translation: string | null;
        };
        if (data.translation) {
          translatedSentence = data.sentence;
          sentenceTranslation = data.translation;
        }
      } catch {
        /* saved-translation preview is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  // ---- Admin-only Basque reference panel (Elhuyar / Euskaltzaindia) ---
  // Proprietary dictionaries shown to admins only, as a curation aid.
  // Lazy: nothing is fetched until the section is expanded. Reference-only
  // — the endpoint never writes to our DB.
  type BasqueRefResult = {
    source: string;
    label: string;
    headword: string;
    pos: string;
    definition: string;
    examples: string[];
    url: string;
  };
  let adminRefLoading = $state(false);
  let adminRefError = $state<string | null>(null);
  let adminRefResults = $state<BasqueRefResult[] | null>(null);
  // The word whose results are currently shown (the last lookup, manual or
  // auto). Distinct from `adminRefAutoFor` below.
  let adminRefWord = $state<string | null>(null);
  // The parsed lemma the auto-load effect last fetched for. Tracked
  // separately from `adminRefWord` so a manual search (which changes
  // `adminRefWord`) doesn't make the effect think the token changed and
  // re-load the parsed headword on top of the admin's search.
  let adminRefAutoFor = $state<string | null>(null);
  // Reference search box (replaces the static header): seeded from the lemma,
  // editable, with Elhuyar autocomplete so the admin can pick the exact entry
  // ("Afrika", not "afrikaans") even when the parsed lemma is wrong/mis-cased.
  let adminRefSearch = $state('');
  let adminRefSuggestions = $state<string[]>([]);
  let adminRefSuggestTimer: ReturnType<typeof setTimeout> | null = null;

  // Editable headword (the popup title). Typing searches the internal
  // dictionary live (results listed below; click one to load it into the
  // Translations section) and, after a longer pause, re-runs the admin
  // reference lookup — a recovery path when the NLP parsed the wrong lemma.
  type InternalHit = { id: string; headword: string; pos: string; glossDefault: string | null };
  let headwordInput = $state('');
  let headwordEdited = $state(false);
  let internalResults = $state<InternalHit[]>([]);
  let internalSearchTimer: ReturnType<typeof setTimeout> | null = null;
  let headwordExternalTimer: ReturnType<typeof setTimeout> | null = null;

  // The ES | EN | EU tabs select which upstream source's entries show.
  // Persisted so the admin's preferred reference language sticks across
  // words; `null` until they pick, then we default to the first tab that
  // has results.
  function readActiveRefTab(): ReferenceLanguage | null {
    if (!browser) return null;
    try {
      return parseReferenceLanguage(
        localStorage.getItem(ACTIVE_REFERENCE_LANGUAGE_KEY),
      );
    } catch {
      return null;
    }
  }
  let activeRefTab = $state<ReferenceLanguage | null>(readActiveRefTab());

  // We look up the resolved NLP lemma; for an OOV token (no lemma) we fall
  // back to the surface. Waiting for the lemma when there is one avoids a
  // double fetch (surface, then lemma) as the payload resolves.
  const adminRefLookupWord = $derived(
    payload?.lemma.headword ?? (token && !token.lemmaId ? token.surface : null),
  );
  const showAdminRef = $derived(
    isAdmin &&
      language === 'eu' &&
      !!token?.isWord &&
      // Skip numerals — they have their own spelled-out block, not a
      // dictionary entry. (`isNumberToken` is declared below, so inline
      // the same check here to avoid a use-before-declaration.)
      token?.numberForms == null &&
      !looksLikeNumberToken(token?.surface ?? '') &&
      !!adminRefLookupWord,
  );

  function refResultsFor(lang: ReferenceLanguage): BasqueRefResult[] {
    return (adminRefResults ?? []).filter(
      (r) => referenceSourceLanguage(r.source) === lang,
    );
  }
  const refTabsWithResults = $derived(
    REFERENCE_LANGUAGE_TABS.filter((l) => refResultsFor(l).length > 0),
  );
  // Honour the admin's pick; otherwise land on the first tab that has
  // something so the panel isn't empty on open.
  const effectiveRefTab: ReferenceLanguage = $derived(
    activeRefTab ?? refTabsWithResults[0] ?? 'es',
  );
  const shownRefResults = $derived(refResultsFor(effectiveRefTab));

  function selectRefTab(lang: ReferenceLanguage): void {
    activeRefTab = lang;
    if (browser) {
      try {
        localStorage.setItem(ACTIVE_REFERENCE_LANGUAGE_KEY, lang);
      } catch {
        /* storage disabled — in-memory state still works */
      }
    }
  }

  async function loadAdminRef(term?: string, opts: { exact?: boolean } = {}): Promise<void> {
    const word = (term ?? adminRefLookupWord ?? '').trim();
    if (!word) return;
    adminRefWord = word; // mark requested up front so the effect won't refire
    adminRefSearch = word; // keep the search box in sync
    adminRefSuggestions = []; // close the autocomplete dropdown
    adminRefLoading = true;
    adminRefError = null;
    adminRefResults = null;
    try {
      const qs = new URLSearchParams({ word });
      // An explicit admin search preserves case ("Afrika" ≠ "afrikaans"); the
      // auto-lemma lookup keeps the lowercasing default.
      if (opts.exact) qs.set('exact', '1');
      const res = await fetch(`/api/v1/admin/basque-dictionary?${qs.toString()}`);
      if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
      const data = (await res.json()) as { results: BasqueRefResult[] };
      adminRefResults = data.results;
    } catch (e) {
      adminRefError = e instanceof Error ? e.message : 'Lookup failed';
      adminRefResults = null;
    } finally {
      adminRefLoading = false;
    }
  }

  // Debounced Elhuyar autocomplete for the reference search box.
  async function fetchAdminRefSuggestions(term: string): Promise<void> {
    try {
      const res = await fetch(
        `/api/v1/admin/basque-dictionary/autocomplete?term=${encodeURIComponent(term)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { terms: string[] };
      // Drop stale responses if the box moved on.
      if (adminRefSearch.trim() === term) adminRefSuggestions = data.terms;
    } catch {
      /* autocomplete is a convenience — ignore failures */
    }
  }
  function onAdminRefInput(value: string): void {
    adminRefSearch = value;
    if (adminRefSuggestTimer) clearTimeout(adminRefSuggestTimer);
    const q = value.trim();
    if (q.length < 2) {
      adminRefSuggestions = [];
      return;
    }
    adminRefSuggestTimer = setTimeout(() => void fetchAdminRefSuggestions(q), 180);
  }

  // Auto-load on open — the panel is expanded by default (no toggle).
  // Fires once per parsed lemma (tracked in `adminRefAutoFor`); a manual
  // search updates `adminRefWord`, not `adminRefAutoFor`, so it won't be
  // clobbered here. A new token resets `adminRefAutoFor` (token effect),
  // and selecting an internal lemma changes `adminRefLookupWord`, both of
  // which legitimately re-trigger the auto-load.
  $effect(() => {
    if (!showAdminRef) return;
    const word = adminRefLookupWord;
    if (!word || adminRefAutoFor === word) return;
    adminRefAutoFor = word;
    void loadAdminRef();
  });

  // ---- Editable headword search ------------------------------------
  async function searchInternalDictionary(term: string): Promise<void> {
    try {
      const res = await fetch(
        `/api/v1/dictionary/${language}/lemmas?q=${encodeURIComponent(term)}&limit=24`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { lemmas: InternalHit[] };
      // Drop stale responses if the field moved on.
      if (headwordInput.trim() !== term) return;
      // The NLP + import create several lemma rows per word; collapse them to
      // one entry per headword (preferring one that carries a gloss) so the
      // list isn't 20 identical "egon"s.
      const byHeadword = new Map<string, InternalHit>();
      for (const l of data.lemmas) {
        const existing = byHeadword.get(l.headword);
        if (!existing || (!existing.glossDefault && l.glossDefault)) {
          byHeadword.set(l.headword, l);
        }
      }
      internalResults = [...byHeadword.values()].slice(0, 8);
      // If the typed text exactly matches a dictionary headword, load its
      // translations straight away: editing the headword should update the
      // Translations panel, not just the suggestion list. Guarded on the
      // lemma id so we don't refetch the entry that's already shown.
      const wanted = term.normalize('NFC').toLowerCase();
      const exact = [...byHeadword.values()].find(
        (r) => r.headword.normalize('NFC').toLowerCase() === wanted,
      );
      if (exact && exact.id !== payload?.lemma.id) {
        void loadLemmaTranslations(exact);
      }
    } catch {
      /* internal search is a convenience — ignore failures */
    }
  }

  function onHeadwordInput(value: string): void {
    headwordInput = value;
    headwordEdited = true;
    const q = value.trim();

    // Internal dictionary — search as you type (short debounce).
    if (internalSearchTimer) clearTimeout(internalSearchTimer);
    if (q.length < 2) {
      internalResults = [];
    } else {
      internalSearchTimer = setTimeout(() => void searchInternalDictionary(q), 160);
    }

    // External reference dictionaries — admin only, after a longer pause.
    if (showAdminRef && q) {
      if (headwordExternalTimer) clearTimeout(headwordExternalTimer);
      headwordExternalTimer = setTimeout(() => void loadAdminRef(q, { exact: true }), 600);
    }
  }

  // Load a dictionary lemma's full translations into the normal Translations
  // section. Shared by the click handler and the type-an-exact-match path.
  async function loadLemmaTranslations(hit: InternalHit): Promise<void> {
    loadError = null;
    try {
      const res = await fetch(`/api/v1/lemmas/${hit.id}/translations`);
      if (res.ok) payload = (await res.json()) as LemmaPayload;
      else loadError = `Could not load translations (${res.status})`;
    } catch (e) {
      loadError = `Network error: ${(e as Error).message}`;
    }
  }

  // Clicking an internal result (or pressing Enter on the top one) loads that
  // lemma and closes the suggestion list.
  async function selectInternalLemma(hit: InternalHit): Promise<void> {
    headwordInput = hit.headword;
    headwordEdited = true;
    internalResults = [];
    await loadLemmaTranslations(hit);
  }

  // Seed the editable headword from the resolved word, but never clobber an
  // in-progress edit. Re-seeds when the popup rebinds to another token because
  // the token-change effect clears `headwordEdited`.
  $effect(() => {
    const seed = payload?.lemma.headword ?? token?.surface ?? '';
    untrack(() => {
      if (!headwordEdited) headwordInput = seed;
    });
  });

  function handleKeydown(e: KeyboardEvent) {
    if (!isOwner || !token?.lemmaId) return;
    // T-5.21: skip the k/l/i shortcuts whenever the user is typing
    // into a form field — otherwise typing 'l' in the add-translation
    // textarea would silently flip the lemma to learning.
    const target = e.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (target.isContentEditable) return;
    }
    // T-5.7: power-user shortcuts. Only fire when modifier-free so we
    // don't fight the browser's own shortcuts (Cmd-K, Ctrl-L, etc.).
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      void markStatus('known');
    } else if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      void markStatus('learning');
    } else if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      void markStatus('ignored');
    }
  }

  const allTranslations = $derived(() => {
    if (!payload) return [];
    return [
      ...payload.translations.personal,
      ...payload.translations.official,
      ...payload.translations.community,
    ];
  });

  // ---- Definition-language filter (Basque dictionary) -------------
  // Each translation is glossed in some language (`targetLanguage`).
  // Basque carries English + Spanish + (eventually) monolingual Basque,
  // so we let the reader hide languages they don't read. The choice is a
  // pure display preference persisted in localStorage (no migration, not
  // cross-device).
  function readHiddenDefLangs(): Set<string> {
    if (!browser) return new Set<string>();
    try {
      return parseHiddenDefinitionLanguages(
        localStorage.getItem(HIDDEN_DEFINITION_LANGUAGES_KEY),
      );
    } catch {
      // localStorage can be absent/disabled (private mode, test env) —
      // fall back to "nothing hidden".
      return new Set<string>();
    }
  }

  let hiddenDefLangs = $state<Set<string>>(readHiddenDefLangs());

  const definitionLanguages = $derived(payload?.definitionLanguages ?? []);
  // Only worth showing the filter when there's more than one language to
  // choose between — single-language readers (e.g. Hindi → English only)
  // never see the control.
  const showDefLangFilter = $derived(definitionLanguages.length >= 2);

  function isDefLangVisible(code: string): boolean {
    return !hiddenDefLangs.has(code);
  }

  function toggleDefLang(code: string): void {
    const next = new Set(hiddenDefLangs);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    hiddenDefLangs = next;
    if (browser) {
      try {
        localStorage.setItem(
          HIDDEN_DEFINITION_LANGUAGES_KEY,
          serializeHiddenDefinitionLanguages(next),
        );
      } catch {
        /* storage disabled / over quota — the in-memory state still works */
      }
    }
  }

  // Translations rendered in the list (everything except the primary
  // personal editor slot), after the language filter. Used to drive the
  // "all hidden" empty-state.
  const visibleListTranslations = $derived(() => {
    if (!payload) return [];
    return [
      ...payload.translations.personal.slice(1),
      ...payload.translations.official,
      ...payload.translations.community,
    ].filter((t) => isDefLangVisible(t.targetLanguage));
  });

  // List rows that exist before the language filter (the primary personal
  // editor slot is rendered separately, so it's excluded here). When this
  // is non-zero but nothing survives the filter, the list shows an
  // "all hidden" empty-state rather than looking broken.
  const totalListCount = $derived(() => {
    if (!payload) return 0;
    const personalRest =
      payload.translations.personal.length > 0
        ? payload.translations.personal.length - 1
        : 0;
    return (
      personalRest +
      payload.translations.official.length +
      payload.translations.community.length
    );
  });

  // ---- Add-translation flow ---------------------------------------
  let showAddForm = $state(false);
  let newTranslationBody = $state('');
  let savingTranslation = $state(false);
  let addError = $state<string | null>(null);
  let addTextareaEl = $state<HTMLTextAreaElement | null>(null);

  // Focus the textarea as soon as the form mounts so the user can
  // start typing immediately after clicking "+ Add my translation".
  $effect(() => {
    if (showAddForm && addTextareaEl) {
      addTextareaEl.focus();
    }
  });

  // ---- Primary-translation editor ---------------------------------
  // The viewer's "selected" translation lives at the top of the
  // popup, above the learning-status buttons. It mirrors the hover
  // tooltip's pick (oldest personal row), and clicking it opens an
  // inline editor — PATCH if a personal row already exists, POST a
  // new one if not. Multiple personal rows still render in the
  // translations list below; this is just the prominent "yours" slot.
  let editingPrimary = $state(false);
  let primaryBody = $state('');
  let savingPrimary = $state(false);
  let primaryError = $state<string | null>(null);
  let primaryTextareaEl = $state<HTMLTextAreaElement | null>(null);

  $effect(() => {
    if (editingPrimary && primaryTextareaEl) {
      primaryTextareaEl.focus();
    }
  });

  // ---- Edit / delete personal translation -------------------------
  // The viewer can revise or remove their own translations inline.
  // The edit textarea reuses the same Enter-to-save / Esc-to-cancel
  // ergonomics as the add form. Delete is a single click guarded by
  // the browser's confirm dialog — translations are short, but
  // they're still real authored content, so a typo'd click shouldn't
  // wipe one silently.
  let editingId = $state<string | null>(null);
  let editBody = $state('');
  let savingEdit = $state(false);
  let editError = $state<string | null>(null);
  let editTextareaEl = $state<HTMLTextAreaElement | null>(null);
  let deletingId = $state<string | null>(null);
  let deleteError = $state<string | null>(null);

  $effect(() => {
    if (editingId !== null && editTextareaEl) {
      editTextareaEl.focus();
    }
  });

  // ---- Customize-official flow (T-3.11) ---------------------------
  // Which official translation (id) is currently being forked, if any,
  // plus the body of the in-progress fork. The eligibility set itself
  // lives in `customize-eligibility.ts` so the rule is unit-tested
  // separately from the component.
  let customizingId = $state<string | null>(null);
  let customizeBody = $state('');
  let savingCustomize = $state(false);
  let customizeError = $state<string | null>(null);
  let votingTranslationId = $state<string | null>(null);
  let voteError = $state<string | null>(null);

  // T-11.1 — translation report flow. The set of translations the viewer
  // has reported in this session is tracked client-side so the popup can
  // re-render the Report button as a "Reported" badge without refetching.
  // The set survives across word-to-word navigation in one mount but
  // resets on page reload, which is fine — the server enforces the
  // unique (reporter, translation) constraint either way.
  let reportingTranslationId = $state<string | null>(null);
  let reportedIds = $state<Set<string>>(new Set());
  let reportToast = $state<string | null>(null);

  const customizableIds = $derived(() =>
    customizableOfficialIds(
      isOwner,
      payload?.translations.official ?? [],
      payload?.translations.personal ?? [],
    ),
  );

  // T-2.8: a token is treated as a number whenever the NLP service
  // populated `numberForms` OR the raw surface looks like one.
  // The second arm catches chapters processed before the comma-fix
  // landed (their text_tokens.number_forms column is null even though
  // the surface is clearly a number) so the popup doesn't fall back
  // to the bogus auto-created lemma row for those tokens.
  const isNumberToken = $derived(
    token != null &&
      (token.numberForms != null || looksLikeNumberToken(token.surface)),
  );

  const numberDisplay = $derived((): NumberDisplay | null => {
    if (!token?.numberForms) return null;
    if (language === 'eu') {
      // Basque: Latin-script, so the native digits are the Latin digits
      // (the header dedupes them) and there's no separate romanization.
      return {
        label: 'Basque',
        nativeDigits: token.numberForms.digitsLatin,
        spelled: token.numberForms.eu.spelled,
        romanized: token.numberForms.eu.romanized,
      };
    }
    if (language === 'or') {
      return {
        label: 'Odia',
        nativeDigits: token.numberForms.digitsOrya,
        spelled: token.numberForms.odia.spelled,
        romanized: token.numberForms.odia.romanized,
      };
    }
    if (language === 'mr') {
      return {
        label: 'Marathi',
        nativeDigits: token.numberForms.digitsDeva,
        spelled: token.numberForms.mr.spelled,
        romanized: token.numberForms.mr.romanized,
      };
    }
    return {
      label: 'Hindi',
      nativeDigits: token.numberForms.digitsDeva,
      spelled: token.numberForms.hi.spelled,
      romanized: token.numberForms.hi.romanized,
    };
  });

  function startCustomize(t: PublicTranslation) {
    customizingId = t.id;
    customizeBody = t.body;
    customizeError = null;
  }

  function cancelCustomize() {
    customizingId = null;
    customizeBody = '';
    customizeError = null;
  }

  type PostError = { message: string; status: number };

  async function postTranslation(
    body: string,
    parentTranslationId: string | null,
  ): Promise<PublicTranslation> {
    // T-14.3b: when the popup is showing a pending phrase selection
    // (lemmaId is null because the synthetic token in ChapterBody
    // stands in for a not-yet-saved phrase), route the submission
    // through the phrase create-or-reuse endpoint and then attach
    // the translation to that phrase. The popup still presents the
    // single-word UI; the user just sees their translation save
    // and the popup close as the chapter refreshes around the new
    // phrase. parentTranslationId is dropped on this path — the
    // fork-an-official-translation flow only applies to lemma rows
    // today and there's no phrase translation to fork from yet.
    if (pendingSelection && !token?.lemmaId) {
      const phraseRes = await fetch('/api/v1/phrases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          language: pendingSelection.language,
          tokens: pendingSelection.surfaces,
        }),
      });
      if (!phraseRes.ok) {
        const text = await phraseRes.text().catch(() => '');
        throw {
          message: text || `Could not create phrase (${phraseRes.status})`,
          status: phraseRes.status,
        } as PostError;
      }
      const phraseJson = (await phraseRes.json()) as {
        phrase: { id: string };
      };
      const phraseId = phraseJson.phrase.id;
      const transRes = await fetch(
        `/api/v1/phrases/${phraseId}/translations`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body }),
        },
      );
      if (!transRes.ok) {
        const text = await transRes.text().catch(() => '');
        throw {
          message: text || `Could not save translation (${transRes.status})`,
          status: transRes.status,
        } as PostError;
      }
      // Trigger the chapter-level refresh so the new phrase span
      // picks up on the next render and the popup transitions out
      // of pending mode.
      onPhraseCreated?.(phraseId);
      // The lemma-shaped caller doesn't actually use the returned
      // PublicTranslation when pending — the popup closes via
      // onPhraseCreated. Return a stub of the right shape so the
      // type system stays happy.
      return {
        id: '',
        body,
        targetLanguage: 'en',
        source: 'user',
        sourceAttribution: null,
        parentTranslationId: null,
        upvotes: 0,
        downvotes: 0,
        createdAt: new Date().toISOString(),
      } as unknown as PublicTranslation;
    }
    if (!token || !token.lemmaId) throw new Error('Missing lemma id');
    const res = await fetch('/api/v1/translations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lemmaId: token.lemmaId,
        body,
        targetLanguage: 'en',
        parentTranslationId,
      }),
    });
    if (!res.ok) {
      // 429 carries a JSON body with a friendly message; everything
      // else falls through to the raw text + status combo.
      let message = `POST failed: ${res.status}`;
      if (res.status === 429) {
        const errBody = (await res
          .json()
          .catch(() => null)) as { message?: string } | null;
        message =
          errBody?.message ?? 'Too many translations submitted. Try again later.';
      } else {
        const text = await res.text().catch(() => '');
        if (text) message = text;
      }
      const err: PostError = { message, status: res.status };
      throw err;
    }
    const created = (await res.json()) as { translation: PublicTranslation };
    return created.translation;
  }

  // T-5.22: re-fetch the lemma payload after a write so the new row
  // definitely shows. The optimistic prepend was unreliable across
  // payload-may-be-null states and Svelte 5 $state proxy edge cases,
  // and would have placed customize-fork rows in the wrong position
  // anyway (the personal bucket sorts oldest-first server-side).
  async function refetchPayload(lemmaId: string) {
    const fresh = await fetch(`/api/v1/lemmas/${lemmaId}/translations`);
    if (fresh.ok) {
      payload = (await fresh.json()) as LemmaPayload;
    }
  }

  // The hover tooltip caches the chapter payload, so adding /
  // editing / deleting a personal translation needs to push the new
  // primary body up to the parent. The "primary" matches the loader's
  // pick: the oldest personal row (which the popup also lists first).
  function notifyPersonalChange() {
    if (!token?.lemmaId) return;
    const next = payload?.translations.personal[0]?.body ?? null;
    onPersonalTranslationChange?.(token.lemmaId, next);
  }

  function startEditPrimary() {
    primaryBody = payload?.translations.personal[0]?.body ?? '';
    primaryError = null;
    editingPrimary = true;
  }

  function cancelEditPrimary() {
    editingPrimary = false;
    primaryBody = '';
    primaryError = null;
  }

  async function submitPrimary() {
    if (!token?.lemmaId) return;
    const trimmed = primaryBody.trim();
    if (trimmed.length === 0) {
      cancelEditPrimary();
      return;
    }
    const lemmaId = token.lemmaId;
    const existing = payload?.translations.personal[0] ?? null;
    savingPrimary = true;
    primaryError = null;
    try {
      if (existing) {
        const res = await fetch(`/api/v1/translations/${existing.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: trimmed }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          primaryError = text || `Could not save (${res.status})`;
          return;
        }
      } else {
        await postTranslation(trimmed, null);
      }
      await refetchPayload(lemmaId);
      editingPrimary = false;
      primaryBody = '';
      notifyPersonalChange();
    } catch (e) {
      const err = e as Partial<PostError> & Error;
      primaryError = err.message ?? `Network error: ${(e as Error).message}`;
    } finally {
      savingPrimary = false;
    }
  }

  function onPrimaryKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitPrimary();
      return;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      cancelEditPrimary();
    }
  }

  function onPrimaryBlur() {
    if (savingPrimary) return;
    if (primaryBody.trim().length === 0) {
      cancelEditPrimary();
      return;
    }
    void submitPrimary();
  }

  async function submitNewTranslation() {
    if (!token) return;
    // T-14.3b: pending phrase has no lemmaId; postTranslation
    // routes that case through the phrase create-or-reuse path
    // and the popup closes via onPhraseCreated.
    if (!token.lemmaId && !pendingSelection) return;
    const trimmed = newTranslationBody.trim();
    if (trimmed.length === 0) {
      addError = 'Translation cannot be empty.';
      return;
    }
    const lemmaId = token.lemmaId;
    savingTranslation = true;
    addError = null;
    try {
      await postTranslation(trimmed, null);
      // Skip the lemma-payload refetch on the pending path — there's
      // no lemma to refetch, and the chapter-level callback closes
      // the popup so the next open will see the committed phrase.
      if (lemmaId) {
        await refetchPayload(lemmaId);
        notifyPersonalChange();
      }
      newTranslationBody = '';
      showAddForm = false;
    } catch (e) {
      addError = (e as PostError).message ?? (e as Error).message;
    } finally {
      savingTranslation = false;
    }
  }

  // T-5.21: Enter submits, Shift+Enter inserts a newline, Esc cancels
  // the form (without closing the panel). The textarea handler stops
  // propagation on Esc so Sheet doesn't also close itself.
  function onAddFormKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitNewTranslation();
      return;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      showAddForm = false;
      newTranslationBody = '';
      addError = null;
    }
  }

  // The form has no explicit Save/Cancel buttons — losing focus is
  // the natural "I'm done" signal. Empty content silently closes the
  // form; non-empty content commits exactly like Enter would.
  function onAddFormBlur() {
    if (savingTranslation) return;
    if (newTranslationBody.trim().length === 0) {
      showAddForm = false;
      addError = null;
      return;
    }
    void submitNewTranslation();
  }

  // Mirror onAddFormKeydown so Enter/Esc on the customize textarea
  // behaves the same way as on the add-translation textarea.
  function onCustomizeKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitCustomize();
      return;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      cancelCustomize();
    }
  }

  async function submitCustomize() {
    if (!customizingId || !token || !token.lemmaId) return;
    const trimmed = customizeBody.trim();
    if (trimmed.length === 0) {
      customizeError = 'Translation cannot be empty.';
      return;
    }
    const lemmaId = token.lemmaId;
    savingCustomize = true;
    customizeError = null;
    try {
      await postTranslation(trimmed, customizingId);
      await refetchPayload(lemmaId);
      customizingId = null;
      customizeBody = '';
      notifyPersonalChange();
    } catch (e) {
      customizeError = (e as PostError).message ?? (e as Error).message;
    } finally {
      savingCustomize = false;
    }
  }

  function startEditPersonal(t: PublicTranslation) {
    editingId = t.id;
    editBody = t.body;
    editError = null;
  }

  function cancelEditPersonal() {
    editingId = null;
    editBody = '';
    editError = null;
  }

  async function submitEditPersonal() {
    if (!editingId || !token?.lemmaId) return;
    const trimmed = editBody.trim();
    if (trimmed.length === 0) {
      editError = 'Translation cannot be empty.';
      return;
    }
    const lemmaId = token.lemmaId;
    const id = editingId;
    savingEdit = true;
    editError = null;
    try {
      const res = await fetch(`/api/v1/translations/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        editError = text || `Could not save (${res.status})`;
        return;
      }
      await refetchPayload(lemmaId);
      editingId = null;
      editBody = '';
      notifyPersonalChange();
    } catch (e) {
      editError = `Network error: ${(e as Error).message}`;
    } finally {
      savingEdit = false;
    }
  }

  function onEditPersonalKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitEditPersonal();
      return;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      cancelEditPersonal();
    }
  }

  function onEditPersonalBlur() {
    if (savingEdit) return;
    if (editBody.trim().length === 0) {
      cancelEditPersonal();
      return;
    }
    void submitEditPersonal();
  }

  async function deletePersonal(t: PublicTranslation) {
    if (!token?.lemmaId) return;
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Delete this translation?')
    ) {
      return;
    }
    const lemmaId = token.lemmaId;
    deletingId = t.id;
    deleteError = null;
    try {
      const res = await fetch(`/api/v1/translations/${t.id}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const text = await res.text().catch(() => '');
        deleteError = text || `Could not delete (${res.status})`;
        return;
      }
      await refetchPayload(lemmaId);
      notifyPersonalChange();
    } catch (e) {
      deleteError = `Network error: ${(e as Error).message}`;
    } finally {
      deletingId = null;
    }
  }

  async function voteTranslation(
    translation: PublicTranslation,
    vote: 'up' | 'down',
  ) {
    if (!token?.lemmaId) return;
    const nextVote = translation.viewerVote === vote ? null : vote;
    votingTranslationId = translation.id;
    voteError = null;
    try {
      const res = await fetch(`/api/v1/translations/${translation.id}/vote`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vote: nextVote }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `PATCH failed: ${res.status}`);
      }
      await refetchPayload(token.lemmaId);
    } catch (e) {
      voteError = (e as Error).message;
    } finally {
      votingTranslationId = null;
    }
  }

  // T-6.1: write a `pick_candidate` correction. The reader's
  // colour rendering for this token is updated optimistically via
  // the `onCorrectionApplied` callback so the user sees the new
  // lemma immediately; the server row backs the change for next
  // read (handled by T-6.4's loader join).
  async function pickCandidate(lemmaId: string) {
    if (!token) return;
    const tokenId = token.id;
    pickingLemmaId = lemmaId;
    pickError = null;
    try {
      const res = await fetch('/api/v1/me/token-corrections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tokenId,
          type: 'pick_candidate',
          chosenLemmaId: lemmaId,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
      }
      onCorrectionApplied?.(tokenId, lemmaId);
      // Close the popup after a successful pick so the user lands
      // back on the reader; the parent's reactive state has already
      // re-rendered the token with the new lemma.
      onClose();
    } catch (e) {
      pickError = (e as Error).message;
    } finally {
      pickingLemmaId = null;
    }
  }

  function openReport(translationId: string) {
    reportingTranslationId = translationId;
    reportToast = null;
  }
  function closeReport() {
    reportingTranslationId = null;
  }
  function onReportOutcome(
    outcome:
      | { kind: 'reported' }
      | { kind: 'duplicate' }
      | { kind: 'rate_limited'; retryAfterSeconds?: number },
  ) {
    if (!reportingTranslationId) return;
    if (outcome.kind === 'reported') {
      reportedIds = new Set([...reportedIds, reportingTranslationId]);
      reportToast = 'Thanks — moderators will review.';
    } else if (outcome.kind === 'duplicate') {
      reportedIds = new Set([...reportedIds, reportingTranslationId]);
      reportToast = "You've already reported this translation.";
    } else if (outcome.kind === 'rate_limited') {
      const mins = outcome.retryAfterSeconds
        ? Math.ceil(outcome.retryAfterSeconds / 60)
        : null;
      reportToast = mins
        ? `Too many reports submitted. Try again in ~${mins} min.`
        : 'Too many reports submitted. Try again later.';
    }
  }

  async function markStatus(
    status: 'unknown' | 'learning' | 'known' | 'ignored',
  ) {
    if (!token || !token.lemmaId) return;
    const lemmaId = token.lemmaId;
    const previous = optimisticStatus;
    optimisticStatus = status;
    writeError = null;
    // Capture the mined sentence when we have reading context (server tokens
    // carry chapterId; the API reconstructs the sentence around this token).
    const context =
      token.chapterId != null ? { chapterId: token.chapterId, tokenIdx: token.idx } : {};
    try {
      const res = await fetch(`/api/v1/me/known-lemmas/${lemmaId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, ...context }),
      });
      if (!res.ok) {
        throw new Error(`PATCH failed: ${res.status}`);
      }
      onStatusChange?.(lemmaId, status);
    } catch (e) {
      optimisticStatus = previous;
      writeError = (e as Error).message;
    }
  }

  // ---- Sentence translation (OpenAI) ------------------------------
  async function translateSentence(): Promise<void> {
    const t = token;
    if (!t?.chapterId) return;
    translating = true;
    translateError = null;
    try {
      const res = await fetch('/api/v1/translate-sentence', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chapterId: t.chapterId, tokenIdx: t.idx, language }),
      });
      if (!res.ok) {
        if (res.status === 503) throw new Error('Sentence translation isn’t set up yet.');
        let message = `Translation failed (${res.status})`;
        try {
          const errBody = (await res.json()) as { message?: string };
          if (errBody?.message) message = errBody.message;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(message);
      }
      const data = (await res.json()) as { sentence: string; translation: string };
      translatedSentence = data.sentence;
      sentenceTranslation = data.translation;
    } catch (e) {
      translateError = (e as Error).message;
    } finally {
      translating = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- T-5.17: dimmed=false so the reader paragraph remains readable
     while a word is locked in the panel.
     The panel is always open on desktop (static right column) and
     conditional on mobile (slides up only when a word is picked). -->
<Sheet open={sheetOpen} onClose={onClose} title="" dimmed={false}>
  {#if selectionError}
    <p class="err small sp-phrase-select-err">{selectionError}</p>
  {/if}
  {#if phrase}
    <!-- T-14.3 / T-14.4: phrase banner. Header (eyebrow + gloss) +
         status flips ride from T-14.3; T-14.4 adds the visible
         translations list and the "Add translation" form so a
         learner can attach meaning to a phrase the same way
         T-3.5 lets them customize a lemma translation. -->
    <section class="sp-phrase" data-testid="word-popup-phrase">
      <header class="sp-phrase-head">
        <span class="sp-phrase-eyebrow">Phrase</span>
        {#if phrase.glossDefault}
          <p class="sp-phrase-gloss">{phrase.glossDefault}</p>
        {:else}
          <p class="sp-phrase-gloss muted">No phrase gloss yet.</p>
        {/if}
      </header>
      {#if isOwner}
        <div
          class="sp-status sp-phrase-status"
          role="group"
          aria-label="Mark phrase status"
        >
          <button
            type="button"
            data-active={optimisticPhraseStatus === 'learning' ? '1' : '0'}
            onclick={() => setPhraseStatus('learning')}
          >
            Learning
          </button>
          <button
            type="button"
            data-active={optimisticPhraseStatus === 'known' ? '1' : '0'}
            onclick={() => setPhraseStatus('known')}
          >
            Known
          </button>
          <button
            type="button"
            data-active={optimisticPhraseStatus === 'ignored' ? '1' : '0'}
            onclick={() => setPhraseStatus('ignored')}
          >
            Ignored
          </button>
        </div>
        {#if phraseStatusError}
          <p class="err small">{phraseStatusError}</p>
        {/if}
      {/if}
      <!-- T-14.4: translations list. The phrase detail endpoint
           (GET /api/v1/phrases/:id) returns visible translations
           ordered curator > imported > user > vote. -->

      <div class="sp-phrase-trans" data-testid="phrase-translations">
        {#if phraseTranslationsError}
          <p class="err small">{phraseTranslationsError}</p>
        {:else if phraseTranslations.length === 0}
          <p class="muted small">No translations yet — add one below.</p>
        {:else}
          <ul class="sp-phrase-trans-list">
            {#each phraseTranslations as t (t.id)}
              <li class="sp-phrase-trans-row" data-source={t.source}>
                <span class="sp-phrase-trans-body">{t.body}</span>
              </li>
            {/each}
          </ul>
        {/if}
        {#if isOwner}
          <form
            class="sp-phrase-trans-form"
            onsubmit={(e) => {
              e.preventDefault();
              void submitPhraseTranslation();
            }}
          >
            <label class="sp-phrase-trans-label" for="phrase-trans-input">
              Add translation
            </label>
            <textarea
              id="phrase-trans-input"
              class="sp-phrase-trans-input"
              data-testid="phrase-translation-input"
              rows="2"
              placeholder="e.g. to wait"
              bind:value={phraseTranslationDraft}
              disabled={phraseSubmitting}
              maxlength="500"
            ></textarea>
            <div class="sp-phrase-trans-actions">
              <button
                type="submit"
                disabled={phraseSubmitting || phraseTranslationDraft.trim().length === 0}
                data-testid="phrase-translation-submit"
              >
                {phraseSubmitting ? 'Saving…' : 'Add'}
              </button>
              {#if phraseSubmitError}
                <span class="err small">{phraseSubmitError}</span>
              {/if}
            </div>
          </form>
        {/if}
      </div>
    </section>
  {/if}
  {#if !token}
    <div class="sp-empty" data-testid="word-popup-empty">
      <p>Click a word to see its definition.</p>
    </div>
  {:else}
    <div data-testid="word-popup">
      <header class="sp-head">
        <button
          type="button"
          class="sp-close"
          aria-label="Close"
          title="Close"
          onclick={onClose}
        >
          ×
        </button>
        {#if token.numberForms && numberDisplay()}
          <h2 class="sp-word num-title">
            <span>{token.numberForms.digitsLatin}</span>
            {#if numberDisplay()?.nativeDigits !== token.numberForms.digitsLatin}
              <!-- Latin-script languages (Basque) repeat the Latin digits;
                   only show a second copy for non-Latin scripts. -->
              <span class="num-native">{numberDisplay()?.nativeDigits}</span>
            {/if}
          </h2>
        {:else}
          <h2 class="sp-word">
            <!-- Editable headword: type over it to search the internal
                 dictionary as you go (results below). An exact headword match
                 — or Enter / clicking a result — loads that lemma into the
                 Translations section. After a pause it also re-runs the admin
                 reference lookup for the typed word. Lets you recover when the
                 NLP parsed the wrong lemma. -->
            <input
              class="sp-word-input"
              data-testid="headword-input"
              type="text"
              autocomplete="off"
              spellcheck="false"
              aria-label="Headword — edit to search the dictionary"
              value={headwordInput}
              oninput={(e) => onHeadwordInput((e.currentTarget as HTMLInputElement).value)}
              onkeydown={(e) => {
                if (e.key === 'Escape') {
                  internalResults = [];
                } else if (e.key === 'Enter' && internalResults[0]) {
                  // Load the top suggestion without forcing a click.
                  e.preventDefault();
                  void selectInternalLemma(internalResults[0]);
                }
              }}
            />
            {#if payload}
              <PosPill pos={payload.lemma.pos} class="sp-pos-pill" />
            {/if}
            {#if bookFrequency !== null && bookFrequency > 0}
              <span
                class="sp-freq-badge"
                data-testid="book-frequency"
                aria-label={`this word appears ${bookFrequency} ${
                  bookFrequency === 1 ? 'time' : 'times'
                } in the book`}
              >
                <span class="sp-freq-count" aria-hidden="true">{bookFrequency}×</span>
                <!-- prettier-ignore -->
                <span class="sp-freq-tip" role="tooltip">this word appears {bookFrequency}{bookFrequency === 1 ? ' time' : ' times'} in the book</span>
              </span>
            {/if}
            {#if internalResults.length > 0}
              <ul class="sp-word-results" role="listbox" data-testid="headword-results">
                {#each internalResults as r (r.id)}
                  <li>
                    <button
                      type="button"
                      class="sp-word-result"
                      role="option"
                      aria-selected="false"
                      onclick={() => void selectInternalLemma(r)}
                    >
                      <span class="sp-word-result-hw">{r.headword}</span>
                      {#if r.pos}<span class="sp-word-result-pos">{r.pos.toLowerCase()}</span>{/if}
                      {#if r.glossDefault}<span class="sp-word-result-gloss">{r.glossDefault}</span
                        >{/if}
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </h2>
        {/if}
      {#if token.numberForms}
        <!-- T-2.8: digit-only NUM token. Show the Latin digits beside
             the text language's native-script digits, then the
             language-specific spelled-out form + ISO 15919 romanization.
             The lemma / translation / status panes are skipped —
             numbers aren't lemmas to learn. -->
        <div class="num-block" data-testid="number-forms">
          <div class="num-entry">
            <span class="num-lang">{numberDisplay()?.label}</span>
            <span class="num-spelled">{numberDisplay()?.spelled}</span>
            {#if numberDisplay()?.romanized}
              <!-- Latin-script languages (Basque) have no separate
                   romanization; the spelled-out form is the reading. -->
              <span class="num-roman">{numberDisplay()?.romanized}</span>
            {/if}
          </div>
        </div>
      {:else if isNumberToken}
        <!-- T-2.8: legacy token from a chapter processed before the
             number-form support landed. We can detect that the surface
             is a number but the worker never wrote per-language
             spelled-out forms, so we deliberately suppress the (almost
             always wrong) auto-created lemma row and ask the owner to
             reprocess the text. -->
        <p class="muted small" data-testid="number-needs-reprocess">
          Reprocess this text to see written-out number forms in each language.
        </p>
      {:else}
        {#if token.romanization}
          <p class="sp-roman">{token.romanization}</p>
        {/if}
        {#if payload}
          {@const featurePills = getFeaturePills(payload.lemma.pos, token?.features ?? {})}
          {#if featurePills.length > 0}
            <p class="sp-row sp-feats-row" data-testid="feature-pills">
              <span class="k">Form</span>
              <span class="v sp-feats">
                {#each featurePills as pill (pill.featKey + pill.featValue)}
                  <FeaturePill
                    short={pill.shortLabel}
                    long={pill.longLabel}
                    featKey={pill.featKey}
                  />
                {/each}
              </span>
            </p>
          {/if}
        {:else if token.isOov}
          <p class="muted">No dictionary match</p>
        {:else if loadError}
          <p class="err">{loadError}</p>
        {:else if token.lemmaId}
          <p class="muted">Loading…</p>
        {/if}
      {/if}
    </header>

    {#if !isNumberToken}
    {#if isOwner && token.lemmaId && payload}
      <section class="sp-primary" data-testid="primary-translation">
        {#if editingPrimary}
          <form
            class="sp-primary-form"
            onsubmit={(e) => {
              e.preventDefault();
              void submitPrimary();
            }}
          >
            <textarea
              bind:this={primaryTextareaEl}
              bind:value={primaryBody}
              rows="1"
              maxlength="500"
              disabled={savingPrimary}
              aria-label="Your translation"
              placeholder="Type your translation"
              title={'Enter to save\nShift+Enter for a newline\nEsc to cancel'}
              onkeydown={onPrimaryKeydown}
              onblur={onPrimaryBlur}
            ></textarea>
            {#if primaryError}
              <p class="err small">{primaryError}</p>
            {/if}
          </form>
        {:else}
          <button
            type="button"
            class="sp-primary-display"
            data-testid="primary-translation-edit"
            data-empty={payload.translations.personal[0] ? '0' : '1'}
            title={'Enter to save\nShift+Enter for a newline\nEsc to cancel'}
            onclick={startEditPrimary}
          >
            {#if payload.translations.personal[0]}
              <span class="sp-primary-body">
                {payload.translations.personal[0].body}
              </span>
            {:else}
              <span class="sp-primary-empty">+ Add your translation</span>
            {/if}
          </button>
        {/if}
      </section>
    {/if}
    {#if isOwner && token.lemmaId}
      <div class="sp-status" role="group" aria-label="Mark status">
        <button
          type="button"
          data-active={optimisticStatus === 'learning' ? '1' : '0'}
          onclick={() => markStatus('learning')}
        >
          Learning
        </button>
        <button
          type="button"
          data-active={optimisticStatus === 'known' ? '1' : '0'}
          onclick={() => markStatus('known')}
        >
          Known
        </button>
        <button
          type="button"
          data-active={optimisticStatus === 'ignored' ? '1' : '0'}
          onclick={() => markStatus('ignored')}
        >
          Ignored
        </button>
      </div>
      {#if writeError}
        <p class="err small">Could not save: {writeError}</p>
      {/if}
    {/if}

    {#if token.chapterId && token.isWord && !isNumberToken}
      <!-- OpenAI sentence-level translation for the sentence this word sits
           in. Lazy: only fetched when the reader asks. -->
      <div class="sp-translate" data-testid="sentence-translate">
        {#if sentenceTranslation}
          {#if translatedSentence}
            <p class="sp-translate-src">{translatedSentence}</p>
          {/if}
          <p class="sp-translate-out">{sentenceTranslation}</p>
        {:else}
          <button
            type="button"
            class="sp-translate-btn"
            data-testid="translate-sentence-btn"
            onclick={translateSentence}
            disabled={translating}
          >
            {translating ? 'Translating…' : 'Translate sentence'}
          </button>
        {/if}
        {#if translateError}
          <p class="err small" data-testid="translate-error">{translateError}</p>
        {/if}
      </div>
    {/if}

    {#if payload}
      <h3 class="sp-section-h">
        Translations
        <span class="muted">{allTranslations().length}</span>
      </h3>

      {#if showDefLangFilter}
        <div
          class="def-lang-filter"
          role="group"
          aria-label="Filter definitions by language"
          data-testid="def-lang-filter"
        >
          {#each definitionLanguages as code (code)}
            <button
              type="button"
              class="def-lang-chip"
              data-active={isDefLangVisible(code) ? '1' : '0'}
              aria-pressed={isDefLangVisible(code)}
              data-testid={`def-lang-chip-${code}`}
              onclick={() => toggleDefLang(code)}
              title={isDefLangVisible(code)
                ? `Hide ${definitionLanguageName(code)} definitions`
                : `Show ${definitionLanguageName(code)} definitions`}
            >
              {definitionLanguageName(code)}
            </button>
          {/each}
        </div>
      {/if}

      <ul class="translations">
        {#each payload.translations.personal
          .slice(1)
          .filter((t) => isDefLangVisible(t.targetLanguage)) as t (t.id)}
          <li class="personal-row" data-testid="personal-row">
            {#if editingId === t.id}
              <form
                class="add-form"
                data-testid="edit-personal-form"
                onsubmit={(e) => {
                  e.preventDefault();
                  void submitEditPersonal();
                }}
              >
                <textarea
                  bind:this={editTextareaEl}
                  bind:value={editBody}
                  rows="2"
                  maxlength="500"
                  disabled={savingEdit}
                  aria-label="Edit your translation"
                  onkeydown={onEditPersonalKeydown}
                  onblur={onEditPersonalBlur}
                ></textarea>
                {#if editError}
                  <p class="err small">{editError}</p>
                {/if}
              </form>
            {:else}
              <div class="personal-body">
                <span class="personal-text">{t.body}</span>
                {#if showDefLangFilter}
                  <span class="def-lang-badge">
                    {definitionLanguageName(t.targetLanguage)}
                  </span>
                {/if}
                {#if isOwner}
                  <div class="personal-actions">
                    <button
                      type="button"
                      class="row-action"
                      data-testid="edit-personal"
                      title="Edit this translation"
                      disabled={editingId !== null || deletingId !== null}
                      onclick={() => startEditPersonal(t)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      class="row-action danger"
                      data-testid="delete-personal"
                      title="Delete this translation"
                      disabled={deletingId !== null || editingId !== null}
                      onclick={() => void deletePersonal(t)}
                    >
                      {deletingId === t.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                {/if}
              </div>
              {#if deleteError && deletingId === null}
                <p class="err small">{deleteError}</p>
              {/if}
            {/if}
          </li>
        {/each}
        {#each payload.translations.official.filter((t) => isDefLangVisible(t.targetLanguage)) as t (t.id)}
          <li class="official-row">
            <div class="official-body">
              {t.body}
              {#if showDefLangFilter}
                <span class="def-lang-badge">
                  {definitionLanguageName(t.targetLanguage)}
                </span>
              {/if}
              {#if customizableIds().has(t.id)}
                <button
                  type="button"
                  class="customize-toggle"
                  data-testid="customize-toggle"
                  onclick={() => startCustomize(t)}
                  disabled={customizingId !== null}
                  title="Fork this translation into a private copy you can edit"
                >
                  Customize
                </button>
              {/if}
            </div>
            {#if customizingId === t.id}
              <form
                class="customize-form"
                data-testid="customize-form"
                onsubmit={(e) => {
                  e.preventDefault();
                  void submitCustomize();
                }}
              >
                <textarea
                  bind:value={customizeBody}
                  rows="2"
                  maxlength="500"
                  disabled={savingCustomize}
                  aria-label="Your customized translation"
                  onkeydown={onCustomizeKeydown}
                ></textarea>
                {#if customizeError}
                  <p class="err small">{customizeError}</p>
                {/if}
                <div class="add-row">
                  <button type="submit" disabled={savingCustomize}>
                    {savingCustomize ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    class="ghost"
                    disabled={savingCustomize}
                    onclick={cancelCustomize}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            {/if}
          </li>
        {/each}
        {#each payload.translations.community.filter((t) => isDefLangVisible(t.targetLanguage)) as t (t.id)}
          <li class="community-row">
            <div class="community-body">
              {t.body}
              {#if showDefLangFilter}
                <span class="def-lang-badge">
                  {definitionLanguageName(t.targetLanguage)}
                </span>
              {/if}
              {#if isOwner}
                {#if reportedIds.has(t.id)}
                  <span class="reported-badge" data-testid="reported-badge">
                    Reported
                  </span>
                {:else}
                  <button
                    type="button"
                    class="report-button"
                    data-testid="report-button"
                    aria-label="Report translation"
                    title="Report this translation to moderators"
                    onclick={() => openReport(t.id)}
                  >
                    Report
                  </button>
                {/if}
              {/if}
            </div>
            {#if isOwner}
              <div class="vote-controls" aria-label="Community translation votes">
                <button
                  type="button"
                  class="vote-button"
                  data-active={t.viewerVote === 'up' ? '1' : '0'}
                  disabled={votingTranslationId === t.id}
                  aria-label="Upvote translation"
                  title="Upvote translation"
                  onclick={() => voteTranslation(t, 'up')}
                >
                  ↑
                </button>
                <span class="vote-score" aria-label="Vote score">{t.voteScore}</span>
                <button
                  type="button"
                  class="vote-button"
                  data-active={t.viewerVote === 'down' ? '1' : '0'}
                  disabled={votingTranslationId === t.id}
                  aria-label="Downvote translation"
                  title="Downvote translation"
                  onclick={() => voteTranslation(t, 'down')}
                >
                  ↓
                </button>
              </div>
            {/if}
          </li>
        {/each}
        {#if allTranslations().length === 0}
          <li class="muted">No translations yet.</li>
        {:else if showDefLangFilter && totalListCount() > 0 && visibleListTranslations().length === 0}
          <li class="muted" data-testid="def-lang-all-hidden">
            All definitions are hidden by the language filter above.
          </li>
        {/if}
      </ul>
      {#if reportToast}
        <p class="report-toast" data-testid="report-toast" role="status">
          {reportToast}
        </p>
      {/if}
      {#if voteError}
        <p class="err small">Could not save vote: {voteError}</p>
      {/if}

    {/if}

    <!-- T-14.3b: "+ Add my translation" sits outside the
         `{#if payload}` block so it surfaces both for normal lemma
         tokens (after the lemma fetch resolves) and for the
         synthetic pending-phrase token (where there's no lemmaId
         and so no payload at all — the form's submit routes
         through phrase create-or-reuse + phrase translation
         POST). On the pending path the popup closes via the
         chapter-level onPhraseCreated callback rather than
         re-rendering its own translations list. -->
    {#if isOwner && (payload || pendingSelection)}
      {#if showAddForm}
        <form
          class="add-form"
          onsubmit={(e) => {
            e.preventDefault();
            void submitNewTranslation();
          }}
        >
          <textarea
            bind:this={addTextareaEl}
            bind:value={newTranslationBody}
            placeholder="Type your translation"
            title={'Enter to save\nShift+Enter for a newline\nEsc to cancel'}
            rows="2"
            maxlength="500"
            disabled={savingTranslation}
            onkeydown={onAddFormKeydown}
            onblur={onAddFormBlur}
          ></textarea>
          {#if addError}
            <p class="err small">{addError}</p>
          {/if}
        </form>
      {:else}
        <button
          type="button"
          class="add-toggle"
          onclick={() => {
            showAddForm = true;
          }}
        >
          + Add my translation
        </button>
      {/if}
    {/if}

    {#if showAdminRef}
      <!-- Admin-only external dictionaries (Elhuyar / Euskaltzaindia),
           expanded by default and tabbed by language. Reference-only —
           fetched live, never stored or shown to readers. -->
      <section class="ext-dict" data-testid="admin-ref">
        <div class="ext-search" role="search">
          <input
            type="search"
            class="ext-search-input"
            data-testid="ref-search"
            placeholder="Search reference dictionaries…"
            aria-label="Search reference dictionaries"
            autocomplete="off"
            value={adminRefSearch}
            oninput={(e) => onAdminRefInput((e.currentTarget as HTMLInputElement).value)}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void loadAdminRef(adminRefSearch, { exact: true });
              } else if (e.key === 'Escape') {
                adminRefSuggestions = [];
              }
            }}
          />
          <span class="ext-search-tag muted">admin</span>
          {#if adminRefSuggestions.length > 0}
            <ul class="ext-suggest" role="listbox" data-testid="ref-suggest">
              {#each adminRefSuggestions as s (s)}
                <li>
                  <button
                    type="button"
                    class="ext-suggest-item"
                    role="option"
                    aria-selected="false"
                    onclick={() => void loadAdminRef(s, { exact: true })}
                  >
                    {s}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
        <div class="ext-tabs" role="tablist" aria-label="Reference language">
          {#each REFERENCE_LANGUAGE_TABS as lang (lang)}
            <button
              type="button"
              role="tab"
              class="ext-tab"
              data-active={effectiveRefTab === lang ? '1' : '0'}
              aria-selected={effectiveRefTab === lang}
              data-testid={`ref-tab-${lang}`}
              title={definitionLanguageName(lang)}
              onclick={() => selectRefTab(lang)}
            >
              {lang.toUpperCase()}
            </button>
          {/each}
        </div>
        {#if adminRefLoading}
          <p class="muted small" data-testid="admin-ref-loading">
            Looking up “{adminRefWord ?? adminRefLookupWord}”…
          </p>
        {:else if adminRefError}
          <p class="err small" data-testid="admin-ref-error">{adminRefError}</p>
        {:else if shownRefResults.length > 0}
          <ul class="ext-list">
            {#each shownRefResults as r, i (r.source + i)}
              <li class="ext-row">
                <div class="ext-def">
                  {#if r.pos}<span class="ext-pos">{r.pos}</span>{/if}
                  <span>{r.definition}</span>
                  {#if r.examples.length > 0}
                    <button
                      type="button"
                      class="ext-ex"
                      aria-label="Show {r.examples.length} example{r.examples
                        .length === 1
                        ? ''
                        : 's'}"
                    >
                      <span class="ext-ex-icon" aria-hidden="true">❝</span>
                      <span class="ext-ex-pop" role="note">
                        {#each r.examples as ex (ex)}
                          <span class="ext-ex-item">{ex}</span>
                        {/each}
                      </span>
                    </button>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted small" data-testid="admin-ref-empty">
            No {definitionLanguageName(effectiveRefTab)} entries.
          </p>
        {/if}
      </section>
    {/if}

    <!-- T-6.2: "Fix" affordance — every popup gets it, even the
         non-ambiguous ones (a learner may know the worker got the
         lemma wrong on a token where the model wasn't unsure). -->
    {#if isOwner}
      <button
        type="button"
        class="fix-toggle"
        onclick={() => (showCorrectionModal = true)}
        title="Search the dictionary or mark this surface"
      >
        Fix this word
      </button>
    {/if}

    {#if token.isAmbiguous && token.candidates.length > 0}
      <button
        type="button"
        class="alt-toggle"
        onclick={() => (showAlternates = !showAlternates)}
        aria-expanded={showAlternates}
      >
        <span class="chev" aria-hidden="true" data-open={showAlternates ? '1' : '0'}>›</span>
        {token.candidates.length} alternate {token.candidates.length === 1 ? 'meaning' : 'meanings'}
      </button>
      {#if showAlternates}
        <ul class="alt-list" data-testid="alt-candidates">
          {#each token.candidates as cand (cand.lemmaId)}
            <li class="alt" data-lemma-id={cand.lemmaId}>
              <div class="alt-head">
                <span class="alt-h">{cand.headword}</span>
                <PosPill pos={cand.pos} class="alt-pos-pill" />
              </div>
              {#if cand.glossDefault}
                <p class="alt-gloss">{cand.glossDefault}</p>
              {/if}
              <button
                type="button"
                class="alt-pick"
                disabled={pickingLemmaId === cand.lemmaId}
                onclick={() => pickCandidate(cand.lemmaId)}
              >
                {pickingLemmaId === cand.lemmaId ? 'Saving…' : 'This one'}
              </button>
            </li>
          {/each}
        </ul>
        {#if pickError}
          <p class="err small" role="alert">{pickError}</p>
        {/if}
      {/if}
    {/if}
    {/if}
    </div>
  {/if}
</Sheet>

{#if token}
  <CorrectionModal
    open={showCorrectionModal}
    {token}
    {language}
    onClose={() => (showCorrectionModal = false)}
    onApplied={(lemmaId) => {
      onCorrectionApplied?.(token.id, lemmaId);
      onClose();
    }}
  />
{/if}

<ReportTranslationModal
  open={reportingTranslationId !== null}
  translationId={reportingTranslationId}
  onClose={closeReport}
  onReported={onReportOutcome}
/>

<style>
  .sp-empty {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.85rem;
    font-style: italic;
    text-align: center;
    padding: 1.5rem 0.5rem;
  }
  /* T-14.3: phrase banner. Sits above the token block when the
     user clicked inside a phrase wrapper. Lightweight visual
     treatment so it doesn't compete with the (richer) token /
     lemma section underneath. */
  .sp-phrase {
    margin: 0 0 1rem;
    padding: 0.5rem 0.75rem 0.6rem;
    border-radius: 8px;
    background: color-mix(in srgb, var(--color-accent) 6%, transparent);
  }
  .sp-phrase-head {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .sp-phrase-eyebrow {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .sp-phrase-gloss {
    margin: 0;
    font-size: 0.95rem;
  }
  .sp-phrase-gloss.muted {
    color: var(--ink-3, var(--color-fg-muted));
    font-style: italic;
  }
  .sp-phrase-status {
    margin-top: 0.5rem;
  }
  .sp-phrase-select-err {
    margin: 0 0 0.75rem;
  }
  /* T-14.4: phrase translations list + add form. The list re-uses
     the popup's neutral type scale; the per-row attribution chip
     surfaces source provenance the same way T-3.8 surfaces lemma-
     translation provenance. */
  .sp-phrase-trans {
    margin-top: 0.6rem;
    padding-top: 0.55rem;
    border-top: 1px dashed
      color-mix(in srgb, var(--ink, var(--color-fg)) 12%, transparent);
  }
  .sp-phrase-trans-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .sp-phrase-trans-row {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    font-size: 0.9rem;
  }
  .sp-phrase-trans-body {
    flex: 1;
  }
  .sp-phrase-trans-form {
    margin-top: 0.55rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .sp-phrase-trans-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .sp-phrase-trans-input {
    width: 100%;
    resize: vertical;
    min-height: 2.5rem;
    border-radius: 6px;
    border: 1px solid var(--rule, var(--color-border));
    background: var(--bg, var(--color-bg));
    color: var(--ink, var(--color-fg));
    padding: 0.4rem 0.5rem;
    font: inherit;
  }
  .sp-phrase-trans-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .sp-phrase-trans-actions button {
    padding: 0.3rem 0.7rem;
    border-radius: 6px;
    border: 1px solid var(--rule, var(--color-border));
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    cursor: pointer;
    font-size: 0.85rem;
  }
  .sp-phrase-trans-actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .sp-head {
    position: relative;
    margin-bottom: 0.85rem;
  }
  .sp-close {
    position: absolute;
    top: -0.25rem;
    right: -0.25rem;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 1.4rem;
    line-height: 1;
    cursor: pointer;
  }
  .sp-close:hover {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 8%, transparent);
    color: var(--ink, var(--color-fg));
  }
  .sp-word {
    position: relative;
    margin: 0 0 0.25rem;
    /* Reserve room on the right so the freq badge clears the absolutely
       positioned close button. */
    padding-right: 1.9rem;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.85rem;
    line-height: 1.1;
    color: var(--ink, var(--color-fg));
  }
  .sp-word-input {
    flex: 1;
    min-width: 0;
    border: 0;
    border-bottom: 1px dashed transparent;
    background: transparent;
    padding: 0 0 1px;
    font: inherit;
    color: inherit;
  }
  .sp-word-input:hover {
    border-bottom-color: color-mix(in oklch, var(--ink, var(--color-fg)) 22%, transparent);
  }
  .sp-word-input:focus {
    outline: none;
    border-bottom-color: var(--accent, var(--color-accent));
  }
  .sp-word-results {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 1.9rem;
    z-index: 9;
    margin: 0;
    padding: 0.2rem;
    list-style: none;
    max-height: 260px;
    overflow-y: auto;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    background: var(--paper, var(--color-bg));
    box-shadow: 0 8px 24px color-mix(in oklch, var(--ink, #000) 20%, transparent);
  }
  .sp-word-result {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    width: 100%;
    text-align: left;
    padding: 0.35rem 0.45rem;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--ink, var(--color-fg));
    font-family: var(--font-sans, var(--font-serif));
    cursor: pointer;
  }
  .sp-word-result:hover,
  .sp-word-result:focus-visible {
    background: color-mix(in oklch, var(--accent, var(--color-accent)) 14%, transparent);
    outline: none;
  }
  .sp-word-result-hw {
    font-weight: 600;
    font-size: 0.95rem;
  }
  .sp-word-result-pos {
    font-size: 0.66rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-3, var(--color-fg-muted));
    flex-shrink: 0;
  }
  .sp-word-result-gloss {
    min-width: 0;
    font-size: 0.8rem;
    color: var(--ink-2, var(--color-fg-muted));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sp-freq-badge {
    position: relative;
    margin-left: auto;
    align-self: center;
    flex-shrink: 0;
    font-family: var(--font-mono-display, var(--font-mono));
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--ink-2, var(--color-fg));
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 9%, transparent);
    border-radius: 999px;
    padding: 0.12rem 0.5rem;
    cursor: default;
    white-space: nowrap;
  }
  .sp-freq-tip {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 6;
    width: max-content;
    max-width: 210px;
    padding: 0.4rem 0.55rem;
    border-radius: 6px;
    background: var(--ink, var(--color-fg));
    color: var(--paper, var(--color-bg));
    font-family: var(--font-sans, var(--font-serif));
    font-size: 0.72rem;
    font-weight: 400;
    line-height: 1.3;
    text-align: left;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease;
  }
  .sp-freq-badge:hover .sp-freq-tip {
    opacity: 1;
  }
  .sp-roman {
    margin: 0 0 0.85rem;
    font-family: var(--font-mono-display, var(--font-mono));
    font-size: 0.78rem;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .sp-row {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.5rem 0;
    margin: 0;
    border-top: 1px solid var(--rule-2, var(--color-border));
  }
  .sp-row .k {
    width: 92px;
    flex-shrink: 0;
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .sp-row .v {
    flex: 1;
    color: var(--ink, var(--color-fg));
    font-size: 0.85rem;
  }
  :global(.sp-pos-pill) {
    flex-shrink: 0;
  }
  .sp-feats {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    flex-wrap: wrap;
  }
  .sp-feats-row {
    margin-top: 0.15rem;
  }

  .sp-primary {
    margin: 0.75rem 0 0.6rem;
  }
  .sp-primary-display {
    box-sizing: border-box;
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.6rem 0.75rem;
    background: color-mix(
      in oklch,
      var(--accent, var(--color-accent)) 8%,
      var(--card, var(--color-bg))
    );
    border: 1px solid color-mix(
      in oklch,
      var(--accent, var(--color-accent)) 22%,
      var(--rule, var(--color-border))
    );
    border-radius: 8px;
    color: var(--ink, var(--color-fg));
    font: inherit;
    font-size: 0.95rem;
    line-height: 1.35;
    cursor: text;
  }
  .sp-primary-display:hover {
    border-color: color-mix(
      in oklch,
      var(--accent, var(--color-accent)) 50%,
      var(--rule, var(--color-border))
    );
  }
  .sp-primary-display:focus-visible {
    outline: 2px solid var(--accent, var(--color-accent));
    outline-offset: 1px;
  }
  .sp-primary-display[data-empty='1'] {
    background: transparent;
    border-style: dashed;
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.82rem;
    text-align: center;
  }
  .sp-primary-empty {
    display: inline-block;
  }
  .sp-primary-form textarea {
    /* Match the dashed empty-state button's footprint exactly so
     * clicking "+ Add your translation" swaps the placeholder for
     * an editor of the same size — no jump in height or font.
     * The user can still drag the resize handle if they need more
     * room for a long body. */
    box-sizing: border-box;
    display: block;
    width: 100%;
    padding: 0.6rem 0.75rem;
    font: inherit;
    font-size: 0.82rem;
    line-height: 1.35;
    border: 1px solid color-mix(
      in oklch,
      var(--accent, var(--color-accent)) 35%,
      var(--rule, var(--color-border))
    );
    border-radius: 8px;
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    resize: vertical;
  }
  .sp-primary-form textarea:focus-visible {
    outline: 2px solid var(--accent, var(--color-accent));
    outline-offset: 1px;
  }

  .sp-status {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    margin: 0.6rem 0 0.85rem;
    background: color-mix(
      in oklch,
      var(--ink, var(--color-fg)) 5%,
      transparent
    );
    padding: 3px;
    border-radius: 9px;
  }
  .sp-status button {
    height: 30px;
    border: 0;
    background: transparent;
    border-radius: 7px;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--ink-2, var(--color-fg-muted));
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .sp-status button:hover {
    background: color-mix(
      in oklch,
      var(--ink, var(--color-fg)) 5%,
      transparent
    );
  }
  .sp-status button[data-active='1'] {
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }

  .sp-translate {
    margin: 0.5rem 0;
  }
  .sp-translate-btn {
    padding: 0.3rem 0.7rem;
    font: inherit;
    font-size: 0.8rem;
    color: var(--ink, var(--color-fg));
    background: var(--paper, var(--color-bg));
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 7px;
    cursor: pointer;
  }
  .sp-translate-src {
    margin: 0 0 0.2rem;
    font-size: 0.85rem;
    font-style: italic;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .sp-translate-out {
    margin: 0;
    font-size: 0.92rem;
    color: var(--ink, var(--color-fg));
  }

  .sp-section-h {
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-3, var(--color-fg-muted));
    margin: 1rem 0 0.5rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: 500;
  }

  .translations {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }
  .translations li {
    font-size: 0.88rem;
    line-height: 1.4;
    color: var(--ink, var(--color-fg));
  }
  .def-lang-filter {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin: 0 0 0.5rem;
  }
  .def-lang-chip {
    padding: 0.12rem 0.55rem;
    font: inherit;
    font-size: 0.72rem;
    border-radius: 999px;
    border: 1px solid var(--rule, var(--color-border));
    background: var(--paper, var(--color-bg));
    /* Full foreground in both states so the label stays ≥4.5:1; the
       on/off distinction is carried by the fill, border, and strike. */
    color: var(--ink, var(--color-fg));
    cursor: pointer;
  }
  .def-lang-chip[data-active='1'] {
    border-color: color-mix(
      in oklch,
      var(--accent, var(--color-accent)) 30%,
      var(--rule, var(--color-border))
    );
    background: color-mix(
      in oklch,
      var(--accent, var(--color-accent)) 10%,
      var(--paper, var(--color-bg))
    );
  }
  .def-lang-chip[data-active='0'] {
    text-decoration: line-through;
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 4%, transparent);
  }
  .def-lang-chip:focus-visible {
    outline: 2px solid var(--accent, var(--color-accent));
    outline-offset: 1px;
  }
  .def-lang-badge {
    margin-left: 0.4rem;
    padding: 0.05rem 0.4rem;
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    color: var(--ink-3, var(--color-fg-muted));
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 6%, transparent);
    border-radius: 999px;
  }
  .ext-dict {
    margin-top: 0.75rem;
    border-top: 1px solid var(--rule-2, var(--color-border));
    padding-top: 0.5rem;
  }
  .ext-search {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0.25rem 0 0.4rem;
  }
  .ext-search-input {
    flex: 1;
    min-width: 0;
    padding: 0.3rem 0.55rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 6px;
    background: var(--paper, var(--color-bg));
    color: var(--ink, var(--color-fg));
    font-size: 0.85rem;
  }
  .ext-search-input:focus-visible {
    outline: 2px solid var(--accent, var(--color-accent));
    outline-offset: -1px;
  }
  .ext-search-tag {
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    flex-shrink: 0;
  }
  .ext-suggest {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    z-index: 8;
    margin: 0;
    padding: 0.2rem;
    list-style: none;
    max-height: 220px;
    overflow-y: auto;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 6px;
    background: var(--paper, var(--color-bg));
    box-shadow: 0 6px 20px color-mix(in oklch, var(--ink, #000) 18%, transparent);
  }
  .ext-suggest-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.3rem 0.45rem;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ink, var(--color-fg));
    font-size: 0.85rem;
    cursor: pointer;
  }
  .ext-suggest-item:hover,
  .ext-suggest-item:focus-visible {
    background: color-mix(in oklch, var(--accent, var(--color-accent)) 14%, transparent);
    outline: none;
  }
  .ext-tabs {
    display: flex;
    gap: 0.25rem;
    margin: 0.25rem 0 0.5rem;
  }
  .ext-tab {
    padding: 0.15rem 0.7rem;
    font: inherit;
    font-size: 0.74rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 999px;
    background: var(--paper, var(--color-bg));
    color: var(--ink, var(--color-fg));
    cursor: pointer;
  }
  .ext-tab[data-active='1'] {
    border-color: color-mix(
      in oklch,
      var(--accent, var(--color-accent)) 35%,
      var(--rule, var(--color-border))
    );
    background: color-mix(
      in oklch,
      var(--accent, var(--color-accent)) 14%,
      var(--paper, var(--color-bg))
    );
  }
  .ext-tab:focus-visible {
    outline: 2px solid var(--accent, var(--color-accent));
    outline-offset: 1px;
  }
  .ext-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }
  .ext-row {
    font-size: 0.84rem;
    line-height: 1.45;
  }
  .ext-def {
    color: var(--ink, var(--color-fg));
  }
  .ext-pos {
    font-style: italic;
    font-size: 0.74rem;
    color: var(--ink-3, var(--color-fg-muted));
    margin-right: 0.3rem;
  }
  /* Examples are hidden behind a hover/focus icon to keep the entry compact. */
  .ext-ex {
    position: relative;
    display: inline-flex;
    margin-left: 0.3rem;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    cursor: help;
    vertical-align: baseline;
  }
  .ext-ex-icon {
    font-size: 0.72rem;
    color: var(--ink-3, var(--color-fg-muted));
  }
  .ext-ex-pop {
    display: none;
    position: absolute;
    left: 0;
    top: 1.3em;
    z-index: 5;
    min-width: 12rem;
    max-width: 18rem;
    padding: 0.4rem 0.55rem;
    background: var(--card, var(--color-bg));
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 6px;
    box-shadow: 0 6px 20px color-mix(in oklch, var(--ink, var(--color-fg)) 18%, transparent);
  }
  .ext-ex:hover .ext-ex-pop,
  .ext-ex:focus-within .ext-ex-pop {
    display: grid;
    gap: 0.3rem;
  }
  .ext-ex-item {
    font-size: 0.78rem;
    font-style: italic;
    color: var(--ink-2, var(--color-fg));
  }
  .community-row {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    justify-content: space-between;
  }
  .community-body {
    min-width: 0;
  }
  .report-button {
    margin-left: 0.5rem;
    padding: 0.05rem 0.4rem;
    font: inherit;
    font-size: 0.66rem;
    color: var(--ink-3, var(--color-fg-muted));
    border: 1px solid var(--rule, var(--color-border));
    background: var(--paper, var(--color-bg));
    border-radius: 999px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .report-button:hover {
    color: #b91c1c;
    border-color: #fecaca;
  }
  .reported-badge {
    margin-left: 0.5rem;
    padding: 0.1rem 0.5rem;
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-3, var(--color-fg-muted));
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 6%, transparent);
    border-radius: 999px;
  }
  .report-toast {
    margin: 0.4rem 0 0;
    padding: 0.4rem 0.6rem;
    font-size: 0.78rem;
    color: var(--ink-2, var(--color-fg));
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 4%, transparent);
    border-radius: 6px;
  }
  .vote-controls {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .vote-button {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    border: 1px solid var(--rule, var(--color-border));
    background: var(--paper, var(--color-bg));
    color: var(--ink-3, var(--color-fg-muted));
    cursor: pointer;
    font: inherit;
    line-height: 1;
  }
  .vote-button[data-active='1'] {
    color: var(--ink, var(--color-fg));
    border-color: color-mix(
      in oklch,
      var(--ink, var(--color-fg)) 22%,
      var(--rule, var(--color-border))
    );
    background: color-mix(
      in oklch,
      var(--ink, var(--color-fg)) 7%,
      var(--paper, var(--color-bg))
    );
  }
  .vote-button:disabled {
    opacity: 0.55;
    cursor: wait;
  }
  .vote-score {
    min-width: 1.4rem;
    text-align: center;
    font-family: var(--font-mono-display, var(--font-mono));
    font-size: 0.76rem;
    color: var(--ink-2, var(--color-fg));
  }
  .personal-row {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .personal-body {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.3rem;
  }
  .personal-text {
    flex: 1 1 auto;
    min-width: 0;
  }
  .personal-actions {
    margin-left: auto;
    display: inline-flex;
    gap: 0.3rem;
  }
  .row-action {
    padding: 0.1rem 0.55rem;
    background: transparent;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 999px;
    font: inherit;
    font-size: 0.7rem;
    color: var(--ink-3, var(--color-fg-muted));
    cursor: pointer;
  }
  .row-action:hover:not([disabled]) {
    color: var(--ink, var(--color-fg));
    border-color: color-mix(
      in oklch,
      var(--ink, var(--color-fg)) 22%,
      var(--rule, var(--color-border))
    );
  }
  .row-action.danger:hover:not([disabled]) {
    color: #b91c1c;
    border-color: #fecaca;
  }
  .row-action[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .muted {
    color: var(--ink-3, var(--color-fg-muted));
  }
  .small {
    font-size: 0.75rem;
  }
  .err {
    color: var(--rose, #b03131);
  }

  .add-toggle {
    margin-top: 0.6rem;
    width: 100%;
    padding: 0.5rem 0.7rem;
    background: transparent;
    border: 1px dashed var(--rule, var(--color-border));
    border-radius: 8px;
    color: var(--ink-3, var(--color-fg-muted));
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
    text-align: center;
  }
  .add-toggle:hover {
    border-color: var(--accent, var(--color-accent));
    color: var(--accent-ink, var(--color-accent));
    border-style: solid;
  }
  .add-form {
    margin-top: 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .add-form textarea {
    width: 100%;
    padding: 0.55rem 0.7rem;
    font: inherit;
    font-size: 0.85rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    resize: vertical;
  }
  .add-row {
    display: flex;
    gap: 0.4rem;
  }
  .add-row button {
    flex: 1;
    padding: 0.5rem 0.6rem;
    font: inherit;
    font-size: 0.82rem;
    background: var(--ink, var(--color-fg));
    color: var(--paper, var(--color-bg));
    border: 1px solid var(--ink, var(--color-fg));
    border-radius: 8px;
    cursor: pointer;
    min-height: 36px;
  }
  .add-row button.ghost {
    background: transparent;
    color: var(--ink, var(--color-fg));
    border: 1px solid var(--rule, var(--color-border));
  }
  .add-row button[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .official-row {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .official-body {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.3rem;
  }
  .customize-toggle {
    margin-left: auto;
    padding: 0.1rem 0.55rem;
    background: transparent;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 999px;
    font: inherit;
    font-size: 0.7rem;
    color: var(--ink-3, var(--color-fg-muted));
    cursor: pointer;
  }
  .customize-toggle:hover:not([disabled]) {
    border-color: var(--accent, var(--color-accent));
    color: var(--accent-ink, var(--color-accent));
  }
  .customize-toggle[disabled] {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .customize-form {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.5rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    background: color-mix(
      in oklch,
      var(--ink, var(--color-fg)) 3%,
      transparent
    );
  }
  .customize-form textarea {
    width: 100%;
    padding: 0.45rem 0.6rem;
    font: inherit;
    font-size: 0.85rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 6px;
    background: var(--card, var(--color-bg));
    color: var(--ink, var(--color-fg));
    resize: vertical;
  }

  .fix-toggle {
    margin-top: 0.85rem;
    margin-right: 0.4rem;
    background: transparent;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 999px;
    padding: 0.4rem 0.85rem;
    font: inherit;
    font-size: 0.78rem;
    color: var(--ink-2, var(--color-fg));
    cursor: pointer;
  }
  .fix-toggle:hover {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 5%, transparent);
  }
  .alt-toggle {
    margin-top: 0.85rem;
    background: transparent;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 999px;
    padding: 0.4rem 0.85rem;
    font: inherit;
    font-size: 0.78rem;
    color: var(--ink-3, var(--color-fg-muted));
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }
  .alt-toggle .chev {
    display: inline-block;
    transition: transform 140ms ease;
    font-size: 0.95rem;
    line-height: 0.8;
  }
  .alt-toggle .chev[data-open='1'] {
    transform: rotate(90deg);
  }
  .alt-list {
    list-style: none;
    margin: 0.6rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .alt {
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 8px;
    padding: 0.55rem 0.7rem;
    background: var(--card, var(--color-bg));
  }
  .alt-head {
    display: flex;
    align-items: baseline;
    gap: 0.55rem;
    margin-bottom: 0.2rem;
  }
  .alt-h {
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1.05rem;
    color: var(--ink, var(--color-fg));
  }
  :global(.alt-pos-pill) {
    flex-shrink: 0;
  }
  .alt-gloss {
    margin: 0 0 0.45rem;
    font-size: 0.82rem;
    color: var(--ink-2, var(--color-fg));
    line-height: 1.35;
  }
  .alt-pick {
    background: var(--accent, var(--color-accent));
    color: var(--accent-ink, var(--color-bg));
    border: 0;
    border-radius: 6px;
    padding: 0.35rem 0.7rem;
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .alt-pick:disabled {
    opacity: 0.6;
    cursor: progress;
  }

  /* T-2.8: number-only token block. */
  .num-title {
    display: flex;
    align-items: baseline;
    gap: 0.65rem;
  }
  .num-native {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.62em;
  }
  .num-block {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    margin-top: 0.75rem;
    padding-top: 0.7rem;
    border-bottom: 1px solid var(--rule-2, var(--color-border));
    border-top: 1px solid var(--rule-2, var(--color-border));
    padding-bottom: 0.75rem;
  }
  .num-entry {
    display: grid;
    grid-template-columns: 4.5rem 1fr;
    grid-template-rows: auto auto;
    column-gap: 0.65rem;
    row-gap: 0.1rem;
    align-items: baseline;
  }
  .num-lang {
    grid-column: 1;
    grid-row: 1 / span 2;
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-3, var(--color-fg-muted));
    align-self: center;
  }
  .num-spelled {
    grid-column: 2;
    grid-row: 1;
    font-family: var(--font-serif-dev, var(--font-serif));
    font-size: 1rem;
    color: var(--ink, var(--color-fg));
  }
  .num-roman {
    grid-column: 2;
    grid-row: 2;
    font-family: var(--font-mono-display, var(--font-mono));
    font-size: 0.78rem;
    color: var(--ink-3, var(--color-fg-muted));
  }
</style>
