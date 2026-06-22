package com.ciareader.reader.ui.reader

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.data.dictionary.DictionaryRepository
import com.ciareader.reader.data.dictionary.LemmaTranslations
import com.ciareader.reader.data.reader.KnownStatus
import com.ciareader.reader.data.reader.ReaderRepository
import com.ciareader.reader.data.reader.ReaderToken
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ReaderUiState(
    val isLoading: Boolean = true,
    val title: String = "",
    val chapterCount: Int = 1,
    val chapterIdx: Int = 0,
    val tokens: List<ReaderToken> = emptyList(),
    val selectedWord: ReaderToken? = null,
    val wordTranslations: LemmaTranslations? = null,
    val isWordLoading: Boolean = false,
    val errorMessage: String? = null,
) {
    val hasPrev: Boolean get() = chapterIdx > 0
    val hasNext: Boolean get() = chapterIdx < chapterCount - 1
}

@HiltViewModel
class ReaderViewModel @Inject constructor(
    private val repository: ReaderRepository,
    private val dictionary: DictionaryRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val textId: String =
        checkNotNull(savedStateHandle.get<String>("textId")) { "reader requires a textId arg" }

    private val _state = MutableStateFlow(ReaderUiState())
    val state: StateFlow<ReaderUiState> = _state.asStateFlow()

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
                    _state.update {
                        it.copy(
                            title = meta.data.title,
                            chapterCount = meta.data.chapterCount.coerceAtLeast(1),
                        )
                    }
                    loadChapter(0)
                }
            }
        }
    }

    fun loadChapter(chapterIdx: Int) {
        _state.update { it.copy(isLoading = true, errorMessage = null, selectedWord = null, wordTranslations = null) }
        viewModelScope.launch {
            when (val chapter = repository.chapter(textId, chapterIdx)) {
                is Outcome.Success ->
                    _state.update {
                        it.copy(isLoading = false, chapterIdx = chapterIdx, tokens = chapter.data.tokens)
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
            it.copy(selectedWord = token, wordTranslations = null, isWordLoading = lemmaId != null)
        }
        if (lemmaId == null) return
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
        if (_state.value.hasNext) loadChapter(_state.value.chapterIdx + 1)
    }

    fun prevChapter() {
        if (_state.value.hasPrev) loadChapter(_state.value.chapterIdx - 1)
    }

    fun retry() {
        if (_state.value.title.isEmpty()) loadInitial() else loadChapter(_state.value.chapterIdx)
    }
}
