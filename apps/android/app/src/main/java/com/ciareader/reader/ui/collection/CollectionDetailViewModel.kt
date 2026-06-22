package com.ciareader.reader.ui.collection

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.data.collection.CollectionChapter
import com.ciareader.reader.data.collection.CollectionRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CollectionDetailUiState(
    val isLoading: Boolean = true,
    val title: String = "",
    val chapters: List<CollectionChapter> = emptyList(),
    val errorMessage: String? = null,
)

@HiltViewModel
class CollectionDetailViewModel @Inject constructor(
    private val repository: CollectionRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val collectionId: String =
        checkNotNull(savedStateHandle.get<String>("collectionId")) { "collection detail requires collectionId" }

    private val _state = MutableStateFlow(CollectionDetailUiState())
    val state: StateFlow<CollectionDetailUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.update { it.copy(isLoading = true, errorMessage = null) }
        viewModelScope.launch {
            when (val res = repository.detail(collectionId)) {
                is Outcome.Success ->
                    _state.update { it.copy(isLoading = false, title = res.data.title, chapters = res.data.chapters) }

                is Outcome.Failure ->
                    _state.update { it.copy(isLoading = false, errorMessage = res.message) }
            }
        }
    }
}
