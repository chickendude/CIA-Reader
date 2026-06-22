package com.ciareader.reader.data

import com.ciareader.reader.data.language.LanguagesResponseDto
import com.ciareader.reader.data.library.LibraryPageDto
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Guards the library/language DTOs against drift from the server shapes. */
class LibraryLanguageSerializationTest {

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    @Test
    fun decodesTextsListPage() {
        val payload = """
            {
              "cards": [
                {
                  "id": "t1", "title": "एक कहानी", "language": "hi",
                  "sourceType": "paste", "status": "ready",
                  "visibility": "private", "createdAt": "2026-06-21T00:00:00.000Z"
                }
              ],
              "totalCount": 1, "limit": 20, "offset": 0
            }
        """.trimIndent()

        val page = json.decodeFromString<LibraryPageDto>(payload)
        assertEquals(1, page.cards.size)
        assertEquals("t1", page.cards[0].id)
        assertEquals(20, page.limit)
    }

    @Test
    fun decodesLanguagesAndToleratesExtraFields() {
        val payload = """
            {
              "languages": [
                {
                  "code": "yi", "displayName": "Yiddish", "nativeName": "ייִדיש",
                  "script": "Hebr", "isDefault": false,
                  "scriptPreference": "native", "romanizationScheme": null,
                  "supportedRomanizations": ["yivo"], "futureField": 1
                }
              ]
            }
        """.trimIndent()

        val res = json.decodeFromString<LanguagesResponseDto>(payload)
        assertEquals(1, res.languages.size)
        assertEquals("Hebr", res.languages[0].script)
        assertTrue(res.languages[0].supportedRomanizations.contains("yivo"))
    }
}
