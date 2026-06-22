package com.ciareader.reader.data.collection

import com.ciareader.reader.core.network.Outcome
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CollectionRepositoryTest {

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

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
        val repo = CollectionRepositoryImpl(api)

        val result = repo.myCollections()

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
        val repo = CollectionRepositoryImpl(api)

        val result = repo.detail("c1")

        assertTrue(result is Outcome.Success)
        val detail = (result as Outcome.Success).data
        assertEquals(2, detail.chapters.size)
        assertEquals("t1", detail.chapters[0].textId)
        assertTrue(detail.chapters[0].isReady)
        assertFalse(detail.chapters[1].isReady)
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
) : CollectionsApi {
    override suspend fun myCollections(): MyCollectionsDto = list!!
    override suspend fun detail(collectionId: String): CollectionDetailDto = detail!!
}
