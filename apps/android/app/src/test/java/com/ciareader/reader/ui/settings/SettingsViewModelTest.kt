package com.ciareader.reader.ui.settings

import com.ciareader.reader.core.settings.SettingsStore
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
        cache: FakeOfflineCache = FakeOfflineCache(),
    ) = SettingsViewModel(settings, cache)

    @Test
    fun loadsCurrentPreferences() = runTest(mainRule.dispatcher) {
        val store = FakeSettingsStore().apply {
            romanization = true; page = true; font = 22; spacing = 1.8f
        }
        val v = vm(store)
        advanceUntilIdle()

        val s = v.state.value
        assertTrue(s.romanization)
        assertTrue(s.pageMode)
        assertEquals(22, s.fontSize)
        assertEquals(1.8f, s.lineSpacing)
    }

    @Test
    fun togglesPersistToStore() = runTest(mainRule.dispatcher) {
        val store = FakeSettingsStore()
        val v = vm(store)
        advanceUntilIdle()

        v.setRomanization(true)
        v.setPageMode(true)
        advanceUntilIdle()

        assertTrue(store.romanization)
        assertTrue(store.page)
        assertTrue(v.state.value.romanization)
        assertTrue(v.state.value.pageMode)
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

        // One-shot: the confirmation flag resets once shown.
        v.onCacheClearedShown()
        assertFalse(v.state.value.cacheCleared)
    }
}

private class FakeSettingsStore : SettingsStore {
    var lang: String? = null
    var romanization = false
    var page = false
    var font = SettingsStore.DEFAULT_FONT_SIZE_SP
    var spacing = SettingsStore.DEFAULT_LINE_SPACING

    override val currentLanguage: Flow<String?> = MutableStateFlow(null)
    override suspend fun currentLanguage(): String? = lang
    override suspend fun setCurrentLanguage(code: String) {
        lang = code
    }

    override suspend fun showRomanization(): Boolean = romanization
    override suspend fun setShowRomanization(value: Boolean) {
        romanization = value
    }

    override suspend fun pageMode(): Boolean = page
    override suspend fun setPageMode(value: Boolean) {
        page = value
    }

    override suspend fun fontSizeSp(): Int = font
    override suspend fun setFontSizeSp(value: Int) {
        font = value
    }

    override suspend fun lineSpacing(): Float = spacing
    override suspend fun setLineSpacing(value: Float) {
        spacing = value
    }
}

private class FakeOfflineCache : OfflineCache {
    var cleared = 0
    override suspend fun clear() {
        cleared++
    }
}
