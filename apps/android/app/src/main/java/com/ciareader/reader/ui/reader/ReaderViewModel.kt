package com.ciareader.reader.ui.reader

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.data.auth.AuthRepository
import com.ciareader.reader.core.settings.ReadingTimeStore
import com.ciareader.reader.core.settings.SettingsStore
import com.ciareader.reader.data.collection.CollectionRepository
import com.ciareader.reader.data.dictionary.BasqueReference
import com.ciareader.reader.data.dictionary.DictionaryRepository
import com.ciareader.reader.data.dictionary.LemmaTranslations
import com.ciareader.reader.data.dictionary.WordTranslation
import com.ciareader.reader.data.reader.KnownStatus
import com.ciareader.reader.data.reader.ReaderRepository
import com.ciareader.reader.data.reader.ReaderToken
import com.ciareader.reader.data.reader.SentenceTranslation
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** A chapter entry for the table-of-contents sheet. */
data class ReaderChapterRef(
    val title: String,
    val textId: String?,   // a separate chapter-text within a book (collection)
    val chapterIdx: Int?,  // a chapter within this text
    val isCurrent: Boolean,
    val wordCount: Int = 0,
)

/** Whether a PDF page's render data is still loading, ready to draw, or failed. */
enum class PageLoad { LOADING, READY, ERROR }

/** One PDF page's render data for the page-flip image reader, keyed by chapter
 *  index in [ReaderUiState.pageCache]. A [READY][PageLoad.READY] page with a
 *  non-null [imageUrl] draws immediately; empty [tokens] on a ready page is a
 *  legitimately blank page (image with no tappable words), not a load failure. */
data class ReaderImagePage(
    val load: PageLoad,
    val imageUrl: String? = null,
    val width: Int? = null,
    val height: Int? = null,
    val tokens: List<ReaderToken> = emptyList(),
    val chapterId: String? = null,
)

private const val PROCESSING_POLL_MS = 3_000L
private const val MAX_PROCESSING_POLLS = 40 // ~2 min of auto-retry before pausing

data class ReaderUiState(
    val isLoading: Boolean = true,
    /** The chapter loaded but isn't tokenized yet (freshly imported / processing);
     *  the reader shows a "preparing" state and polls until words are ready. */
    val isProcessing: Boolean = false,
    val title: String = "",
    val chapterCount: Int = 1,
    val chapterIdx: Int = 0,
    val tokens: List<ReaderToken> = emptyList(),
    val selectedWord: ReaderToken? = null,
    /** Book-wide occurrence count of the selected word, shown as an "N×" badge in
     *  the word sheet. Null until it loads (or if the best-effort fetch fails). */
    val wordFrequency: Int? = null,
    val wordTranslations: LemmaTranslations? = null,
    val basqueReference: List<BasqueReference> = emptyList(),
    val basqueRefSource: String? = null,
    /** Admin-confirmed: a reference lookup succeeded (even with no entries), so the
     *  panel — and its search box — stays available to recover OOV/inflected
     *  surface forms the auto-lookup missed. Non-admins (403) never see it. Sticky
     *  across word taps once true, since admin status doesn't change mid-session. */
    val basqueRefAvailable: Boolean = false,
    /** Current text in the reference search box. */
    val basqueRefSearch: String = "",
    /** The word the box was prefilled with — the parsed lemma (e.g. "hamar") once it
     *  loads, else the tapped surface. Baseline for the reset (X) and the reset target. */
    val basqueRefPrefill: String = "",
    /** Elhuyar autocomplete suggestions for the current search term. */
    val basqueRefSuggestions: List<String> = emptyList(),
    /** A reference auto-lookup or manual search is in flight. */
    val isBasqueRefLoading: Boolean = false,
    val isWordLoading: Boolean = false,
    /** Sentence translation for the selected word (word sheet action). */
    val sentenceTranslation: SentenceTranslation? = null,
    val isSentenceTranslating: Boolean = false,
    val sentenceTranslateError: String? = null,
    /** Expand the translation by default — true right after an explicit translate,
     *  false on recall (so reopening words in a translated sentence stays compact). */
    val autoExpandSentence: Boolean = false,
    /** Which parse (lemma) the word sheet is currently showing a definition for.
     *  Defaults to the tapped token's chosen lemma; the parse switcher flips it
     *  among the token's alternate candidates. Null when the word has no
     *  linkable lemma. */
    val activeParseLemmaId: String? = null,
    /** Headword/POS of the token's chosen (primary) parse, captured when its
     *  translations load. Kept in state so the first switcher chip keeps a
     *  stable label after the reader flips to an alternate parse — whose
     *  translations then occupy [wordTranslations]. */
    val primaryHeadword: String? = null,
    val primaryPos: String? = null,
    val restoreTokenIdx: Int? = null,
    val romanize: Boolean = false,
    val isRtl: Boolean = false,
    val pageMode: Boolean = false,
    /** PDF (image) chapters: the page image (relative URL) + its pixel size for
     *  the image reader's tappable overlay; null for text-source chapters. */
    val pageImageUrl: String? = null,
    val pageWidth: Int? = null,
    val pageHeight: Int? = null,
    /** PDF image reader: per-page render data (image + overlay tokens) keyed by
     *  chapter index, so the page-flip pager can show neighbouring pages sliding
     *  in as you swipe. Populated lazily as pages come into view or are
     *  prefetched; the page currently on screen also lives in the fields above. */
    val pageCache: Map<Int, ReaderImagePage> = emptyMap(),
    /** Toggle between the page-image view and the reflowable OCR-text view for an
     *  image chapter. Defaults to the image; ignored when there's no page image. */
    val imageView: Boolean = true,
    val prevTextId: String? = null,
    val nextTextId: String? = null,
    val prevTitle: String? = null,
    val nextTitle: String? = null,
    val chapters: List<ReaderChapterRef> = emptyList(),
    val fontSize: Int = SettingsStore.DEFAULT_FONT_SIZE_SP,
    val lineSpacing: Float = SettingsStore.DEFAULT_LINE_SPACING,
    val progress: Float = 0f,
    /** The viewer is an admin — unlocks the word sheet's "Hide translation"
     *  moderation action on community/official dictionary entries. */
    val isAdmin: Boolean = false,
    val errorMessage: String? = null,
) {
    val hasPrev: Boolean get() = chapterIdx > 0
    val hasNext: Boolean get() = chapterIdx < chapterCount - 1

    /** Can move back/forward — within this text's chapters, or to a sibling
     *  chapter-text when reading a book (collection). */
    val canGoPrev: Boolean get() = hasPrev || prevTextId != null
    val canGoNext: Boolean get() = hasNext || nextTextId != null

    /** Progress through the whole book — chapters before the current one count
     *  fully, plus the within-chapter fraction — weighted by chapter word counts
     *  when known, else evenly. Falls back to the chapter fraction for a
     *  standalone text with no chapter list. */
    val bookProgress: Float
        get() {
            if (chapters.isEmpty()) return progress
            val idx = chapters.indexOfFirst { it.isCurrent }.coerceAtLeast(0)
            val weights = chapters.map { it.wordCount.coerceAtLeast(0) }
            val total = weights.sum()
            return if (total > 0) {
                val before = weights.take(idx).sum()
                ((before + progress * weights[idx]) / total).coerceIn(0f, 1f)
            } else {
                ((idx + progress) / chapters.size).coerceIn(0f, 1f)
            }
        }
}

