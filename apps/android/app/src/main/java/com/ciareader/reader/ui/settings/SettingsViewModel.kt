package com.ciareader.reader.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ciareader.reader.core.settings.SettingsStore
import com.ciareader.reader.data.local.OfflineCache
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SettingsUiState(
    val romanization: Boolean = false,
    val pageMode: Boolean = false,
    val fontSize: Int = SettingsStore.DEFAULT_FONT_SIZE_SP,
    val lineSpacing: Float = SettingsStore.DEFAULT_LINE_SPACING,
    /** One-shot flag so the UI can confirm the offline cache was cleared. */
    val cacheCleared: Boolean = false,
)

/**
 * App settings: reading defaults (shared with the reader via [SettingsStore])
 * plus offline-download management. Logout lives on the screen but is handled
 * by the caller, since it has to unwind navigation.
 */
@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val settings: SettingsStore,
    private val offlineCache: OfflineCache,
) : ViewModel() {

    private val _state = MutableStateFlow(SettingsUiState())
    val state: StateFlow<SettingsUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            _state.update {
                it.copy(
                    romanization = settings.showRomanization(),
                    pageMode = settings.pageMode(),
                    fontSize = settings.fontSizeSp(),
                    lineSpacing = settings.lineSpacing(),
                )
            }
        }
    }

    fun setRomanization(value: Boolean) {
        _state.update { it.copy(romanization = value) }
        viewModelScope.launch { settings.setShowRomanization(value) }
    }

    fun setPageMode(value: Boolean) {
        _state.update { it.copy(pageMode = value) }
        viewModelScope.launch { settings.setPageMode(value) }
    }

    fun setFontSize(sp: Int) {
        val v = sp.coerceIn(FONT_SIZE_MIN, FONT_SIZE_MAX)
        _state.update { it.copy(fontSize = v) }
        viewModelScope.launch { settings.setFontSizeSp(v) }
    }

    fun setLineSpacing(value: Float) {
        // Round to one decimal so repeated steps don't drift (1.5 → 1.5999…).
        val v = (Math.round(value * 10f) / 10f).coerceIn(LINE_SPACING_MIN, LINE_SPACING_MAX)
        _state.update { it.copy(lineSpacing = v) }
        viewModelScope.launch { settings.setLineSpacing(v) }
    }

    fun clearOfflineCache() {
        viewModelScope.launch {
            offlineCache.clear()
            _state.update { it.copy(cacheCleared = true) }
        }
    }

    fun onCacheClearedShown() = _state.update { it.copy(cacheCleared = false) }

    companion object {
        const val FONT_SIZE_MIN = 14
        const val FONT_SIZE_MAX = 28
        const val FONT_SIZE_STEP = 1
        const val LINE_SPACING_MIN = 1.2f
        const val LINE_SPACING_MAX = 2.2f
        const val LINE_SPACING_STEP = 0.1f
    }
}
