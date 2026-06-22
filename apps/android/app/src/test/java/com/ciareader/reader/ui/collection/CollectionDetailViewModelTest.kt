package com.ciareader.reader.ui.collection

import androidx.lifecycle.SavedStateHandle
import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.data.collection.CollectionChapter
import com.ciareader.reader.data.collection.CollectionDetail
import com.ciareader.reader.data.collection.CollectionRepository
import com.ciareader.reader.data.collection.CollectionSummary
import com.ciareader.reader.util.MainDispatcherRule
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CollectionDetailViewModelTest {

    @get:Rule
    val mainRule = MainDispatcherRule()

    private fun vm(repo: CollectionRepository) =
        CollectionDetailViewModel(repo, SavedStateHandle(mapOf("collectionId" to "c1")))

    @Test
    fun loadsChapters() = runTest(mainRule.dispatcher) {
        val repo = FakeCollectionRepository(
            detail = CollectionDetail(
                id = "c1",
                title = "Afrika express",
                chapters = listOf(
                    CollectionChapter("t1", "Ch 1", 0, "ready"),
                    CollectionChapter("t2", "Ch 2", 1, "processing"),
                ),
            ),
        )
        val v = vm(repo)
        advanceUntilIdle()

        val s = v.state.value
        assertEquals("Afrika express", s.title)
        assertEquals(2, s.chapters.size)
        assertTrue(s.chapters[0].isReady)
        assertFalse(s.chapters[1].isReady)
        assertFalse(s.isLoading)
        assertNull(s.errorMessage)
    }

    @Test
    fun errorSurfaces() = runTest(mainRule.dispatcher) {
        val v = vm(FakeCollectionRepository(error = "nope"))
        advanceUntilIdle()
        assertEquals("nope", v.state.value.errorMessage)
        assertFalse(v.state.value.isLoading)
    }
}

private class FakeCollectionRepository(
    private val detail: CollectionDetail? = null,
    private val error: String? = null,
) : CollectionRepository {
    override suspend fun myCollections(): Outcome<List<CollectionSummary>> =
        Outcome.Success(emptyList())

    override suspend fun detail(collectionId: String): Outcome<CollectionDetail> =
        error?.let { Outcome.Failure(it) } ?: Outcome.Success(detail!!)
}