@HiltViewModel
class ReaderViewModel @Inject constructor(
    private val repository: ReaderRepository,
    private val dictionary: DictionaryRepository,
    private val settings: SettingsStore,
    private val collections: CollectionRepository,
    private val readingTime: ReadingTimeStore,
    private val auth: AuthRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    /** Wall clock, overridable in tests. Reading time is wall-clock delta
     *  between the screen becoming visible and being hidden. */
    internal var clock: () -> Long = { System.currentTimeMillis() }

    // When non-null the reader is on-screen; the value is the wall-clock
    // millis at which it became visible. Flushed to [readingTime] on hide.
    private var readingStartedAtMs: Long? = null

    private val textId: String =
        checkNotNull(savedStateHandle.get<String>("textId")) { "reader requires a textId arg" }
    private val collectionId: String? = savedStateHandle.get<String>("collectionId")
    private val openAtEnd: Boolean = savedStateHandle.get<Boolean>("atEnd") ?: false
    private val resumeSavedPosition: Boolean = savedStateHandle.get<Boolean>("resume") ?: true

    private val _state = MutableStateFlow(ReaderUiState())
    val state: StateFlow<ReaderUiState> = _state.asStateFlow()

    /** One-shot, user-facing messages (surfaced as a toast) for operations that
     *  don't have their own error slot in the UI state — mainly definition
     *  save/edit/delete failures, which are otherwise silent. Buffered so a
     *  message emitted while the screen is momentarily not collecting isn't lost. */
    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val messages: SharedFlow<String> = _messages.asSharedFlow()

    private var progressJob: Job? = null
    private var pollJob: Job? = null
    private var currentTopToken = 0

    // The loaded chapter's server id (UUID), needed for sentence translation.
    private var currentChapterId: String? = null

    // This text's language, so reading prefs are read/written per-language.
    private var language: String = ""

    // Admin-only Basque reference lookups; after one denial (non-admin) we stop asking.
    private var basqueRefDisabled = false

    // Debounces the reference search box's autocomplete so a new keystroke cancels
    // the prior in-flight suggestion fetch.
    private var basqueAutocompleteJob: Job? = null

    init {
        loadInitial()
        fetchViewerRole()
    }

    /** Best-effort: learn whether the viewer is an admin so the word sheet can
     *  offer the "Hide bad translation" moderation action. Failure (offline,
     *  non-admin, or unauthenticated) leaves [ReaderUiState.isAdmin] false. */
    private fun fetchViewerRole() {
        viewModelScope.launch {
            val role = auth.currentRole()
            if (role == "admin") _state.update { it.copy(isAdmin = true) }
        }
    }

    private fun loadInitial() {
        _state.update { it.copy(isLoading = true, errorMessage = null) }
        viewModelScope.launch {
            when (val meta = repository.textMeta(textId)) {
                is Outcome.Failure ->
                    _state.update { it.copy(isLoading = false, errorMessage = meta.message) }

                is Outcome.Success -> {
                    language = meta.data.language
                    val chapterCount = meta.data.chapterCount.coerceAtLeast(1)
                    _state.update {
                        it.copy(
                            title = meta.data.title,
                            chapterCount = chapterCount,
                            romanize = settings.showRomanization(language),
                            pageMode = settings.pageMode(language),
                            fontSize = settings.fontSizeSp(language),
                            lineSpacing = settings.lineSpacing(language),
                            isRtl = isRtlLanguage(language),
                            basqueRefSource = settings.basqueRefSource(),
                        )
                    }
                    loadSiblings()
                    // Resume where the reader left off (chapter clamped to range);
                    // restore the token only within that saved chapter.
                    val saved = if (resumeSavedPosition) {
                        when (val p = repository.progress(textId)) {
                            is Outcome.Success -> p.data
                            is Outcome.Failure -> null
                        }
                    } else {
                        null
                    }
                    val startChapter = (saved?.chapterIdx ?: 0).coerceIn(0, chapterCount - 1)
                    // Going back to a chapter opens it at the end; otherwise resume.
                    val restoreToken =
                        if (openAtEnd) null else saved?.takeIf { it.chapterIdx == startChapter }?.tokenIdx
                    // For a multi-chapter single text, the TOC lists its own chapters.
                    if (collectionId == null && chapterCount > 1) {
                        _state.update { s ->
                            s.copy(
                                chapters = meta.data.chapters.map { c ->
                                    ReaderChapterRef(
                                        c.title,
                                        textId = null,
                                        chapterIdx = c.idx,
                                        isCurrent = c.idx == startChapter,
                                        wordCount = c.tokenCount,
                                    )
                                },
                            )
                        }
                    }
                    loadChapter(
                        startChapter,
                        restoreToken,
                        atEnd = openAtEnd,
                        saveOnLoad = !resumeSavedPosition || openAtEnd,
                    )
                }
            }
        }
    }

    fun loadChapter(
        chapterIdx: Int,
        restoreTokenIdx: Int? = null,
        atEnd: Boolean = false,
        saveOnLoad: Boolean = false,
    ) {
        progressJob?.cancel()
        pollJob?.cancel()
        _state.update {
            it.copy(
                isLoading = true,
                isProcessing = false,
                errorMessage = null,
                pageImageUrl = null,
                pageWidth = null,
                pageHeight = null,
                selectedWord = null,
                wordFrequency = null,
                wordTranslations = null,
                sentenceTranslation = null,
                isSentenceTranslating = false,
                sentenceTranslateError = null,
                autoExpandSentence = false,
                activeParseLemmaId = null,
                primaryHeadword = null,
                primaryPos = null,
            )
        }
        pollJob = viewModelScope.launch {
            fetchChapter(chapterIdx, restoreTokenIdx, atEnd, saveOnLoad, attempt = 0)
        }
    }

    /** Flip between the page-image view and the OCR-text view (image chapters). */
    fun toggleImageView() = _state.update { it.copy(imageView = !it.imageView) }

    /**
     * Load a chapter's tokens. A just-imported chapter comes back with no tokens
     * (the NLP worker hasn't run yet); surface a "processing" state and poll until
     * the tokens land or we hit [MAX_PROCESSING_POLLS], so opening chapter 1 of a
     * fresh import resolves to readable text on its own.
     */
    private suspend fun fetchChapter(
        chapterIdx: Int,
        restoreTokenIdx: Int?,
        atEnd: Boolean,
        saveOnLoad: Boolean,
        attempt: Int,
    ) {
        when (val chapter = repository.chapter(textId, chapterIdx)) {
            is Outcome.Success -> {
                currentChapterId = chapter.data.chapterId
                // A chapter with no tokens is normally still being tokenized (the
                // NLP worker hasn't run). A PDF page is the exception: it carries
                // its image the moment it's rasterized, and a blank / image-only
                // page legitimately has zero words — its tokens stay empty forever.
                // So only keep polling when there's no page image to show yet;
                // otherwise fall through and render the page (with no overlay).
                if (chapter.data.tokens.isEmpty() && chapter.data.pageImageUrl == null) {
                    // Not tokenized yet — show the preparing state and keep polling.
                    _state.update {
                        it.copy(isLoading = false, isProcessing = true, chapterIdx = chapterIdx)
                    }
                    if (attempt < MAX_PROCESSING_POLLS) {
                        delay(PROCESSING_POLL_MS)
                        fetchChapter(chapterIdx, restoreTokenIdx, atEnd, saveOnLoad, attempt + 1)
                    }
                    // Past the cap we stop auto-retrying but keep the preparing UI;
                    // re-entering the chapter restarts the poll.
                    return
                }
                val anchor =
                    if (atEnd) chapter.data.tokens.lastIndex.coerceAtLeast(0) else restoreTokenIdx
                _state.update {
                    it.copy(
                        isLoading = false,
                        isProcessing = false,
                        chapterIdx = chapterIdx,
                        tokens = chapter.data.tokens,
                        pageImageUrl = chapter.data.pageImageUrl,
                        pageWidth = chapter.data.pageWidth,
                        pageHeight = chapter.data.pageHeight,
                        restoreTokenIdx = anchor,
                        chapters = it.chapters.map { ref ->
                            if (ref.chapterIdx != null) ref.copy(isCurrent = ref.chapterIdx == chapterIdx) else ref
                        },
                    )
                }
                if (saveOnLoad) {
                    val tokenIdx = anchor ?: 0
                    val pctRead = if (atEnd) 100.0 else 0.0
                    repository.saveProgress(textId, chapterIdx, tokenIdx, pctRead)
                }
                // Image (PDF) chapter: seed the page-flip cache with this page and
                // prefetch its neighbours so the first swipe animates in a ready page.
                if (chapter.data.pageImageUrl != null) {
                    val page = ReaderImagePage(
                        load = PageLoad.READY,
                        imageUrl = chapter.data.pageImageUrl,
                        width = chapter.data.pageWidth,
                        height = chapter.data.pageHeight,
                        tokens = chapter.data.tokens,
                        chapterId = chapter.data.chapterId,
                    )
                    _state.update { it.copy(pageCache = it.pageCache + (chapterIdx to page)) }
                    ensureImagePage(chapterIdx - 1)
                    ensureImagePage(chapterIdx + 1)
                }
            }

            is Outcome.Failure ->
                _state.update {
                    it.copy(isLoading = false, isProcessing = false, errorMessage = chapter.message)
                }
        }
    }

    fun onWordTap(token: ReaderToken) {
        if (!token.isWord) return
        val lemmaId = token.lemmaId
        // Auto-look-up the tapped surface in the reference dictionaries (admins only);
        // the panel then shows a spinner until it resolves.
        val loadingRef = language == "eu" && !basqueRefDisabled
        basqueAutocompleteJob?.cancel()
        _state.update {
            it.copy(
                selectedWord = token,
                wordFrequency = null,
                wordTranslations = null,
                basqueReference = emptyList(),
                // Prefill the search box with the tapped word so it's obviously a
                // search for it; the user can edit to refine. The surface is just a
                // placeholder — loadParse upgrades it to the parsed lemma once known.
                // [basqueRefAvailable] stays sticky across taps.
                basqueRefSearch = if (loadingRef) token.surface else "",
                basqueRefPrefill = if (loadingRef) token.surface else "",
                basqueRefSuggestions = emptyList(),
                isBasqueRefLoading = loadingRef,
                isWordLoading = lemmaId != null,
                // Each word opens with a fresh sentence-translation slot.
                sentenceTranslation = null,
                isSentenceTranslating = false,
                sentenceTranslateError = null,
                autoExpandSentence = false,
                activeParseLemmaId = lemmaId,
                primaryHeadword = null,
                primaryPos = null,
            )
        }
        // Recall an already-saved translation for this word's sentence (cache-only,
        // no model spend), so reopening any word in a translated sentence shows it.
        val chapterId = currentChapterId
        if (chapterId != null) {
            viewModelScope.launch {
                val recalled = repository.cachedSentenceTranslation(chapterId, token.idx, language)
                if (recalled is Outcome.Success) {
                    _state.update { s ->
                        // Only apply if still on this word and nothing's shown yet
                        // (don't clobber a fresh manual translation).
                        if (s.selectedWord == token && s.sentenceTranslation == null) {
                            s.copy(sentenceTranslation = recalled.data)
                        } else {
                            s
                        }
                    }
                }
            }
        }
        // Admin-only Basque reference dictionaries. The endpoint 403s non-admins,
        // after which we stop asking for the session; a success — even with no entries
        // — confirms admin, keeping the panel (and its search box) available.
        // Words with a lemma defer to loadParse so the lookup uses the parsed form
        // ("orduak" → "ordu") instead of the inflected surface; OOV words have no
        // lemma, so look the surface up here.
        if (loadingRef && token.lemmaId == null) {
            viewModelScope.launch {
                when (val ref = dictionary.basqueReference(token.surface)) {
                    is Outcome.Success -> _state.update { s ->
                        if (s.selectedWord == token) {
                            s.copy(
                                basqueReference = ref.data,
                                basqueRefAvailable = true,
                                isBasqueRefLoading = false,
                            )
                        } else {
                            s
                        }
                    }
                    is Outcome.Failure -> {
                        basqueRefDisabled = true
                        _state.update { it.copy(basqueRefAvailable = false, isBasqueRefLoading = false) }
                    }
                }
            }
        }
        // Book-wide frequency badge — best-effort, non-blocking (web parity).
        if (lemmaId != null) {
            viewModelScope.launch {
                val freq = repository.lemmaFrequency(textId, lemmaId)
                if (freq != null) {
                    _state.update { s ->
                        if (s.selectedWord == token) s.copy(wordFrequency = freq) else s
                    }
                }
            }
        }
        if (lemmaId == null) return
        loadParse(lemmaId, isPrimary = true)
    }

    /** Switch the word sheet to a different parse of the selected word and load
     *  that lemma's definition. The parse switcher (shown for ambiguous tokens)
     *  drives this. No-op when nothing is selected or it's already the active
     *  parse. */
    fun selectParse(lemmaId: String) {
        val current = _state.value
        if (current.selectedWord == null || current.activeParseLemmaId == lemmaId) return
        _state.update { it.copy(activeParseLemmaId = lemmaId, wordTranslations = null, isWordLoading = true) }
        loadParse(lemmaId, isPrimary = lemmaId == current.selectedWord.lemmaId)
    }

    /** Fetch a lemma's translations into the word sheet, ignoring the result if
     *  the user has since tapped another word or flipped to another parse. When
     *  the parser's chosen lemma loads, its headword/POS are cached so the
     *  primary switcher chip stays labelled after the reader views an
     *  alternate. */
    private fun loadParse(lemmaId: String, isPrimary: Boolean) {
        viewModelScope.launch {
            val outcome = dictionary.translations(lemmaId)
            var refLookupWord: String? = null
            _state.update { s ->
                if (s.activeParseLemmaId != lemmaId) return@update s
                when (outcome) {
                    is Outcome.Success -> {
                        // Drive the reference search + lookup off the parsed lemma
                        // ("hamarrak" → "hamar"), not the inflected surface — but only
                        // while the box is the untouched prefill, so a manual search is
                        // never clobbered.
                        val headword = outcome.data.headword
                        val useLemma = isPrimary && language == "eu" && !basqueRefDisabled &&
                            headword.isNotBlank() && s.basqueRefSearch == s.basqueRefPrefill
                        if (useLemma) refLookupWord = headword
                        s.copy(
                            isWordLoading = false,
                            wordTranslations = outcome.data,
                            primaryHeadword = if (isPrimary) headword else s.primaryHeadword,
                            primaryPos = if (isPrimary) outcome.data.pos else s.primaryPos,
                            basqueRefSearch = if (useLemma) headword else s.basqueRefSearch,
                            basqueRefPrefill = if (useLemma) headword else s.basqueRefPrefill,
                            // Keep the spinner up only while the lemma lookup is pending.
                            isBasqueRefLoading = refLookupWord != null,
                        )
                    }
                    is Outcome.Failure -> s.copy(isWordLoading = false, isBasqueRefLoading = false)
                }
            }
            // Look up the reference entries by the parsed lemma so they match the box.
            val word = refLookupWord
            if (word != null) {
                when (val ref = dictionary.basqueReference(word)) {
                    is Outcome.Success -> _state.update { s ->
                        if (s.activeParseLemmaId == lemmaId) {
                            s.copy(basqueReference = ref.data, basqueRefAvailable = true, isBasqueRefLoading = false)
                        } else {
                            s
                        }
                    }
                    is Outcome.Failure -> {
                        basqueRefDisabled = true
                        _state.update { it.copy(basqueRefAvailable = false, isBasqueRefLoading = false) }
                    }
                }
            }
        }
    }

    /** Save the viewer's own definition for the active parse, then refresh the
     *  panel so it appears under "Your notes". */
    fun addDefinition(text: String, isPrivate: Boolean = false) =
        saveDefinitionFrom(parentId = null, text = text, isPrivate = isPrivate)

    /** Save a dictionary entry the user edited as their own definition. [parentId]
     *  is the official/community translation it was forked from (so the server can
     *  track the lineage); null when seeded from the reference dictionary or gloss,
     *  which aren't stored translations. Behaves like [addDefinition] otherwise:
     *  optimistic insert, then reconcile against a fresh fetch. */
    fun saveDefinitionFrom(parentId: String?, text: String, isPrivate: Boolean = false) {
        val body = text.trim()
        if (body.isEmpty()) return
        val lemmaId = _state.value.activeParseLemmaId ?: return
        // Show it immediately — we already have the text (id stays null until the
        // server refresh assigns the real one).
        _state.update { s ->
            val lt = s.wordTranslations ?: LemmaTranslations(
                headword = s.selectedWord?.surface ?: "",
                pos = null,
                gloss = null,
                personal = emptyList(),
                official = emptyList(),
                community = emptyList(),
            )
            s.copy(
                wordTranslations = lt.copy(
                    personal = lt.personal + WordTranslation(body, null, isPrivate = isPrivate),
                ),
            )
        }
        viewModelScope.launch {
            val outcome = dictionary.addDefinition(lemmaId, body, parentId, isPrivate)
            if (outcome is Outcome.Failure) _messages.tryEmit("Couldn't save definition: ${outcome.message}")
            // Reconcile either way: on success this assigns the real id; on failure
            // it drops the optimistic entry (if the fetch succeeds) so the panel
            // doesn't keep showing a note the server never stored.
            refreshSelectedTranslations()
        }
    }

    /** Edit one of the viewer's own notes — reflected immediately, then reconciled.
     *  [isPrivate] non-null also toggles the note's private flag. */
    fun editDefinition(translationId: String, text: String, isPrivate: Boolean? = null) {
        val body = text.trim()
        if (body.isEmpty()) return
        _state.update { s ->
            val lt = s.wordTranslations ?: return@update s
            s.copy(
                wordTranslations = lt.copy(
                    personal = lt.personal.map {
                        if (it.id == translationId) {
                            it.copy(body = body, isPrivate = isPrivate ?: it.isPrivate)
                        } else {
                            it
                        }
                    },
                ),
            )
        }
        viewModelScope.launch {
            val outcome = dictionary.editDefinition(translationId, body, isPrivate)
            if (outcome is Outcome.Failure) _messages.tryEmit("Couldn't save edit: ${outcome.message}")
            refreshSelectedTranslations()
        }
    }

    /** Delete one of the viewer's own notes — removed immediately, then reconciled. */
    fun deleteDefinition(translationId: String) {
        _state.update { s ->
            val lt = s.wordTranslations ?: return@update s
            s.copy(wordTranslations = lt.copy(personal = lt.personal.filterNot { it.id == translationId }))
        }
        viewModelScope.launch {
            val outcome = dictionary.deleteDefinition(translationId)
            if (outcome is Outcome.Failure) _messages.tryEmit("Couldn't delete definition: ${outcome.message}")
            refreshSelectedTranslations()
        }
    }

    /** Admin moderation: hide (or unhide) a bad community/official dictionary
     *  entry. Reflected immediately (the row goes struck-through), then
     *  reconciled — admins keep seeing hidden rows so the action is reversible. */
    fun hideTranslation(translationId: String, hidden: Boolean) {
        _state.update { s ->
            val lt = s.wordTranslations ?: return@update s
            fun List<WordTranslation>.mark() =
                map { if (it.id == translationId) it.copy(hidden = hidden) else it }
            s.copy(
                wordTranslations = lt.copy(official = lt.official.mark(), community = lt.community.mark()),
            )
        }
        viewModelScope.launch {
            val reason = if (hidden) "Hidden from reader" else "Unhidden from reader"
            val outcome = dictionary.hideTranslation(translationId, hidden, reason)
            if (outcome is Outcome.Failure) {
                val verb = if (hidden) "hide" else "unhide"
                _messages.tryEmit("Couldn't $verb translation: ${outcome.message}")
            }
            refreshSelectedTranslations()
        }
    }

    /** Reconcile the shown definitions with the server — a forced fetch, not the
     *  cache (which is stale right after an add/edit/delete). */
    private suspend fun refreshSelectedTranslations() {
        val lemmaId = _state.value.activeParseLemmaId ?: return
        val refreshed = dictionary.refreshTranslations(lemmaId)
        if (refreshed is Outcome.Success) {
            _state.update { s ->
                if (s.activeParseLemmaId == lemmaId) s.copy(wordTranslations = refreshed.data) else s
            }
        }
    }

    /** Pull the latest definitions/community suggestions for the active parse. */
    fun refreshSelectedWord() {
        val lemmaId = _state.value.activeParseLemmaId ?: return
        _state.update { it.copy(isWordLoading = true) }
        viewModelScope.launch {
            val o = dictionary.refreshTranslations(lemmaId)
            _state.update { s ->
                if (s.activeParseLemmaId != lemmaId) return@update s
                when (o) {
                    is Outcome.Success -> s.copy(isWordLoading = false, wordTranslations = o.data)
                    is Outcome.Failure -> s.copy(isWordLoading = false)
                }
            }
        }
    }

    /** Apply [target] to the selected word, toggling it off (back to "new"/UNKNOWN)
     *  when the word already has that status. Reads the live status, so repeated
     *  toggles within one open word sheet work without reopening it. */
    fun toggleStatus(target: KnownStatus) {
        val current = _state.value.selectedWord?.status ?: return
        setStatus(if (current == target) KnownStatus.UNKNOWN else target)
    }

    /** Persist a status for the selected word's lemma and recolor every
     *  occurrence of that lemma in the current chapter. */
    fun setStatus(status: KnownStatus) {
        val lemmaId = _state.value.selectedWord?.lemmaId ?: return
        // Recolor optimistically so the popup can close immediately without
        // waiting on the network. Remember the prior status to roll back on
        // failure. (The popup may already be dismissed by the time the network
        // call returns, so reconcile against tokens rather than selectedWord.)
        val previous = _state.value.tokens.firstOrNull { it.lemmaId == lemmaId }?.status
        _state.update { s -> s.applyStatus(lemmaId, status) }
        viewModelScope.launch {
            when (val res = dictionary.setStatus(lemmaId, status)) {
                // Reconcile with the server-confirmed status (usually identical).
                is Outcome.Success -> _state.update { s -> s.applyStatus(lemmaId, res.data) }
                // Roll back the optimistic change; user can retry.
                is Outcome.Failure -> if (previous != null) {
                    _state.update { s -> s.applyStatus(lemmaId, previous) }
                }
            }
        }
    }

    /** Recolor every occurrence of [lemmaId] in the current chapter to [status],
     *  keeping the selected word (if it shares the lemma) in sync. */
    private fun ReaderUiState.applyStatus(lemmaId: String, status: KnownStatus) = copy(
        tokens = tokens.map { if (it.lemmaId == lemmaId) it.copy(status = status) else it },
        selectedWord = selectedWord?.let {
            if (it.lemmaId == lemmaId) it.copy(status = status) else it
        },
    )

    /** Translate the sentence the selected word sits in, via the server (which
     *  reconstructs + caches it). No-op without a chapter id or selection. */
    fun translateSentence() {
        val token = _state.value.selectedWord ?: return
        val chapterId = currentChapterId ?: return
        // Don't re-fetch if we already have it or a request is in flight.
        if (_state.value.sentenceTranslation != null || _state.value.isSentenceTranslating) return
        _state.update { it.copy(isSentenceTranslating = true, sentenceTranslateError = null) }
        viewModelScope.launch {
            val outcome = repository.translateSentence(chapterId, token.idx, language)
            _state.update { s ->
                // Drop the result if the user has moved to a different word.
                if (s.selectedWord != token) return@update s
                when (outcome) {
                    is Outcome.Success ->
                        s.copy(isSentenceTranslating = false, sentenceTranslation = outcome.data, autoExpandSentence = true)
                    is Outcome.Failure ->
                        s.copy(isSentenceTranslating = false, sentenceTranslateError = outcome.message)
                }
            }
        }
    }

    fun dismissWord() = _state.update {
        it.copy(
            selectedWord = null,
            wordFrequency = null,
            wordTranslations = null,
            isWordLoading = false,
            sentenceTranslation = null,
            isSentenceTranslating = false,
            sentenceTranslateError = null,
            autoExpandSentence = false,
            activeParseLemmaId = null,
            primaryHeadword = null,
            primaryPos = null,
        )
    }

    fun nextChapter() {
        if (_state.value.hasNext) loadChapter(_state.value.chapterIdx + 1, saveOnLoad = true)
    }

    fun prevChapter() {
        if (_state.value.hasPrev) loadChapter(_state.value.chapterIdx - 1, saveOnLoad = true)
    }

    /**
     * Load (or prefetch) a PDF page's image + overlay tokens into [pageCache] so
     * the page-flip pager can slide it in. A no-op when the index is out of range
     * or already loaded / in flight; a previously-errored page re-fetches (retry).
     * When the loaded page is the one currently on screen, it's promoted to the
     * live reader state so taps and the OCR-text toggle work.
     */
    fun ensureImagePage(idx: Int) {
        if (idx < 0 || idx >= _state.value.chapterCount) return
        val existing = _state.value.pageCache[idx]
        if (existing != null && existing.load != PageLoad.ERROR) return
        _state.update { it.copy(pageCache = it.pageCache + (idx to ReaderImagePage(PageLoad.LOADING))) }
        viewModelScope.launch {
            val page = when (val ch = repository.chapter(textId, idx)) {
                is Outcome.Success -> ReaderImagePage(
                    load = PageLoad.READY,
                    imageUrl = ch.data.pageImageUrl,
                    width = ch.data.pageWidth,
                    height = ch.data.pageHeight,
                    tokens = ch.data.tokens,
                    chapterId = ch.data.chapterId,
                )
                is Outcome.Failure -> ReaderImagePage(PageLoad.ERROR)
            }
            _state.update { it.copy(pageCache = it.pageCache + (idx to page)) }
            // If the fetched page is the one on screen, make it the live page.
            if (page.load == PageLoad.READY && page.imageUrl != null && _state.value.chapterIdx == idx) {
                promotePage(idx, page, saveOnLoad = false)
            }
        }
    }

    /**
     * The page-flip pager settled on [idx]. When that page is cached and drawable,
     * promote it to the live reader state instantly (no spinner) and prefetch the
     * new neighbours; otherwise fall back to the full [loadChapter] path, which
     * shows the loading / "preparing" UI and polls an unprocessed page.
     */
    fun onImagePageSettled(idx: Int) {
        if (idx == _state.value.chapterIdx) return
        val page = _state.value.pageCache[idx]
        if (page != null && page.load == PageLoad.READY && page.imageUrl != null) {
            promotePage(idx, page, saveOnLoad = true)
            ensureImagePage(idx - 1)
            ensureImagePage(idx + 1)
        } else {
            loadChapter(idx, saveOnLoad = true)
        }
    }

    /** Make a cached PDF page the current one: swap in its image + overlay tokens,
     *  close any open word sheet, mark it current in the TOC, and save the spot. */
    private fun promotePage(idx: Int, page: ReaderImagePage, saveOnLoad: Boolean) {
        currentChapterId = page.chapterId
        currentTopToken = 0
        progressJob?.cancel()
        pollJob?.cancel()
        _state.update {
            it.copy(
                isLoading = false,
                isProcessing = false,
                errorMessage = null,
                chapterIdx = idx,
                tokens = page.tokens,
                pageImageUrl = page.imageUrl,
                pageWidth = page.width,
                pageHeight = page.height,
                restoreTokenIdx = null,
                // Flipping pages closes any open word sheet + its transient state.
                selectedWord = null,
                wordFrequency = null,
                wordTranslations = null,
                sentenceTranslation = null,
                isSentenceTranslating = false,
                sentenceTranslateError = null,
                autoExpandSentence = false,
                activeParseLemmaId = null,
                primaryHeadword = null,
                primaryPos = null,
                chapters = it.chapters.map { ref ->
                    if (ref.chapterIdx != null) ref.copy(isCurrent = ref.chapterIdx == idx) else ref
                },
            )
        }
        if (saveOnLoad) {
            viewModelScope.launch { repository.saveProgress(textId, idx, 0, 0.0) }
        }
    }

    /** Debounced reading-progress write-back as the user scrolls. */
    fun recordPosition(tokenIdx: Int, pctRead: Double) {
        val chapterIdx = _state.value.chapterIdx
        currentTopToken = tokenIdx
        progressJob?.cancel()
        progressJob = viewModelScope.launch {
            delay(PROGRESS_DEBOUNCE_MS)
            repository.saveProgress(textId, chapterIdx, tokenIdx, pctRead)
        }
    }

    /** The UI has scrolled to the restored anchor; don't scroll there again. */
    fun onRestoreConsumed() = _state.update { it.copy(restoreTokenIdx = null) }

    /** Live reading-progress fraction (0..1) for the bottom bar. UI-only. */
    fun setProgress(fraction: Float) = _state.update { it.copy(progress = fraction.coerceIn(0f, 1f)) }

    /** Toggle native ⇄ romanized rendering and remember the choice. */
    fun toggleRomanization() {
        val next = !_state.value.romanize
        _state.update { it.copy(romanize = next) }
        viewModelScope.launch { settings.setShowRomanization(language, next) }
    }

    /** Toggle continuous-scroll ⇄ page mode and remember the choice. */
    fun togglePageMode() {
        val next = !_state.value.pageMode
        _state.update { it.copy(pageMode = next) }
        viewModelScope.launch { settings.setPageMode(language, next) }
    }

    /** Reader body font size in sp, clamped + remembered. */
    fun setFontSize(sp: Int) {
        val v = sp.coerceIn(FONT_SIZE_MIN, FONT_SIZE_MAX)
        // Re-anchor to the current top word so resizing doesn't lose your place.
        _state.update { it.copy(fontSize = v, restoreTokenIdx = currentTopToken) }
        viewModelScope.launch { settings.setFontSizeSp(language, v) }
    }

    /** Reader line-height multiple, clamped + remembered. */
    fun setLineSpacing(value: Float) {
        val v = value.coerceIn(LINE_SPACING_MIN, LINE_SPACING_MAX)
        _state.update { it.copy(lineSpacing = v, restoreTokenIdx = currentTopToken) }
        viewModelScope.launch { settings.setLineSpacing(language, v) }
    }

    /** Remember the admin Basque reference source tab (ES/EN/EU). */
    fun setBasqueRefSource(source: String) {
        _state.update { it.copy(basqueRefSource = source) }
        viewModelScope.launch { settings.setBasqueRefSource(source) }
    }

    /** Update the reference search box and, debounced, fetch Elhuyar suggestions. */
    fun onBasqueRefSearchInput(text: String) {
        _state.update { it.copy(basqueRefSearch = text) }
        basqueAutocompleteJob?.cancel()
        val term = text.trim()
        if (term.isEmpty()) {
            _state.update { it.copy(basqueRefSuggestions = emptyList()) }
            return
        }
        basqueAutocompleteJob = viewModelScope.launch {
            delay(250)
            when (val res = dictionary.basqueReferenceAutocomplete(term)) {
                is Outcome.Success -> _state.update { s ->
                    // Drop stale results if the box has moved on to a newer term.
                    if (s.basqueRefSearch.trim() == term) s.copy(basqueRefSuggestions = res.data) else s
                }
                // Autocomplete is a convenience — a flaky upstream shouldn't error.
                is Outcome.Failure -> Unit
            }
        }
    }

    /** Search the reference dictionaries for an exact term (Enter or suggestion tap)
     *  — the recovery path when the tapped surface form isn't itself an entry. */
    fun searchBasqueReference(term: String) {
        val query = term.trim()
        if (query.isEmpty()) return
        basqueAutocompleteJob?.cancel()
        _state.update {
            it.copy(basqueRefSearch = query, basqueRefSuggestions = emptyList(), isBasqueRefLoading = true)
        }
        viewModelScope.launch {
            when (val ref = dictionary.basqueReference(query, exact = true)) {
                is Outcome.Success ->
                    _state.update { it.copy(basqueReference = ref.data, isBasqueRefLoading = false) }
                // A search shouldn't 403 (admin already confirmed); treat as transient.
                is Outcome.Failure -> _state.update { it.copy(isBasqueRefLoading = false) }
            }
        }
    }

    /** When reading a book, find the adjacent chapter-texts for Prev/Next. */
    private suspend fun loadSiblings() {
        val cid = collectionId ?: return
        when (val detail = collections.detail(cid)) {
            is Outcome.Success -> {
                val chapters = detail.data.chapters
                val idx = chapters.indexOfFirst { it.textId == textId }
                val refs = chapters.map {
                    ReaderChapterRef(
                        it.title,
                        textId = it.textId,
                        chapterIdx = null,
                        isCurrent = it.textId == textId,
                        wordCount = it.wordCount,
                    )
                }
                val prev = if (idx >= 0) chapters.getOrNull(idx - 1) else null
                val next = if (idx >= 0) chapters.getOrNull(idx + 1) else null
                _state.update {
                    it.copy(
                        chapters = refs,
                        prevTextId = prev?.textId,
                        nextTextId = next?.textId,
                        prevTitle = prev?.title,
                        nextTitle = next?.title,
                    )
                }
            }

            is Outcome.Failure -> Unit // non-fatal: just no cross-chapter nav
        }
    }

    fun retry() {
        if (_state.value.title.isEmpty()) loadInitial() else loadChapter(_state.value.chapterIdx)
    }

    /**
     * The reader became visible (ON_START). Begins accruing reading time.
     * Idempotent — a second call without an intervening [onScreenHidden]
     * is ignored, so it's safe to attach to a lifecycle observer.
     */
    fun onScreenVisible() {
        if (readingStartedAtMs == null) readingStartedAtMs = clock()
    }

    /**
     * The reader was hidden/backgrounded (ON_STOP). Flushes the elapsed
     * foreground duration to [readingTime] under this text's language.
     * Reading time is LOCAL-ONLY (no server sync).
     */
    fun onScreenHidden() {
        val startedAt = readingStartedAtMs ?: return
        readingStartedAtMs = null
        val elapsed = clock() - startedAt
        if (elapsed <= 0L) return
        val lang = language
        if (lang.isEmpty()) return
        viewModelScope.launch { readingTime.addReadingTime(lang, elapsed) }
    }

    override fun onCleared() {
        // Flush any in-progress session if the screen leaves without an
        // explicit ON_STOP (e.g. the VM is cleared on back-navigation).
        onScreenHidden()
        super.onCleared()
    }

    private companion object {
        const val PROGRESS_DEBOUNCE_MS = 800L
        const val FONT_SIZE_MIN = 14
        const val FONT_SIZE_MAX = 28
        const val LINE_SPACING_MIN = 1.2f
        const val LINE_SPACING_MAX = 2.2f
        private val RTL_LANGUAGES = setOf("yi", "ur", "fa", "ar", "he", "sd")
        fun isRtlLanguage(code: String) = code.lowercase() in RTL_LANGUAGES
    }
}
