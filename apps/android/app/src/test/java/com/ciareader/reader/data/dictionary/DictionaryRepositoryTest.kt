package com.ciareader.reader.data.dictionary

import android.app.Application
import androidx.room.Room
import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.data.local.AppDatabase
import com.ciareader.reader.data.local.ReaderCacheDao
import com.ciareader.reader.data.reader.KnownStatus
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import retrofit2.HttpException
import retrofit2.Response

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class)
class DictionaryRepositoryTest {

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private lateinit var db: AppDatabase
    private lateinit var dao: ReaderCacheDao

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = db.readerCacheDao()
    }

    @After
    fun tearDown() = db.close()

    private fun repo(api: DictionaryApi) = DictionaryRepositoryImpl(api, dao, json)

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

        val result = repo(api).translations("l1")

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
    fun translationsAreCacheFirstAcrossReTaps() = runTest {
        val api = FakeDictionaryApi(
            translations = LemmaTranslationsDto(lemma = LemmaDto("l1", "नमस्ते", "INTJ", "hello")),
        )
        val repo = repo(api)

        val first = repo.translations("l1")
        val second = repo.translations("l1") // served from Room, no second network hit

        assertTrue(first is Outcome.Success)
        assertEquals("नमस्ते", (second as Outcome.Success).data.headword)
        assertEquals(1, api.translationCalls)
    }

    @Test
    fun translationsPersistRawDtoToRoom() = runTest {
        val api = FakeDictionaryApi(
            translations = LemmaTranslationsDto(lemma = LemmaDto("l1", "नमस्ते", "INTJ", "hello")),
        )

        repo(api).translations("l1")

        val row = dao.lemma("l1")
        assertNotNull(row)
        val decoded = json.decodeFromString<LemmaTranslationsDto>(row!!.json)
        assertEquals("नमस्ते", decoded.lemma.headword)
    }

    @Test
    fun translationsServeOfflineFromCacheWhenNetworkLaterFails() = runTest {
        val warm = FakeDictionaryApi(
            translations = LemmaTranslationsDto(lemma = LemmaDto("l1", "नमस्ते", "INTJ", "hello")),
        )
        repo(warm).translations("l1") // warm the cache

        // A fresh repo over a dead network still serves the cached copy.
        val result = repo(FakeDictionaryApi(error = http(503))).translations("l1")

        assertEquals("नमस्ते", (result as Outcome.Success).data.headword)
    }

    @Test
    fun refreshForcesReFetchAndRePersists() = runTest {
        val api = FakeDictionaryApi(
            translations = LemmaTranslationsDto(
                lemma = LemmaDto("l1", "नमस्ते", "INTJ", "hello"),
                translations = TranslationGroupsDto(community = listOf(TranslationDto("c1", "old"))),
            ),
        )
        val repo = repo(api)
        repo.translations("l1") // 1 call, now cached

        // New community suggestion lands on the server.
        api.translations = api.translations!!.copy(
            translations = TranslationGroupsDto(community = listOf(TranslationDto("c2", "newer"))),
        )
        val refreshed = repo.refreshTranslations("l1")

        assertEquals(2, api.translationCalls) // bypassed the cache
        assertEquals(listOf("newer"), (refreshed as Outcome.Success).data.community.map { it.body })
        // Re-persisted: a subsequent cache-first read sees the newer copy.
        assertEquals("newer", (repo.translations("l1") as Outcome.Success).data.community[0].body)
        assertEquals(2, api.translationCalls)
    }

    @Test
    fun refreshFallsBackToCacheOnNetworkFailure() = runTest {
        val warm = FakeDictionaryApi(
            translations = LemmaTranslationsDto(lemma = LemmaDto("l1", "नमस्ते", "INTJ", "hello")),
        )
        repo(warm).translations("l1") // warm the cache

        val result = repo(FakeDictionaryApi(error = http(500))).refreshTranslations("l1")

        assertEquals("नमस्ते", (result as Outcome.Success).data.headword)
    }

    @Test
    fun refreshFailsWhenNoCacheToFallBackOn() = runTest {
        val result = repo(FakeDictionaryApi(error = http(500))).refreshTranslations("missing")
        assertTrue(result is Outcome.Failure)
        assertNull(dao.lemma("missing"))
    }

    @Test
    fun setStatusSendsWireValueAndReturnsConfirmedStatus() = runTest {
        val api = FakeDictionaryApi(known = KnownLemmaResponseDto(KnownLemmaDto("l1", "known")))

        val result = repo(api).setStatus("l1", KnownStatus.KNOWN)

        assertTrue(result is Outcome.Success)
        assertEquals(KnownStatus.KNOWN, (result as Outcome.Success).data)
        assertEquals("l1" to "known", api.lastSet)
    }

    @Test
    fun addDefinitionPostsLemmaAndBody() = runTest {
        val api = FakeDictionaryApi()
        val result = repo(api).addDefinition("l1", "my own definition")
        assertTrue(result is Outcome.Success)
        assertEquals("l1", api.lastAdded?.lemmaId)
        assertEquals("my own definition", api.lastAdded?.body)
        assertNull(api.lastAdded?.parentTranslationId)
        // Defaults to public.
        assertEquals(false, api.lastAdded?.isPrivate)
    }

    @Test
    fun addDefinitionForwardsIsPrivate() = runTest {
        val api = FakeDictionaryApi()
        val result = repo(api).addDefinition("l1", "secret", isPrivate = true)
        assertTrue(result is Outcome.Success)
        assertEquals(true, api.lastAdded?.isPrivate)
    }

    @Test
    fun editDefinitionForwardsIsPrivate() = runTest {
        val api = FakeDictionaryApi()
        val result = repo(api).editDefinition("t1", "updated note", isPrivate = true)
        assertTrue(result is Outcome.Success)
        assertEquals(true, api.lastEditRequest?.isPrivate)
    }

    @Test
    fun addDefinitionForwardsParentTranslationId() = runTest {
        val api = FakeDictionaryApi()
        val result = repo(api).addDefinition("l1", "house (home)", parentTranslationId = "o1")
        assertTrue(result is Outcome.Success)
        assertEquals("o1", api.lastAdded?.parentTranslationId)
    }

    @Test
    fun editDefinitionPatchesBody() = runTest {
        val api = FakeDictionaryApi()
        val result = repo(api).editDefinition("t1", "updated note")
        assertTrue(result is Outcome.Success)
        assertEquals("t1" to "updated note", api.lastEdited)
    }

    @Test
    fun deleteDefinitionDeletesById() = runTest {
        val api = FakeDictionaryApi()
        val result = repo(api).deleteDefinition("t1")
        assertTrue(result is Outcome.Success)
        assertEquals("t1", api.lastDeleted)
    }

    @Test
    fun hideTranslationPatchesHiddenEndpointWithReason() = runTest {
        val api = FakeDictionaryApi()
        val result = repo(api).hideTranslation("t1", hidden = true, reason = "spam")
        assertTrue(result is Outcome.Success)
        assertEquals("t1", api.lastHidden?.first)
        assertEquals(true, api.lastHidden?.second?.hidden)
        assertEquals("spam", api.lastHidden?.second?.reason)
    }

    @Test
    fun personalNotesCarryTheirId() = runTest {
        val api = FakeDictionaryApi(
            translations = LemmaTranslationsDto(
                lemma = LemmaDto("l1", "aldatu"),
                translations = TranslationGroupsDto(personal = listOf(TranslationDto("p1", "to change"))),
            ),
        )
        val t = (repo(api).translations("l1") as Outcome.Success).data
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
        val result = repo(api).basqueReference("etxe")
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
        val repo = repo(api)
        repo.basqueReference("etxe")
        repo.basqueReference("ETXE") // case-insensitive key -> served from cache
        assertEquals(1, api.basqueCalls)
    }

    @Test
    fun basqueReferenceForbiddenMapsToFailure() = runTest {
        val result = repo(FakeDictionaryApi(error = http(403))).basqueReference("etxe")
        assertTrue(result is Outcome.Failure)
    }

    @Test
    fun basqueReferenceExactSendsExactFlagAndCachesSeparately() = runTest {
        val api = FakeDictionaryApi(
            basque = BasqueReferenceResponseDto("Afrika", listOf(BasqueRefDto(source = "elhuyar_es", definition = "África"))),
        )
        val repo = repo(api)

        // A lemma lookup and an exact search of the same word don't share a cache key.
        repo.basqueReference("Afrika") // exact=false
        assertNull(api.lastBasqueExact)
        repo.basqueReference("Afrika", exact = true)
        assertEquals("1", api.lastBasqueExact)
        assertEquals(2, api.basqueCalls)

        // Re-running the exact search is served from cache (no third hit).
        repo.basqueReference("Afrika", exact = true)
        assertEquals(2, api.basqueCalls)
    }

    @Test
    fun basqueReferenceAutocompleteReturnsTerms() = runTest {
        val api = FakeDictionaryApi(
            autocomplete = BasqueAutocompleteResponseDto("afr", listOf("Afrika", "afrikaans")),
        )
        val result = repo(api).basqueReferenceAutocomplete("afr")
        assertEquals(listOf("Afrika", "afrikaans"), (result as Outcome.Success).data)
    }

    @Test
    fun basqueReferenceAutocompleteForbiddenMapsToFailure() = runTest {
        val result = repo(FakeDictionaryApi(error = http(403))).basqueReferenceAutocomplete("afr")
        assertTrue(result is Outcome.Failure)
    }

    @Test
    fun httpErrorMapsToFailure() = runTest {
        val repo = repo(FakeDictionaryApi(error = http(404)))
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
    var translations: LemmaTranslationsDto? = null,
    private val known: KnownLemmaResponseDto? = null,
    private val basque: BasqueReferenceResponseDto? = null,
    private val autocomplete: BasqueAutocompleteResponseDto = BasqueAutocompleteResponseDto(),
    private val error: Throwable? = null,
) : DictionaryApi {
    var lastSet: Pair<String, String>? = null
    var lastAdded: CreateTranslationRequest? = null
    var lastBasqueExact: String? = null
    var translationCalls = 0
    override suspend fun translations(lemmaId: String): LemmaTranslationsDto {
        translationCalls++
        return error?.let { throw it } ?: translations!!
    }

    override suspend fun addTranslation(body: CreateTranslationRequest): CreateTranslationResponseDto {
        lastAdded = body
        return error?.let { throw it } ?: CreateTranslationResponseDto(TranslationDto("new", body.body))
    }

    var lastEdited: Pair<String, String>? = null
    var lastEditRequest: UpdateTranslationRequest? = null
    override suspend fun editTranslation(id: String, body: UpdateTranslationRequest): CreateTranslationResponseDto {
        lastEdited = id to body.body
        lastEditRequest = body
        return error?.let { throw it } ?: CreateTranslationResponseDto(TranslationDto(id, body.body))
    }

    var lastDeleted: String? = null
    override suspend fun deleteTranslation(id: String) {
        lastDeleted = id
        error?.let { throw it }
    }

    var lastHidden: Pair<String, HideTranslationRequest>? = null
    override suspend fun setTranslationHidden(id: String, body: HideTranslationRequest) {
        lastHidden = id to body
        error?.let { throw it }
    }

    var basqueCalls = 0
    override suspend fun basqueReference(word: String, exact: String?): BasqueReferenceResponseDto {
        basqueCalls++
        lastBasqueExact = exact
        return error?.let { throw it } ?: basque!!
    }

    override suspend fun basqueAutocomplete(term: String): BasqueAutocompleteResponseDto =
        error?.let { throw it } ?: autocomplete

    override suspend fun setKnownStatus(lemmaId: String, body: KnownLemmaRequest): KnownLemmaResponseDto {
        lastSet = lemmaId to body.status
        return error?.let { throw it } ?: known!!
    }
}
