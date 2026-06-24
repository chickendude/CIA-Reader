package com.ciareader.reader.data.language

import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.data.local.CachedCollectionChapterEntity
import com.ciareader.reader.data.local.CachedCollectionDetailEntity
import com.ciareader.reader.data.local.CachedCollectionEntity
import com.ciareader.reader.data.local.CachedLanguageEntity
import com.ciareader.reader.data.local.CachedLibraryCardEntity
import com.ciareader.reader.data.local.LibraryCacheDao
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class LanguageRepositoryTest {

    private fun repo(api: FakeLanguagesApi) = LanguageRepositoryImpl(api, LanguageCache(FakeLibraryCacheDao()))

    @Test
    fun mapsLanguagesAndDetectsRtl() = runTest {
        val api = FakeLanguagesApi(
            languages = listOf(
                lang("hi", "Hindi", "हिन्दी", "Deva", isDefault = true),
                lang("yi", "Yiddish", "ייִדיש", "Hebr"),
            ),
        )

        val result = repo(api).myLanguages()

        assertTrue(result is Outcome.Success)
        val langs = (result as Outcome.Success).data
        assertEquals(listOf("hi", "yi"), langs.map { it.code })
        assertFalse(langs[0].isRtl)   // Devanagari
        assertTrue(langs[1].isRtl)    // Hebrew
        assertTrue(langs[0].isDefault)
    }

    @Test
    fun mapsKnownLemmaCountAndSurvivesCacheRoundTrip() = runTest {
        val api = FakeLanguagesApi(
            languages = listOf(
                lang("hi", "Hindi", "हिन्दी", "Deva", knownLemmaCount = 42),
                lang("mr", "Marathi", "मराठी", "Deva"), // defaults to 0
            ),
        )
        val r = repo(api)

        val online = r.myLanguages()
        assertTrue(online is Outcome.Success)
        val langs = (online as Outcome.Success).data
        assertEquals(42, langs[0].knownLemmaCount)
        assertEquals(0, langs[1].knownLemmaCount)

        // The count is persisted alongside the rest of the row, so the
        // offline switcher still shows "N words".
        api.online = false
        val offline = r.myLanguages()
        assertTrue(offline is Outcome.Success)
        assertEquals(42, (offline as Outcome.Success).data[0].knownLemmaCount)
    }

    @Test
    fun setCurrentReturnsConfirmedCode() = runTest {
        val api = FakeLanguagesApi(languages = emptyList())

        val result = repo(api).setCurrent("mr")

        assertTrue(result is Outcome.Success)
        assertEquals("mr", (result as Outcome.Success).data)
        assertEquals("mr", api.lastSetCode)
    }

    @Test
    fun cachedLanguagesServeWhenOffline() = runTest {
        val api = FakeLanguagesApi(
            languages = listOf(
                lang("hi", "Hindi", "हिन्दी", "Deva"),
                lang("eu", "Basque", "Euskara", "Latn"),
            ),
        )
        val r = repo(api)
        assertTrue(r.myLanguages() is Outcome.Success) // online → caches

        api.online = false
        val offline = r.myLanguages()
        assertTrue(offline is Outcome.Success)
        // Order + RTL flag survive the round-trip, so the switcher + current
        // language still resolve offline.
        assertEquals(listOf("hi", "eu"), (offline as Outcome.Success).data.map { it.code })
    }

    @Test
    fun offlineWithoutCacheFails() = runTest {
        val result = repo(FakeLanguagesApi(languages = emptyList()).apply { online = false }).myLanguages()
        assertTrue(result is Outcome.Failure)
    }

    private fun lang(
        code: String,
        displayName: String,
        nativeName: String,
        script: String,
        isDefault: Boolean = false,
        knownLemmaCount: Int = 0,
    ) = LanguageDto(
        code = code,
        displayName = displayName,
        nativeName = nativeName,
        script = script,
        isDefault = isDefault,
        knownLemmaCount = knownLemmaCount,
    )
}

private class FakeLanguagesApi(
    private val languages: List<LanguageDto>,
    var online: Boolean = true,
) : LanguagesApi {
    var lastSetCode: String? = null
    override suspend fun myLanguages(): LanguagesResponseDto {
        if (!online) throw IOException("offline")
        return LanguagesResponseDto(languages)
    }

    override suspend fun setLanguage(body: SetLanguageRequest): SetLanguageResponseDto {
        lastSetCode = body.code
        return SetLanguageResponseDto(body.code)
    }
}

/** In-memory stand-in for the Room DAO so the repository test stays pure-JVM. */
private class FakeLibraryCacheDao : LibraryCacheDao {
    private val languages = mutableListOf<CachedLanguageEntity>()
    private val cards = mutableListOf<CachedLibraryCardEntity>()
    private val collections = mutableListOf<CachedCollectionEntity>()
    private val details = mutableMapOf<String, CachedCollectionDetailEntity>()
    private val chapters = mutableListOf<CachedCollectionChapterEntity>()

    override suspend fun upsertLanguages(rows: List<CachedLanguageEntity>) {
        rows.forEach { e -> languages.removeAll { it.code == e.code }; languages.add(e) }
    }

    override suspend fun languages() = languages.sortedBy { it.position }
    override suspend fun clearLanguages() = languages.clear()

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
