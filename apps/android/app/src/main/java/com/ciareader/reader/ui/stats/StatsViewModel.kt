package com.ciareader.reader.ui.stats

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.core.settings.ReadingTimeStore
import com.ciareader.reader.core.settings.SettingsStore
import com.ciareader.reader.data.language.LanguageRepository
import com.ciareader.reader.data.stats.StatsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class StatsUiState(
    val isLoading: Boolean = true,
    /** Display name of the current reading language (for the header). */
    val languageLabel: String = "",
    /** Distinct known lemmas for the current language. */
    val knownWords: Int = 0,
    /** Lemmas the user is actively learning. */
    val learningWords: Int = 0,
    /** Known multi-word phrases for the current language. */
    val knownPhrases: Int = 0,
    /** Estimated comprehension %, or null when no texts are processed yet. */
    val estimatedComprehensionPct: Int? = null,
    /** Active reading time for this language, in milliseconds (local-only). */
    val languageReadingTimeMs: Long = 0L,
    /** Active reading time across all languages, in milliseconds (local-only). */
    val totalReadingTimeMs: Long = 0L,
    /** Non-null when the server stats couldn't be loaded; counts show as dashes. */
    val errorMessage: String? = null,
)

/**
 * Reading stats for the current language.
 *
 * Known-word counts + estimated comprehension come from the server
 * (GET /api/v1/me/stats). Reading TIME is tracked LOCALLY on-device by
 * the reader ([ReadingTimeStore]) and is NOT synced to the server yet —
 * it survives even when the network stats fail to load.
 */
@HiltViewModel
class StatsViewModel @Inject constructor(
    private val statsRepository: StatsRepository,
    private val readingTime: ReadingTimeStore,
    private val languages: LanguageRepository,
    private val settings: SettingsStore,
) : ViewModel() {

    private val _state = MutableStateFlow(StatsUiState())
    val state: StateFlow<StatsUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.update { it.copy(isLoading = true, errorMessage = null) }
        viewModelScope.launch {
            val language = settings.currentLanguage().orEmpty()
            val label = languages.cachedLanguages()
                .firstOrNull { it.code == language }?.displayName ?: language

            // Local reading time is always available, even offline.
            val langMs = readingTime.readingTimeMs(language)
            val totalMs = readingTime.totalReadingTimeMs()

            _state.update {
                it.copy(
                    languageLabel = label,
                    languageReadingTimeMs = langMs,
                    totalReadingTimeMs = totalMs,
                )
            }

            when (val res = statsRepository.languageStats(language)) {
                is Outcome.Success -> _state.update {
                    it.copy(
                        isLoading = false,
                        knownWords = res.data.knownCount,
                        learningWords = res.data.learningCount,
                        knownPhrases = res.data.knownPhrasesCount,
                        estimatedComprehensionPct = res.data.estimatedComprehensionPct,
                        errorMessage = null,
                    )
                }

                is Outcome.Failure -> _state.update {
                    it.copy(isLoading = false, errorMessage = res.message)
                }
            }
        }
    }
}
