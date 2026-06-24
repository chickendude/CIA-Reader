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
    fun addDefinitionPostsLemmaAndBody() = runTest {
        val api = FakeDictionaryApi()
        val result = DictionaryRepositoryImpl(api).addDefinition("l1", "my own definition")
        assertTrue(result is Outcome.Success)
        assertEquals("l1", api.lastAdded?.lemmaId)
        assertEquals("my own definition", api.lastAdded?.body)
    }

    @Test
    fun editDefinitionPatchesBody() = runTest {
        val api = FakeDictionaryApi()
        val result = DictionaryRepositoryImpl(api).editDefinition("t1", "updated note")
        assertTrue(result is Outcome.Success)
        assertEquals("t1" to "updated note", api.lastEdited)
    }

    @Test
    fun deleteDefinitionDeletesById() = runTest {
        val api = FakeDictionaryApi()
        val result = DictionaryRepositoryImpl(api).deleteDefinition("t1")
        assertTrue(result is Outcome.Success)
        assertEquals("t1", api.lastDeleted)
    }

    @Test
    fun personalNotesCarryTheirId() = runTest {
        val api = FakeDictionaryApi(
            translations = LemmaTranslationsDto(
                lemma = LemmaDto("l1", "aldatu"),
                translations = TranslationGroupsDto(personal = listOf(TranslationDto("p1", "to change"))),
            ),
        )
        val t = (DictionaryRepositoryImpl(api).translations("l1") as Outcome.Success).data
        assertEquals("p1", t.personal.single().id)
    }

    @Test
    fun basqueReferenceMapsResults() = runTest {
        val api = FakeDictionaryApi(
            basque = BasqueReferenceResponseDto(
                word = "etxe",
                results = listOf(
                    BasqueRefDto(
                        source = "elhuyar_es", label = "Elhuyar eu-es", headword = "etxe",
                        pos = "iz.", definition = "casa", examples = listOf("etxe handia"),
                    ),
                ),
            ),
        )
        val result = DictionaryRepositoryImpl(api).basqueReference("etxe")
        assertTrue(result is Outcome.Success)
        val r = (result as Outcome.Success).data.single()
        assertEquals("Elhuyar eu-es", r.label)
        assertEquals("casa", r.definition)
        assertEquals(listOf("etxe handia"), r.examples)
    }

    @Test
    fun basqueReferenceIsCachedPerWord() = runTest {
        val api = FakeDictionaryApi(
            basque = BasqueReferenceResponseDto("etxe", listOf(BasqueRefDto(source = "elhuyar_es", definition = "casa"))),
        )
        val repo = DictionaryRepositoryImpl(api)
        repo.basqueReference("etxe")
        repo.basqueReference("ETXE") // case-insensitive key -> served from cache
        assertEquals(1, api.basqueCalls)
    }

    @Test
    fun basqueReferenceForbiddenMapsToFailure() = runTest {
        val result = DictionaryRepositoryImpl(FakeDictionaryApi(error = http(403))).basqueReference("etxe")
        assertTrue(result is Outcome.Failure)
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
    private val basque: BasqueReferenceResponseDto? = null,
    private val error: Throwable? = null,
) : DictionaryApi {
    var lastSet: Pair<String, String>? = null
    var lastAdded: CreateTranslationRequest? = null
    override suspend fun translations(lemmaId: String): LemmaTranslationsDto =
        error?.let { throw it } ?: translations!!

    override suspend fun addTranslation(body: CreateTranslationRequest): CreateTranslationResponseDto {
        lastAdded = body
        return error?.let { throw it } ?: CreateTranslationResponseDto(TranslationDto("new", body.body))
    }

    var lastEdited: Pair<String, String>? = null
    override suspend fun editTranslation(id: String, body: UpdateTranslationRequest): CreateTranslationResponseDto {
        lastEdited = id to body.body
        return error?.let { throw it } ?: CreateTranslationResponseDto(TranslationDto(id, body.body))
    }

    var lastDeleted: String? = null
    override suspend fun deleteTranslation(id: String) {
        lastDeleted = id
        error?.let { throw it }
    }

    var basqueCalls = 0
    override suspend fun basqueReference(word: String): BasqueReferenceResponseDto {
        basqueCalls++
        return error?.let { throw it } ?: basque!!
    }

    override suspend fun setKnownStatus(lemmaId: String, body: KnownLemmaRequest): KnownLemmaResponseDto {
        lastSet = lemmaId to body.status
        return error?.let { throw it } ?: known!!
    }
}
