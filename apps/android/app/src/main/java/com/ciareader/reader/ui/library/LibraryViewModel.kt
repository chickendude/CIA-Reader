package com.ciareader.reader.ui.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.core.settings.SettingsStore
import com.ciareader.reader.data.collection.CollectionRepository
import com.ciareader.reader.data.collection.CollectionSummary
import com.ciareader.reader.data.language.Language
import com.ciareader.reader.data.language.LanguageRepository
import com.ciareader.reader.data.library.LibraryRepository
import com.ciareader.reader.data.library.LibraryScope
import com.ciareader.reader.data.library.TextCard
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LibraryUiState(
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val languages: List<Language> = emptyList(),
    val currentLanguage: String? = null,
    val collections: List<CollectionSummary> = emptyList(),
    val texts: List<TextCard> = emptyList(),
    val errorMessage: String? = null,
    /** A transient banner for an edit/delete failure (the list itself stays put). */
    val actionError: String? = null,
    /** Per-book stats sheet; null when closed, loading/loaded/failed otherwise. */
    val stats: StatsUiState? = null,
) {
    /** Human label for the active language (display name, falling back to code). */
    val currentLanguageLabel: String
        get() = languages.firstOrNull { it.code == currentLanguage }?.displayName
            ?: currentLanguage.orEmpty()

    val isEmpty: Boolean get() = collections.isEmpty() && texts.isEmpty()
}

/** Stats sheet state for a single book (collection). */
data class StatsUiState(
    val collectionId: String,
    val title: String,
    val isLoading: Boolean = true,
    val stats: BookStats? = null,
    val errorMessage: String? = null,
)

/**
 * Per-book figures derived from the collection's chapter list (GET detail).
 * No new endpoint is needed: chapter count, summed word count, and the share of
 * chapters that have finished processing (a "ready" proxy for both comprehension
 * and reading progress). Token-level comprehension isn't exposed in the listing,
 * so it's reported as this processed ratio — see the PR note for the real figure.
 */
data class BookStats(
    val chapterCount: Int,
    val totalWords: Int,
    val readyChapters: Int,
) {
    /** 0..100 — share of chapters that have finished processing. */
    val comprehensionPct: Int
        get() = if (chapterCount == 0) 0 else (readyChapters * 100) / chapterCount

    /** Same processed ratio, surfaced as reading progress for the sheet. */
    val progressPct: Int get() = comprehensionPct
}

