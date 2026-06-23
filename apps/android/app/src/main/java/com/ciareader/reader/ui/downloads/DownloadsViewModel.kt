package com.ciareader.reader.ui.downloads

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ciareader.reader.data.local.Download
import com.ciareader.reader.data.local.OfflineCache
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DownloadsUiState(
    val isLoading: Boolean = true,
    val downloads: List<Download> = emptyList(),
) {
    val totalBytes: Long get() = downloads.sumOf { it.sizeBytes }
    val isEmpty: Boolean get() = downloads.isEmpty()
}

/** Lists what's cached for offline reading + lets the user remove items. */
@HiltViewModel
class DownloadsViewModel @Inject constructor(
    private val offlineCache: OfflineCache,
) : ViewModel() {

    private val _state = MutableStateFlow(DownloadsUiState())
    val state: StateFlow<DownloadsUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            val items = offlineCache.downloads()
            _state.update { it.copy(isLoading = false, downloads = items) }
        }
    }

    fun delete(textId: String) {
        viewModelScope.launch {
            offlineCache.delete(textId)
            _state.update { s -> s.copy(downloads = s.downloads.filterNot { it.textId == textId }) }
        }
    }
}
