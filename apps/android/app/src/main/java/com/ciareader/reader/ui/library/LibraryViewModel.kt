package com.ciareader.reader.ui.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ciareader.reader.core.network.Outcome
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
    val texts: List<TextCard> = emptyList(),
    val errorMessage: String? = null,
) {
    /** Human label for the active language (display name, falling back to code). */
    val currentLanguageLabel: String
        get() = languages.firstOrNull { it.code == currentLanguage }?.displayName
            ?: currentLanguage.orEmpty()
}

@HiltViewModel
class LibraryViewModel @Inject constructor(
    private val languageRepository: LanguageRepository,
    private val libraryRepository: LibraryRepository,
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
                        loadTexts(current)
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
            loadTexts(code)
        }
    }

    private suspend fun loadTexts(language: String) {
        when (val res = libraryRepository.listTexts(LibraryScope.OWNED, language)) {
            is Outcome.Success ->
                _state.update { it.copy(isLoading = false, texts = res.data, errorMessage = null) }

            is Outcome.Failure ->
                _state.update { it.copy(isLoading = false, errorMessage = res.message) }
        }
    }
}
