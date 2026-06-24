package com.ciareader.reader.data.upload

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Guards the upload DTOs against drift from the web endpoints' shapes. */
class UploadSerializationTest {

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    @Test
    fun encodesCreateTextRequestWithSourceType() {
        val encoded = json.encodeToString(
            CreateTextRequest(language = "hi", title = "T", body = "B", sourceType = "txt"),
        )
        // The server discriminates on sourceType; it must be on the wire.
        assertTrue(encoded.contains("\"sourceType\":\"txt\""))
        assertTrue(encoded.contains("\"language\":\"hi\""))
    }

    @Test
    fun decodesCreateTextResponse() {
        val payload = """
            {
              "text": {
                "id": "t1", "ownerId": "u1", "language": "hi", "title": "Story",
                "sourceType": "paste", "status": "ready", "visibility": "private",
                "createdAt": "2026-06-23T00:00:00Z"
              },
              "chapterCount": 1
            }
        """.trimIndent()

        val dto = json.decodeFromString<CreateTextResponseDto>(payload)
        assertEquals("t1", dto.text.id)
        assertEquals("Story", dto.text.title)
        assertEquals(1, dto.chapterCount)
    }

    @Test
    fun decodesEpubTextResponse() {
        val payload = """
            {
              "kind": "text",
              "text": { "id": "e1", "language": "yi", "title": "Short", "status": "processing" },
              "chapterCount": 1
            }
        """.trimIndent()

        val dto = json.decodeFromString<EpubUploadResponseDto>(payload)
        assertEquals("text", dto.kind)
        assertEquals("e1", dto.text?.id)
        assertNull(dto.collection)
    }

    @Test
    fun decodesEpubCollectionResponse() {
        val payload = """
            {
              "kind": "collection",
              "collection": {
                "id": "c1", "ownerId": "u1", "language": "eu", "title": "Big Book",
                "kind": "chapter_book", "visibility": "private", "createdAt": "2026-06-23T00:00:00Z"
              },
              "textCount": 12
            }
        """.trimIndent()

        val dto = json.decodeFromString<EpubUploadResponseDto>(payload)
        assertEquals("collection", dto.kind)
        assertEquals("c1", dto.collection?.id)
        assertEquals(12, dto.textCount)
        assertNull(dto.text)
    }
}