@HiltViewModel
class LibraryViewModel @Inject constructor(
    private val languageRepository: LanguageRepository,
    private val libraryRepository: LibraryRepository,
    private val collectionRepository: CollectionRepository,
    private val settingsStore: SettingsStore,
) : ViewModel() {

    private val _state = MutableStateFlow(LibraryUiState())
    val state: StateFlow<LibraryUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            // 1) Cache-first: paint the last-known library instantly so launch
            //    isn't gated on the network (no spinner, no "Language" placeholder).
            val cachedLangs = languageRepository.cachedLanguages()
            if (cachedLangs.isNotEmpty()) {
                applyLanguages(cachedLangs)
                _state.value.currentLanguage?.let { showCachedContent(it) }
            } else {
                _state.update { it.copy(isLoading = true, errorMessage = null) }
            }
            // 2) Refresh from the network in the background; update in place.
            refreshFromNetwork()
        }
    }

    /** Pull-to-refresh: re-fetch from the network while keeping the current view
     *  visible (drives a small indicator, not the full-screen spinner). */
    fun refresh() {
        if (_state.value.isRefreshing) return
        _state.update { it.copy(isRefreshing = true, errorMessage = null) }
        viewModelScope.launch {
            refreshFromNetwork()
            _state.update { it.copy(isRefreshing = false) }
        }
    }

    /** Network refresh used on first load. Leaves any cached view in place when
     *  the network is unavailable (only errors when there's nothing to show). */
    private suspend fun refreshFromNetwork() {
        when (val langs = languageRepository.myLanguages()) {
            is Outcome.Failure ->
                _state.update {
                    it.copy(
                        isLoading = false,
                        // Don't blank a cached library just because the refresh failed.
                        errorMessage = if (it.languages.isEmpty()) langs.message else null,
                    )
                }

            is Outcome.Success -> {
                applyLanguages(langs.data)
                _state.value.currentLanguage?.let { loadContent(it) }
                    ?: _state.update { it.copy(isLoading = false) }
            }
        }
    }

    /** Resolve the shown languages + current selection from a language list. */
    private suspend fun applyLanguages(langs: List<Language>) {
        // The endpoint returns every supported language; isDefault=true marks
        // ones the user has NOT added (column defaults). Show only the languages
        // they actually added; fall back to the full list for a fresh account.
        val available = langs.filter { !it.isDefault }.ifEmpty { langs }
        val codes = available.map { it.code }.toSet()
        val current = _state.value.currentLanguage?.takeIf { it in codes }
            ?: settingsStore.currentLanguage()?.takeIf { it in codes }
            ?: available.firstOrNull()?.code
        _state.update { it.copy(languages = available, currentLanguage = current, isLoading = false) }
    }

    /** Paint cached texts/collections for [language] without a network call. */
    private suspend fun showCachedContent(language: String) {
        val texts = libraryRepository.cachedTexts(LibraryScope.OWNED, language)
        val collections = collectionRepository.cachedCollections().filter { it.language == language }
        _state.update { it.copy(texts = texts, collections = collections, isLoading = false) }
    }

    fun selectLanguage(code: String) {
        if (code == _state.value.currentLanguage) return
        _state.update { it.copy(currentLanguage = code, isLoading = true, errorMessage = null) }
        viewModelScope.launch {
            // Remember the choice locally so the next launch reopens here, and
            // persist server-side. The explicit `language` arg drives the listing
            // regardless, so a failed persist doesn't block the local switch.
            settingsStore.setCurrentLanguage(code)
            languageRepository.setCurrent(code)
            loadContent(code)
        }
    }

    fun refreshCurrentLanguage() {
        val language = _state.value.currentLanguage ?: return
        if (_state.value.isLoading) return
        viewModelScope.launch { loadContent(language) }
    }

    // --- Book/text management: edit, delete, stats -------------------------

    /** Rename / re-describe a book, then reload the list so the new title shows. */
    fun editCollection(collectionId: String, title: String, description: String?) {
        viewModelScope.launch {
            when (val r = collectionRepository.update(collectionId, title, description)) {
                is Outcome.Success -> reloadCurrentLanguage()
                is Outcome.Failure -> _state.update { it.copy(actionError = r.message) }
            }
        }
    }

    /** Delete a book, then reload the list. */
    fun deleteCollection(collectionId: String) {
        viewModelScope.launch {
            when (val r = collectionRepository.delete(collectionId)) {
                is Outcome.Success -> reloadCurrentLanguage()
                is Outcome.Failure -> _state.update { it.copy(actionError = r.message) }
            }
        }
    }

    /** Delete a standalone text, then reload the list. */
    fun deleteText(textId: String) {
        viewModelScope.launch {
            when (val r = libraryRepository.deleteText(textId)) {
                is Outcome.Success -> reloadCurrentLanguage()
                is Outcome.Failure -> _state.update { it.copy(actionError = r.message) }
            }
        }
    }

    /** Open the stats sheet for a book and fetch its chapter list to fill it. */
    fun showStats(collection: CollectionSummary) {
        _state.update { it.copy(stats = StatsUiState(collection.id, collection.title, isLoading = true)) }
        viewModelScope.launch {
            val sheet = when (val r = collectionRepository.detail(collection.id)) {
                is Outcome.Success -> {
                    val chapters = r.data.chapters
                    StatsUiState(
                        collectionId = collection.id,
                        title = collection.title,
                        isLoading = false,
                        stats = BookStats(
                            chapterCount = chapters.size,
                            totalWords = chapters.sumOf { it.wordCount },
                            readyChapters = chapters.count { it.isReady },
                        ),
                    )
                }
                is Outcome.Failure ->
                    StatsUiState(collection.id, collection.title, isLoading = false, errorMessage = r.message)
            }
            // Ignore a stale result if the sheet was dismissed meanwhile.
            _state.update { if (it.stats?.collectionId == collection.id) it.copy(stats = sheet) else it }
        }
    }

    fun dismissStats() = _state.update { it.copy(stats = null) }

    fun clearActionError() = _state.update { it.copy(actionError = null) }

    /** Re-fetch the current language's list (used after an edit/delete). */
    private fun reloadCurrentLanguage() {
        val language = _state.value.currentLanguage ?: return
        viewModelScope.launch { loadContent(language) }
    }

    private suspend fun loadContent(language: String) {
        when (val textsRes = libraryRepository.listTexts(LibraryScope.OWNED, language)) {
            is Outcome.Failure ->
                _state.update { it.copy(isLoading = false, errorMessage = textsRes.message) }

            is Outcome.Success -> {
                // Collections (chapter-books / courses) are non-fatal: a failure
                // just shows no books rather than blanking the whole library.
                val collections = when (val c = collectionRepository.myCollections()) {
                    is Outcome.Success -> c.data.filter { it.language == language }
                    is Outcome.Failure -> emptyList()
                }
                _state.update {
                    it.copy(
                        isLoading = false,
                        texts = textsRes.data,
                        collections = collections,
                        errorMessage = null,
                    )
                }
            }
        }
    }
}
