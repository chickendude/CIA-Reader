package com.ciareader.reader.ui.stats

import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.core.settings.ReadingTimeStore
import com.ciareader.reader.core.settings.SettingsStore
import com.ciareader.reader.data.language.Language
import com.ciareader.reader.data.language.LanguageRepository
import com.ciareader.reader.data.stats.LanguageStats
import com.ciareader.reader.data.stats.StatsRepository
import com.ciareader.reader.util.MainDispatcherRule
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class StatsViewModelTest {

    @get:Rule
    val mainRule = MainDispatcherRule()

    private fun vm(
        stats: FakeStatsRepository = FakeStatsRepository(),
        readingTime: FakeReadingTimeStore = FakeReadingTimeStore(),
        languages: FakeLanguageRepository = FakeLanguageRepository(listOf(language("hi", "Hindi"))),
        settings: FakeSettingsStore = FakeSettingsStore("hi"),
    ) = StatsViewModel(stats, readingTime, languages, settings)

    @Test
    fun loadsServerStatsForCurrentLanguage() = runTest(mainRule.dispatcher) {
        val stats = FakeStatsRepository(
            result = Outcome.Success(
                LanguageStats(
                    knownCount = 120,
                    learningCount = 30,
                    encounteredCount = 400,
                    knownPhrasesCount = 5,
                    estimatedComprehensionPct = 72,
                ),
            ),
        )
        val v = vm(stats)
        advanceUntilIdle()

        val s = v.state.value
        assertFalse(s.isLoading)
        assertEquals("Hindi", s.languageLabel)
        assertEquals(120, s.knownWords)
        assertEquals(30, s.learningWords)
        assertEquals(5, s.knownPhrases)
        assertEquals(72, s.estimatedComprehensionPct)
        assertNull(s.errorMessage)
        assertEquals("hi", stats.requestedLanguage)
    }

    @Test
    fun nullComprehensionStaysNull() = runTest(mainRule.dispatcher) {
        val stats = FakeStatsRepository(
            result = Outcome.Success(
                LanguageStats(
                    knownCount = 0,
                    learningCount = 0,
                    encounteredCount = 0,
                    knownPhrasesCount = 0,
                    estimatedComprehensionPct = null,
                ),
            ),
        )
        val v = vm(stats)
        advanceUntilIdle()
        assertNull(v.state.value.estimatedComprehensionPct)
    }

    @Test
    fun surfacesLocalReadingTimePerLanguageAndTotal() = runTest(mainRule.dispatcher) {
        val time = FakeReadingTimeStore().apply {
            added["hi"] = 600_000L // 10 min
            added["mr"] = 300_000L // 5 min
        }
        val v = vm(readingTime = time)
        advanceUntilIdle()

        val s = v.state.value
        assertEquals(600_000L, s.languageReadingTimeMs)
        assertEquals(900_000L, s.totalReadingTimeMs)
    }

    @Test
    fun serverFailureKeepsLocalReadingTimeAndSetsError() = runTest(mainRule.dispatcher) {
        val time = FakeReadingTimeStore().apply { added["hi"] = 120_000L }
        val v = vm(stats = FakeStatsRepository(result = Outcome.Failure("offline")), readingTime = time)
        advanceUntilIdle()

        val s = v.state.value
        assertFalse(s.isLoading)
        assertEquals("offline", s.errorMessage)
        // Local reading time still shown even when the network stats fail.
        assertEquals(120_000L, s.languageReadingTimeMs)
        assertEquals(0, s.knownWords)
    }

    @Test
    fun formatDurationRendersHoursAndMinutes() {
        assertEquals("0m", formatDuration(0L))
        assertEquals("0m", formatDuration(30_000L)) // under a minute rounds down
        assertEquals("5m", formatDuration(5 * 60_000L))
        assertEquals("1h 0m", formatDuration(60 * 60_000L))
        assertEquals("2h 5m", formatDuration((2 * 60 + 5) * 60_000L))
    }

    private fun language(code: String, displayName: String) =
        Language(code = code, displayName = displayName, nativeName = displayName, script = "Deva", isDefault = false)
}

private class FakeStatsRepository(
    private val result: Outcome<LanguageStats> = Outcome.Success(
        LanguageStats(0, 0, 0, 0, null),
    ),
) : StatsRepository {
    var requestedLanguage: String? = null
    override suspend fun languageStats(language: String): Outcome<LanguageStats> {
        requestedLanguage = language
        return result
    }
}

private class FakeReadingTimeStore : ReadingTimeStore {
    val added = mutableMapOf<String, Long>()
    override suspend fun addReadingTime(language: String, deltaMs: Long) {
        added[language] = (added[language] ?: 0L) + deltaMs
    }

    override suspend fun readingTimeMs(language: String): Long = added[language] ?: 0L
    override suspend fun readingTimeByLanguage(): Map<String, Long> = added.toMap()
    override suspend fun totalReadingTimeMs(): Long = added.values.sum()
}

private class FakeLanguageRepository(private val langs: List<Language> = emptyList()) : LanguageRepository {
    override suspend fun myLanguages(): Outcome<List<Language>> = Outcome.Success(langs)
    override suspend fun setCurrent(code: String): Outcome<String> = Outcome.Success(code)
    override suspend fun cachedLanguages(): List<Language> = langs
}

private class FakeSettingsStore(private val lang: String? = "hi") : SettingsStore {
    override val currentLanguage: Flow<String?> = MutableStateFlow(lang)
    override suspend fun currentLanguage(): String? = lang
    override suspend fun setCurrentLanguage(code: String) {}
    override suspend fun showRomanization(language: String): Boolean = false
    override suspend fun setShowRomanization(language: String, value: Boolean) {}
    override suspend fun pageMode(language: String): Boolean = false
    override suspend fun setPageMode(language: String, value: Boolean) {}
    override suspend fun fontSizeSp(language: String): Int = SettingsStore.DEFAULT_FONT_SIZE_SP
    override suspend fun setFontSizeSp(language: String, value: Int) {}
    override suspend fun lineSpacing(language: String): Float = SettingsStore.DEFAULT_LINE_SPACING
    override suspend fun setLineSpacing(language: String, value: Float) {}
    override suspend fun basqueRefSource(): String? = null
    override suspend fun setBasqueRefSource(source: String) {}
}
