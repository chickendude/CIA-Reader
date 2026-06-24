package com.ciareader.reader.ui.settings

import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.core.settings.SettingsStore
import com.ciareader.reader.data.language.Language
import com.ciareader.reader.data.language.LanguageRepository
import com.ciareader.reader.data.local.OfflineCache
import com.ciareader.reader.util.MainDispatcherRule
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SettingsViewModelTest {

    @get:Rule
    val mainRule = MainDispatcherRule()

    private fun vm(
        settings: FakeSettingsStore = FakeSettingsStore(),
        languages: FakeLanguageRepository = FakeLanguageRepository(listOf(language("hi", "Hindi"))),
        cache: FakeOfflineCache = FakeOfflineCache(),
    ) = SettingsViewModel(settings, languages, cache)

    @Test
    fun loadsCurrentLanguagePreferencesAndLabel() = runTest(mainRule.dispatcher) {
        val store = FakeSettingsStore(lang = "hi").apply {
            romanization["hi"] = true
            page["hi"] = true
            font["hi"] = 22
            spacing["hi"] = 1.8f
        }
        val v = vm(store)
        advanceUntilIdle()

        val s = v.state.value
        assertEquals("Hindi", s.languageLabel)
        assertTrue(s.romanization)
        assertTrue(s.pageMode)
        assertEquals(22, s.fontSize)
        assertEquals(1.8f, s.lineSpacing)
    }

    @Test
    fun togglesPersistUnderTheCurrentLanguage() = runTest(mainRule.dispatcher) {
        val store = FakeSettingsStore(lang = "hi")
        val v = vm(store)
        advanceUntilIdle()

        v.setRomanization(true)
        v.setPageMode(true)
        advanceUntilIdle()

        assertEquals(true, store.romanization["hi"])
        assertEquals(true, store.page["hi"])
        assertTrue(v.state.value.romanization)
    }

    @Test
    fun readsTheCurrentLanguageNotAGlobalValue() = runTest(mainRule.dispatcher) {
        // hi has romanization on; eu does not. With eu current, it reads off.
        val store = FakeSettingsStore(lang = "eu").apply {
            romanization["hi"] = true
            romanization["eu"] = false
        }
        val v = vm(store, FakeLanguageRepository(listOf(language("eu", "Basque"))))
        advanceUntilIdle()

        assertFalse(v.state.value.romanization)
        assertEquals("Basque", v.state.value.languageLabel)
    }

    @Test
    fun fontSizeClampsToBounds() = runTest(mainRule.dispatcher) {
        val v = vm()
        advanceUntilIdle()

        repeat(50) { v.setFontSize(v.state.value.fontSize + SettingsViewModel.FONT_SIZE_STEP) }
        advanceUntilIdle()
        assertEquals(SettingsViewModel.FONT_SIZE_MAX, v.state.value.fontSize)

        repeat(50) { v.setFontSize(v.state.value.fontSize - SettingsViewModel.FONT_SIZE_STEP) }
        advanceUntilIdle()
        assertEquals(SettingsViewModel.FONT_SIZE_MIN, v.state.value.fontSize)
    }

    @Test
    fun lineSpacingClampsAndRounds() = runTest(mainRule.dispatcher) {
        val v = vm()
        advanceUntilIdle()

        v.setLineSpacing(5f)
        advanceUntilIdle()
        assertEquals(SettingsViewModel.LINE_SPACING_MAX, v.state.value.lineSpacing)

        v.setLineSpacing(0f)
        advanceUntilIdle()
        assertEquals(SettingsViewModel.LINE_SPACING_MIN, v.state.value.lineSpacing)
    }

    @Test
    fun clearOfflineCacheClearsAndFlags() = runTest(mainRule.dispatcher) {
        val cache = FakeOfflineCache()
        val v = vm(cache = cache)
        advanceUntilIdle()

        v.clearOfflineCache()
        advanceUntilIdle()
        assertEquals(1, cache.cleared)
        assertTrue(v.state.value.cacheCleared)

        v.onCacheClearedShown()
        assertFalse(v.state.value.cacheCleared)
    }

    private fun language(code: String, displayName: String) =
        Language(code = code, displayName = displayName, nativeName = displayName, script = "Deva", isDefault = false)
}

private class FakeSettingsStore(var lang: String? = "hi") : SettingsStore {
    val romanization = mutableMapOf<String, Boolean>()
    val page = mutableMapOf<String, Boolean>()
    val font = mutableMapOf<String, Int>()
    val spacing = mutableMapOf<String, Float>()

    override val currentLanguage: Flow<String?> = MutableStateFlow(lang)
    override suspend fun currentLanguage(): String? = lang
    override suspend fun setCurrentLanguage(code: String) {
        lang = code
    }

    override suspend fun showRomanization(language: String): Boolean = romanization[language] ?: false
    override suspend fun setShowRomanization(language: String, value: Boolean) {
        romanization[language] = value
    }

    override suspend fun pageMode(language: String): Boolean = page[language] ?: false
    override suspend fun setPageMode(language: String, value: Boolean) {
        page[language] = value
    }

    override suspend fun fontSizeSp(language: String): Int = font[language] ?: SettingsStore.DEFAULT_FONT_SIZE_SP
    override suspend fun setFontSizeSp(language: String, value: Int) {
        font[language] = value
    }

    override suspend fun lineSpacing(language: String): Float =
        spacing[language] ?: SettingsStore.DEFAULT_LINE_SPACING

    override suspend fun setLineSpacing(language: String, value: Float) {
        spacing[language] = value
    }

    private var basqueRef: String? = null
    override suspend fun basqueRefSource(): String? = basqueRef
    override suspend fun setBasqueRefSource(source: String) {
        basqueRef = source
    }
}

private class FakeLanguageRepository(private val langs: List<Language> = emptyList()) : LanguageRepository {
    override suspend fun myLanguages(): Outcome<List<Language>> = Outcome.Success(langs)
    override suspend fun setCurrent(code: String): Outcome<String> = Outcome.Success(code)
    override suspend fun cachedLanguages(): List<Language> = langs
}

private class FakeOfflineCache : OfflineCache {
    var cleared = 0
    override suspend fun clear() {
        cleared++
    }

    override suspend fun downloads(): List<com.ciareader.reader.data.local.Download> = emptyList()
    override suspend fun delete(textId: String) {}
}
