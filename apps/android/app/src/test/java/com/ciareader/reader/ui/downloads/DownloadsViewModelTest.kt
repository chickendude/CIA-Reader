package com.ciareader.reader.ui.downloads

import com.ciareader.reader.data.local.Download
import com.ciareader.reader.data.local.OfflineCache
import com.ciareader.reader.util.MainDispatcherRule
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DownloadsViewModelTest {

    @get:Rule
    val mainRule = MainDispatcherRule()

    @Test
    fun loadsDownloadsAndTotal() = runTest(mainRule.dispatcher) {
        val cache = FakeOfflineCache(
            mutableListOf(
                Download("t1", "Book One", "hi", chapters = 3, sizeBytes = 2_000),
                Download("t2", "Book Two", "eu", chapters = 1, sizeBytes = 500),
            ),
        )
        val vm = DownloadsViewModel(cache)
        advanceUntilIdle()

        val s = vm.state.value
        assertFalse(s.isLoading)
        assertEquals(listOf("t1", "t2"), s.downloads.map { it.textId })
        assertEquals(2_500L, s.totalBytes)
        assertFalse(s.isEmpty)
    }

    @Test
    fun deleteRemovesItemFromCacheAndState() = runTest(mainRule.dispatcher) {
        val cache = FakeOfflineCache(
            mutableListOf(
                Download("t1", "Book One", "hi", 3, 2_000),
                Download("t2", "Book Two", "eu", 1, 500),
            ),
        )
        val vm = DownloadsViewModel(cache)
        advanceUntilIdle()

        vm.delete("t1")
        advanceUntilIdle()

        assertEquals(listOf("t2"), vm.state.value.downloads.map { it.textId })
        assertEquals(500L, vm.state.value.totalBytes)
        assertFalse(cache.items.any { it.textId == "t1" }) // also gone from the cache
    }

    @Test
    fun emptyWhenNothingDownloaded() = runTest(mainRule.dispatcher) {
        val vm = DownloadsViewModel(FakeOfflineCache(mutableListOf()))
        advanceUntilIdle()
        assertTrue(vm.state.value.isEmpty)
    }
}

private class FakeOfflineCache(val items: MutableList<Download>) : OfflineCache {
    override suspend fun clear() = items.clear()
    override suspend fun downloads(): List<Download> = items.toList()
    override suspend fun delete(textId: String) {
        items.removeAll { it.textId == textId }
    }
}
