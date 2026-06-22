package com.ciareader.reader.data.dictionary

import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.data.reader.KnownStatus
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class DictionaryRepositoryTest {

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    @Test
    fun mapsTranslationsGroupedBySource() = runTest {
        val api = FakeDictionaryApi(
            translations = LemmaTranslationsDto(
                lemma = LemmaDto("l1", "नमस्ते", "INTJ", "hello"),
                translations = TranslationGroupsDto(
                    personal = listOf(TranslationDto("p1", "my note")),
                    official = listOf(TranslationDto("o1", "greeting", "en", "Platts")),
                ),
            ),
        )
        val repo = DictionaryRepositoryImpl(api)

        val result = repo.translations("l1")

        assertTrue(result is Outcome.Success)
        val t = (result as Outcome.Success).data
        assertEquals("नमस्ते", t.headword)
        assertEquals("hello", t.gloss)
        assertEquals(listOf("my note"), t.personal.map { it.body })
        assertEquals(listOf("greeting"), t.official.map { it.body })
        assertEquals("Platts", t.official[0].attribution)
        assertTrue(t.community.isEmpty())
    }

    @Test
    fun setStatusSendsWireValueAndReturnsConfirmedStatus() = runTest {
        val api = FakeDictionaryApi(known = KnownLemmaResponseDto(KnownLemmaDto("l1", "known")))
        val repo = DictionaryRepositoryImpl(api)

        val result = repo.setStatus("l1", KnownStatus.KNOWN)

        assertTrue(result is Outcome.Success)
        assertEquals(KnownStatus.KNOWN, (result as Outcome.Success).data)
        assertEquals("l1" to "known", api.lastSet)
    }

    @Test
    fun httpErrorMapsToFailure() = runTest {
        val repo = DictionaryRepositoryImpl(FakeDictionaryApi(error = http(404)))
        assertTrue(repo.translations("missing") is Outcome.Failure)
    }

    @Test
    fun decodesTranslationsIgnoringUnmodeledFields() {
        val payload = """
            {
              "lemma": { "id": "l1", "language": "hi", "headword": "नमस्ते", "pos": "INTJ",
                         "script": "Deva", "glossDefault": "hello", "frequencyRank": 42 },
              "translations": {
                "personal": [],
                "official": [ { "id": "o1", "source": "official_dictionary", "body": "greeting",
                  "targetLanguage": "en", "sourceAttribution": "Platts", "voteScore": 3,
                  "viewerVote": null, "createdAt": "2026-01-01T00:00:00Z" } ],
                "community": []
              },
              "definitionLanguages": ["en"]
            }
        """.trimIndent()
        val dto = json.decodeFromString<LemmaTranslationsDto>(payload)
        assertEquals("नमस्ते", dto.lemma.headword)
        assertEquals("greeting", dto.translations.official[0].body)
    }

    private fun http(code: Int) =
        HttpException(Response.error<Any>(code, "e".toResponseBody("text/plain".toMediaType())))
}

private class FakeDictionaryApi(
    private val translations: LemmaTranslationsDto? = null,
    private val known: KnownLemmaResponseDto? = null,
    private val error: Throwable? = null,
) : DictionaryApi {
    var lastSet: Pair<String, String>? = null
    override suspend fun translations(lemmaId: String): LemmaTranslationsDto =
        error?.let { throw it } ?: translations!!

    override suspend fun setKnownStatus(lemmaId: String, body: KnownLemmaRequest): KnownLemmaResponseDto {
        lastSet = lemmaId to body.status
        return error?.let { throw it } ?: known!!
    }
}
