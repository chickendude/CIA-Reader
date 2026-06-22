package com.ciareader.reader.ui.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ciareader.reader.core.network.Outcome
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
    val languages: List<Language> = emptyList(),
    val currentLanguage: String? = null,
    val collections: List<CollectionSummary> = emptyList(),
    val texts: List<TextCard> = emptyList(),
    val errorMessage: String? = null,
) {
    /** Human label for the active language (display name, falling back to code). */
    val currentLanguageLabel: String
        get() = languages.firstOrNull { it.code == currentLanguage }?.displayName
            ?: currentLanguage.orEmpty()

    val isEmpty: Boolean get() = collections.isEmpty() && texts.isEmpty()
}

@HiltViewModel
class LibraryViewModel @Inject constructor(
    private val languageRepository: LanguageRepository,
    private val libraryRepository: LibraryRepository,
    private val collectionRepository: CollectionRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(LibraryUiState())
    val state: StateFlow<LibraryUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.update { it.copy(isLoading = true, errorMessage = null) }
        viewModelScope.launch {
            when (val langs = languageRepository.myLanguages()) {
                is Outcome.Failure ->
                    _state.update { it.copy(isLoading = false, errorMessage = langs.message) }

                is Outcome.Success -> {
                    val languages = langs.data
                    val current = _state.value.currentLanguage
                        ?: languages.firstOrNull { it.isDefault }?.code
                        ?: languages.firstOrNull()?.code
                    _state.update { it.copy(languages = languages, currentLanguage = current) }
                    if (current != null) {
                        loadContent(current)
                    } else {
                        _state.update { it.copy(isLoading = false) }
                    }
                }
            }
        }
    }

    fun selectLanguage(code: String) {
        if (code == _state.value.currentLanguage) return
        _state.update { it.copy(currentLanguage = code, isLoading = true, errorMessage = null) }
        viewModelScope.launch {
            // Persist server-side. The explicit `language` arg drives the listing
            // regardless, so a failed persist doesn't block the local switch.
            languageRepository.setCurrent(code)
            loadContent(code)
        }
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
