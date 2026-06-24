package com.ciareader.reader.data.library

import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.data.local.CachedCollectionChapterEntity
import com.ciareader.reader.data.local.CachedCollectionDetailEntity
import com.ciareader.reader.data.local.CachedCollectionEntity
import com.ciareader.reader.data.local.CachedLanguageEntity
import com.ciareader.reader.data.local.CachedLibraryCardEntity
import com.ciareader.reader.data.local.LibraryCacheDao
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

class LibraryRepositoryTest {

    private fun repo(api: FakeLibraryApi) = LibraryRepositoryImpl(api, LibraryCache(FakeLibraryCacheDao()))

    @Test
    fun mapsCardsToDomainAndFlagsReadiness() = runTest {
        val api = FakeLibraryApi(
            page = LibraryPageDto(
                cards = listOf(
                    card("t1", status = "ready"),
                    card("t2", status = "processing"),
                ),
                totalCount = 2,
            ),
        )

        val result = repo(api).listTexts(LibraryScope.OWNED, "hi")

        assertTrue(result is Outcome.Success)
        val cards = (result as Outcome.Success).data
        assertEquals(listOf("t1", "t2"), cards.map { it.id })
        assertTrue(cards[0].isReady)
        assertFalse(cards[1].isReady)
        assertEquals("owned" to "hi", api.lastScope to api.lastLanguage)
    }

    @Test
    fun mapsHttpErrorToFailure() = runTest {
        val result = repo(FakeLibraryApi(error = http(403))).listTexts(LibraryScope.OFFICIAL, "yi")
        assertTrue(result is Outcome.Failure)
        assertEquals("You don't have access to that.", (result as Outcome.Failure).message)
    }

    @Test
    fun cachedCardsServeWhenOffline() = runTest {
        val api = FakeLibraryApi(
            page = LibraryPageDto(cards = listOf(card("t1", "ready"), card("t2", "ready")), totalCount = 2),
        )
        val r = repo(api)
        assertTrue(r.listTexts(LibraryScope.OWNED, "hi") is Outcome.Success) // caches

        api.online = false
        val offline = r.listTexts(LibraryScope.OWNED, "hi")
        assertTrue(offline is Outcome.Success)
        assertEquals(listOf("t1", "t2"), (offline as Outcome.Success).data.map { it.id })
    }

    @Test
    fun offlineWithoutCacheFails() = runTest {
        val result = repo(FakeLibraryApi().apply { online = false }).listTexts(LibraryScope.OWNED, "hi")
        assertTrue(result is Outcome.Failure)
    }

    @Test
    fun deleteTextSendsRequest() = runTest {
        val api = FakeLibraryApi()
        val result = repo(api).deleteText("t7")
        assertTrue(result is Outcome.Success)
        assertEquals("t7", api.lastDeletedId)
    }

    @Test
    fun deleteTextFailsWhenOffline() = runTest {
        val result = repo(FakeLibraryApi().apply { online = false }).deleteText("t7")
        assertTrue(result is Outcome.Failure)
    }

    private fun card(id: String, status: String) = TextCardDto(
        id = id,
        title = "Title $id",
        language = "hi",
        sourceType = "paste",
        status = status,
        visibility = "private",
        createdAt = "2026-06-21T00:00:00Z",
    )

    private fun http(code: Int) =
        HttpException(Response.error<Any>(code, "e".toResponseBody("text/plain".toMediaType())))
}

private class FakeLibraryApi(
    private val page: LibraryPageDto? = null,
    private val error: Throwable? = null,
    var online: Boolean = true,
) : LibraryApi {
    var lastScope: String? = null
    var lastLanguage: String? = null
    var lastDeletedId: String? = null
    override suspend fun listTexts(
        scope: String,
        language: String,
        limit: Int?,
        offset: Int?,
    ): LibraryPageDto {
        lastScope = scope
        lastLanguage = language
        if (!online) throw IOException("offline")
        error?.let { throw it }
        return page!!
    }

    override suspend fun deleteText(textId: String): DeleteTextResponseDto {
        if (!online) throw IOException("offline")
        lastDeletedId = textId
        return DeleteTextResponseDto(ok = true)
    }
}

/** In-memory stand-in for the Room DAO so the repository test stays pure-JVM. */
private class FakeLibraryCacheDao : LibraryCacheDao {
    private val languages = mutableListOf<CachedLanguageEntity>()
    private val cards = mutableListOf<CachedLibraryCardEntity>()

    override suspend fun upsertLanguages(rows: List<CachedLanguageEntity>) {
        rows.forEach { e -> languages.removeAll { it.code == e.code }; languages.add(e) }
    }

    override suspend fun languages() = languages.sortedBy { it.position }
    override suspend fun clearLanguages() = languages.clear()
    private val collections = mutableListOf<CachedCollectionEntity>()
    private val details = mutableMapOf<String, CachedCollectionDetailEntity>()
    private val chapters = mutableListOf<CachedCollectionChapterEntity>()

    override suspend fun upsertCards(cards: List<CachedLibraryCardEntity>) {
        cards.forEach { e ->
            this.cards.removeAll { it.scope == e.scope && it.language == e.language && it.id == e.id }
            this.cards.add(e)
        }
    }

    override suspend fun cards(scope: String, language: String) =
        cards.filter { it.scope == scope && it.language == language }.sortedBy { it.position }

    override suspend fun clearCards(scope: String, language: String) {
        cards.removeAll { it.scope == scope && it.language == language }
    }

    override suspend fun upsertCollections(rows: List<CachedCollectionEntity>) {
        rows.forEach { e -> collections.removeAll { it.id == e.id }; collections.add(e) }
    }

    override suspend fun collections() = collections.sortedBy { it.position }
    override suspend fun clearCollections() = collections.clear()
    override suspend fun upsertCollectionDetail(detail: CachedCollectionDetailEntity) {
        details[detail.collectionId] = detail
    }

    override suspend fun collectionDetail(collectionId: String) = details[collectionId]
    override suspend fun upsertCollectionChapters(rows: List<CachedCollectionChapterEntity>) {
        rows.forEach { e ->
            chapters.removeAll { it.collectionId == e.collectionId && it.textId == e.textId }
            chapters.add(e)
        }
    }

    override suspend fun collectionChapters(collectionId: String) =
        chapters.filter { it.collectionId == collectionId }.sortedBy { it.position }

    override suspend fun clearCollectionChapters(collectionId: String) {
        chapters.removeAll { it.collectionId == collectionId }
    }
}
