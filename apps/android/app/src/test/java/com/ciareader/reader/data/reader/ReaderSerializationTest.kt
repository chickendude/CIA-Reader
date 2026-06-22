package com.ciareader.reader.data.reader

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Guards the reader DTOs against drift from the server's token/metadata shapes. */
class ReaderSerializationTest {

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    @Test
    fun decodesChapterTokensIgnoringUnmodeledFields() {
        // Includes server fields we don't model yet (candidates, features,
        // numberForms, personalGloss) to prove ignoreUnknownKeys tolerance.
        val payload = """
            {
              "chapterId": "c1", "chapterIdx": 0, "body": "नमस्ते।",
              "tokens": [
                {
                  "id": "tok1", "idx": 0, "chapterId": "c1", "surface": "नमस्ते",
                  "isWord": true, "isAmbiguous": false, "isOov": false,
                  "lemmaId": "l1", "romanization": "namaste",
                  "glossDefault": "hello", "personalGloss": null,
                  "candidates": [], "features": {}, "numberForms": null,
                  "status": "known", "hasDefinition": true
                },
                { "idx": 1, "surface": "।", "isWord": false, "status": "unknown" }
              ],
              "phraseSpans": []
            }
        """.trimIndent()

        val dto = json.decodeFromString<ChapterTokensDto>(payload)
        assertEquals(2, dto.tokens.size)
        assertEquals("नमस्ते", dto.tokens[0].surface)
        assertEquals("known", dto.tokens[0].status)
        assertEquals("namaste", dto.tokens[0].romanization)
        assertTrue(dto.tokens[0].isWord)
        assertFalse(dto.tokens[1].isWord)
    }

    @Test
    fun decodesTextMeta() {
        val payload = """
            {
              "text": {
                "id": "t1", "ownerId": "u1", "language": "hi", "title": "एक किताब",
                "sourceType": "epub", "status": "ready", "visibility": "private",
                "createdAt": "2026-06-21T00:00:00Z", "updatedAt": "2026-06-21T00:00:00Z"
              },
              "chapterCount": 2,
              "chapters": [
                { "idx": 0, "title": "Ch 1", "tokenCount": 100 },
                { "idx": 1, "title": null, "tokenCount": 50 }
              ]
            }
        """.trimIndent()

        val dto = json.decodeFromString<TextMetaDto>(payload)
        assertEquals("एक किताब", dto.text.title)
        assertEquals(2, dto.chapterCount)
        assertEquals(2, dto.chapters.size)
        assertEquals(50, dto.chapters[1].tokenCount)
    }

    @Test
    fun decodesTextProgress() {
        val withRow = """
            {
              "progress": {
                "userId": "u1", "textId": "t1",
                "lastChapterIdx": 3, "lastTokenIdx": 120, "pctRead": 42.5,
                "updatedAt": "2026-06-21T00:00:00Z"
              }
            }
        """.trimIndent()
        val dto = json.decodeFromString<TextProgressEnvelopeDto>(withRow)
        assertEquals(3, dto.progress?.lastChapterIdx)
        assertEquals(120, dto.progress?.lastTokenIdx)
        assertEquals(42.5, dto.progress?.pctRead)

        val none = json.decodeFromString<TextProgressEnvelopeDto>("""{ "progress": null }""")
        assertEquals(null, none.progress)
    }
}
