package com.ciareader.reader.ui.reader

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.core.settings.SettingsStore
import com.ciareader.reader.data.collection.CollectionRepository
import com.ciareader.reader.data.dictionary.BasqueReference
import com.ciareader.reader.data.dictionary.DictionaryRepository
import com.ciareader.reader.data.dictionary.LemmaTranslations
import com.ciareader.reader.data.reader.KnownStatus
import com.ciareader.reader.data.reader.ReaderRepository
import com.ciareader.reader.data.reader.ReaderToken
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
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

data class ReaderUiState(
    val isLoading: Boolean = true,
    val title: String = "",
    val chapterCount: Int = 1,
    val chapterIdx: Int = 0,
    val tokens: List<ReaderToken> = emptyList(),
    val selectedWord: ReaderToken? = null,
    val wordTranslations: LemmaTranslations? = null,
    val basqueReference: List<BasqueReference> = emptyList(),
    val basqueRefSource: String? = null,
    val isWordLoading: Boolean = false,
    val restoreTokenIdx: Int? = null,
    val romanize: Boolean = false,
    val isRtl: Boolean = false,
    val pageMode: Boolean = false,
    val prevTextId: String? = null,
    val nextTextId: String? = null,
    val prevTitle: String? = null,
    val nextTitle: String? = null,
    val chapters: List<ReaderChapterRef> = emptyList(),
    val fontSize: Int = SettingsStore.DEFAULT_FONT_SIZE_SP,
    val lineSpacing: Float = SettingsStore.DEFAULT_LINE_SPACING,
    val progress: Float = 0f,
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
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val textId: String =
        checkNotNull(savedStateHandle.get<String>("textId")) { "reader requires a textId arg" }
    private val collectionId: String? = savedStateHandle.get<String>("collectionId")
    private val openAtEnd: Boolean = savedStateHandle.get<Boolean>("atEnd") ?: false
    private val resumeSavedPosition: Boolean = savedStateHandle.get<Boolean>("resume") ?: true

    private val _state = MutableStateFlow(ReaderUiState())
    val state: StateFlow<ReaderUiState> = _state.asStateFlow()

    private var progressJob: Job? = null
    private var currentTopToken = 0

    // This text's language, so reading prefs are read/written per-language.
    private var language: String = ""

    // Admin-only Basque reference lookups; after one denial (non-admin) we stop asking.
    private var basqueRefDisabled = false

    init {
        loadInitial()
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
        _state.update { it.copy(isLoading = true, errorMessage = null, selectedWord = null, wordTranslations = null) }
        viewModelScope.launch {
            when (val chapter = repository.chapter(textId, chapterIdx)) {
                is Outcome.Success -> {
                    val anchor =
                        if (atEnd) chapter.data.tokens.lastIndex.coerceAtLeast(0) else restoreTokenIdx
                    _state.update {
                        it.copy(
                            isLoading = false,
                            chapterIdx = chapterIdx,
                            tokens = chapter.data.tokens,
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
                }

                is Outcome.Failure ->
                    _state.update { it.copy(isLoading = false, errorMessage = chapter.message) }
            }
        }
    }

    fun onWordTap(token: ReaderToken) {
        if (!token.isWord) return
        val lemmaId = token.lemmaId
        _state.update {
            it.copy(
                selectedWord = token,
                wordTranslations = null,
                basqueReference = emptyList(),
                isWordLoading = lemmaId != null,
            )
        }
        if (lemmaId != null) {
            viewModelScope.launch {
                val outcome = dictionary.translations(lemmaId)
                _state.update { s ->
                    // Ignore if the user has since tapped a different word.
                    if (s.selectedWord?.lemmaId != lemmaId) return@update s
                    when (outcome) {
                        is Outcome.Success -> s.copy(isWordLoading = false, wordTranslations = outcome.data)
                        is Outcome.Failure -> s.copy(isWordLoading = false)
                    }
                }
            }
        }
        // Admin-only Basque reference dictionaries. The endpoint 403s non-admins,
        // after which we stop asking for the rest of the session.
        if (language == "eu" && !basqueRefDisabled) {
            viewModelScope.launch {
                when (val ref = dictionary.basqueReference(token.surface)) {
                    is Outcome.Success -> _state.update { s ->
                        if (s.selectedWord == token) s.copy(basqueReference = ref.data) else s
                    }
                    is Outcome.Failure -> basqueRefDisabled = true
                }
            }
        }
    }

    /** Save the viewer's own definition for the selected word, then refresh the
     *  panel so it appears under "Your notes". */
    fun addDefinition(text: String) {
        val body = text.trim()
        if (body.isEmpty()) return
        val lemmaId = _state.value.selectedWord?.lemmaId ?: return
        viewModelScope.launch {
            if (dictionary.addDefinition(lemmaId, body) is Outcome.Success) {
                // Force-refresh so the new note appears (the cache is now stale).
                val refreshed = dictionary.refreshTranslations(lemmaId)
                if (refreshed is Outcome.Success) {
                    _state.update { s ->
                        if (s.selectedWord?.lemmaId == lemmaId) s.copy(wordTranslations = refreshed.data) else s
                    }
                }
            }
        }
    }

    /** Pull the latest definitions/community suggestions for the open word. */
    fun refreshSelectedWord() {
        val lemmaId = _state.value.selectedWord?.lemmaId ?: return
        _state.update { it.copy(isWordLoading = true) }
        viewModelScope.launch {
            val o = dictionary.refreshTranslations(lemmaId)
            _state.update { s ->
                if (s.selectedWord?.lemmaId != lemmaId) return@update s
                when (o) {
                    is Outcome.Success -> s.copy(isWordLoading = false, wordTranslations = o.data)
                    is Outcome.Failure -> s.copy(isWordLoading = false)
                }
            }
        }
    }

    /** Persist a status for the selected word's lemma and recolor every
     *  occurrence of that lemma in the current chapter. */
    fun setStatus(status: KnownStatus) {
        val lemmaId = _state.value.selectedWord?.lemmaId ?: return
        viewModelScope.launch {
            when (val res = dictionary.setStatus(lemmaId, status)) {
                is Outcome.Success -> _state.update { s ->
                    val confirmed = res.data
                    s.copy(
                        tokens = s.tokens.map {
                            if (it.lemmaId == lemmaId) it.copy(status = confirmed) else it
                        },
                        selectedWord = s.selectedWord?.copy(status = confirmed),
                    )
                }

                is Outcome.Failure -> Unit // leave status unchanged; user can retry
            }
        }
    }

    fun dismissWord() = _state.update { it.copy(selectedWord = null, wordTranslations = null, isWordLoading = false) }

    fun nextChapter() {
        if (_state.value.hasNext) loadChapter(_state.value.chapterIdx + 1, saveOnLoad = true)
    }

    fun prevChapter() {
        if (_state.value.hasPrev) loadChapter(_state.value.chapterIdx - 1, saveOnLoad = true)
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
