package com.ciareader.reader.data.collection

import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.data.local.CachedCollectionChapterEntity
import com.ciareader.reader.data.local.CachedCollectionDetailEntity
import com.ciareader.reader.data.local.CachedCollectionEntity
import com.ciareader.reader.data.local.CachedLanguageEntity
import com.ciareader.reader.data.local.CachedLibraryCardEntity
import com.ciareader.reader.data.local.LibraryCacheDao
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class CollectionRepositoryTest {

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private fun repo(api: FakeCollectionsApi) = CollectionRepositoryImpl(api, CollectionCache(FakeLibraryCacheDao()))

    @Test
    fun mapsCollectionsList() = runTest {
        val api = FakeCollectionsApi(
            list = MyCollectionsDto(
                collections = listOf(
                    CollectionListItemDto(
                        collection = CollectionDto("c1", "Afrika express (20920)", "eu", "chapter_book"),
                        textCount = 12,
                    ),
                ),
            ),
        )

        val result = repo(api).myCollections()

        assertTrue(result is Outcome.Success)
        val summaries = (result as Outcome.Success).data
        assertEquals("Afrika express (20920)", summaries[0].title)
        assertEquals("eu", summaries[0].language)
        assertEquals(12, summaries[0].textCount)
    }

    @Test
    fun mapsDetailChaptersWithReadiness() = runTest {
        val api = FakeCollectionsApi(
            detail = CollectionDetailDto(
                collection = CollectionDto("c1", "Afrika express", "eu", "chapter_book"),
                items = listOf(
                    CollectionItemDto(0, null, CollectionItemTextDto("t1", "Ch 1", "ready")),
                    CollectionItemDto(1, "Part I", CollectionItemTextDto("t2", "Ch 2", "processing")),
                ),
            ),
        )

        val result = repo(api).detail("c1")

        assertTrue(result is Outcome.Success)
        val detail = (result as Outcome.Success).data
        assertEquals(2, detail.chapters.size)
        assertEquals("t1", detail.chapters[0].textId)
        assertTrue(detail.chapters[0].isReady)
        assertFalse(detail.chapters[1].isReady)
    }

    @Test
    fun cachedCollectionsServeWhenOffline() = runTest {
        val api = FakeCollectionsApi(
            list = MyCollectionsDto(
                collections = listOf(
                    CollectionListItemDto(
                        collection = CollectionDto("c1", "Book", "eu", "chapter_book"),
                        textCount = 3,
                        openTextId = "t1",
                    ),
                ),
            ),
        )
        val r = repo(api)
        assertTrue(r.myCollections() is Outcome.Success) // caches

        api.online = false
        val offline = r.myCollections()
        assertTrue(offline is Outcome.Success)
        val first = (offline as Outcome.Success).data.first()
        assertEquals("Book", first.title)
        assertEquals("t1", first.openTextId)
    }

    @Test
    fun cachedDetailServesWhenOffline() = runTest {
        val api = FakeCollectionsApi(
            detail = CollectionDetailDto(
                collection = CollectionDto("c1", "Afrika express", "eu", "chapter_book"),
                items = listOf(
                    CollectionItemDto(0, null, CollectionItemTextDto("t1", "Ch 1", "ready")),
                    CollectionItemDto(1, "Part I", CollectionItemTextDto("t2", "Ch 2", "ready")),
                ),
            ),
        )
        val r = repo(api)
        assertTrue(r.detail("c1") is Outcome.Success) // caches

        api.online = false
        val offline = r.detail("c1")
        assertTrue(offline is Outcome.Success)
        val detail = (offline as Outcome.Success).data
        assertEquals("Afrika express", detail.title)
        assertEquals(listOf("t1", "t2"), detail.chapters.map { it.textId })
    }

    @Test
    fun offlineWithoutCacheFails() = runTest {
        val r = repo(FakeCollectionsApi().apply { online = false })
        assertTrue(r.myCollections() is Outcome.Failure)
        assertTrue(r.detail("c1") is Outcome.Failure)
    }

    @Test
    fun decodesMyCollectionsShape() {
        val payload = """
            {
              "collections": [
                {
                  "collection": {
                    "id": "c1", "ownerId": "u1", "language": "eu", "kind": "chapter_book",
                    "title": "Aulki-jokoa (78201)", "description": null, "coverUrl": null,
                    "visibility": "private", "createdAt": "2026-06-21T00:00:00Z",
                    "updatedAt": "2026-06-21T00:00:00Z"
                  },
                  "textCount": 9
                }
              ]
            }
        """.trimIndent()
        val dto = json.decodeFromString<MyCollectionsDto>(payload)
        assertEquals("Aulki-jokoa (78201)", dto.collections[0].collection.title)
        assertEquals(9, dto.collections[0].textCount)
    }
}

private class FakeCollectionsApi(
    private val list: MyCollectionsDto? = null,
    private val detail: CollectionDetailDto? = null,
    var online: Boolean = true,
) : CollectionsApi {
    override suspend fun myCollections(): MyCollectionsDto {
        if (!online) throw IOException("offline")
        return list!!
    }

    override suspend fun detail(collectionId: String): CollectionDetailDto {
        if (!online) throw IOException("offline")
        return detail!!
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
