package com.ciareader.reader.ui.reader

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ciareader.reader.core.network.Outcome
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
    val errorMessage: String? = null,
) {
    val hasPrev: Boolean get() = chapterIdx > 0
    val hasNext: Boolean get() = chapterIdx < chapterCount - 1
}

@HiltViewModel
class ReaderViewModel @Inject constructor(
    private val repository: ReaderRepository,
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
        _state.update { it.copy(isLoading = true, errorMessage = null, selectedWord = null) }
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
        if (token.isWord) _state.update { it.copy(selectedWord = token) }
    }

    fun dismissWord() = _state.update { it.copy(selectedWord = null) }

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
