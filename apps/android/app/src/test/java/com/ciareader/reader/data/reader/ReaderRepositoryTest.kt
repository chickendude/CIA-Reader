package com.ciareader.reader.data.reader

import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.data.local.CachedChapterEntity
import com.ciareader.reader.data.local.CachedChapterRefEntity
import com.ciareader.reader.data.local.CachedTextEntity
import com.ciareader.reader.data.local.ReaderCacheDao
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

class ReaderRepositoryTest {

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private fun repo(api: FakeReaderApi, dao: ReaderCacheDao = FakeReaderCacheDao()) =
        ReaderRepositoryImpl(api, ReaderCache(dao, json))

    @Test
    fun mapsChapterTokensToDomain() = runTest {
        val api = FakeReaderApi(
            chapter = ChapterTokensDto(
                chapterId = "c1",
                chapterIdx = 0,
                body = "नमस्ते।",
                tokens = listOf(
                    TokenDto(idx = 0, surface = "नमस्ते", isWord = true, status = "learning", lemmaId = "l1", hasDefinition = true),
                    TokenDto(idx = 1, surface = "।", isWord = false, status = "unknown"),
                ),
            ),
        )

        val result = repo(api).chapter("t1", 0)

        assertTrue(result is Outcome.Success)
        val chapter = (result as Outcome.Success).data
        assertEquals(0, chapter.chapterIdx)
        assertEquals(2, chapter.tokens.size)
        assertEquals(KnownStatus.LEARNING, chapter.tokens[0].status)
        assertTrue(chapter.tokens[0].isWord)
        assertEquals("l1", chapter.tokens[0].lemmaId)
        assertEquals(KnownStatus.UNKNOWN, chapter.tokens[1].status)
        assertEquals(false, chapter.tokens[1].isWord)
    }

    @Test
    fun mapsTextMetaAndFillsUntitledChapters() = runTest {
        val api = FakeReaderApi(
            meta = TextMetaDto(
                text = TextMetaTextDto(id = "t1", title = "My Book", language = "hi", status = "ready"),
                chapterCount = 2,
                chapters = listOf(
                    ChapterRefDto(idx = 0, title = "Intro", tokenCount = 120),
                    ChapterRefDto(idx = 1, title = null, tokenCount = 80),
                ),
            ),
        )

        val result = repo(api).textMeta("t1")

        assertTrue(result is Outcome.Success)
        val meta = (result as Outcome.Success).data
        assertEquals("My Book", meta.title)
        assertEquals(2, meta.chapterCount)
        assertEquals("Intro", meta.chapters[0].title)
        assertEquals("Untitled", meta.chapters[1].title)
    }

    @Test
    fun mapsHttpErrorToFailure() = runTest {
        val result = repo(FakeReaderApi(error = http(404))).chapter("missing", 0)
        assertTrue(result is Outcome.Failure)
        assertEquals("Not found.", (result as Outcome.Failure).message)
    }

    @Test
    fun mapsProgressToDomain() = runTest {
        val api = FakeReaderApi(
            progress = TextProgressEnvelopeDto(TextProgressDto(lastChapterIdx = 2, lastTokenIdx = 40, pctRead = 15.0)),
        )
        val result = repo(api).progress("t1")
        assertTrue(result is Outcome.Success)
        val p = (result as Outcome.Success).data
        assertEquals(2, p?.chapterIdx)
        assertEquals(40, p?.tokenIdx)
    }

    @Test
    fun mapsNullProgressToNull() = runTest {
        val result = repo(FakeReaderApi()).progress("t1")
        assertTrue(result is Outcome.Success)
        assertEquals(null, (result as Outcome.Success).data)
    }

    @Test
    fun saveProgressSendsValues() = runTest {
        val api = FakeReaderApi()
        val result = repo(api).saveProgress("t1", chapterIdx = 1, tokenIdx = 9, pctRead = 33.0)
        assertTrue(result is Outcome.Success)
        assertEquals(SaveProgressRequest(1, 9, 33.0), api.lastSaved)
    }

    // --- offline cache (Phase 5) ---

    @Test
    fun cachedTextMetaServesWhenOffline() = runTest {
        val api = FakeReaderApi(
            meta = TextMetaDto(
                text = TextMetaTextDto("t1", "My Book", "hi", "ready"),
                chapterCount = 2,
                chapters = listOf(ChapterRefDto(0, "One", 3), ChapterRefDto(1, "Two", 5)),
            ),
        )
        val r = repo(api)
        assertTrue(r.textMeta("t1") is Outcome.Success) // online → caches

        api.online = false
        val offline = r.textMeta("t1")
        assertTrue(offline is Outcome.Success)
        assertEquals("My Book", (offline as Outcome.Success).data.title)
        assertEquals(listOf(0, 1), offline.data.chapters.map { it.idx })
    }

    @Test
    fun cachedChapterTokensRoundTripWhenOffline() = runTest {
        val api = FakeReaderApi(
            chapter = ChapterTokensDto(
                chapterId = "c0",
                chapterIdx = 0,
                tokens = listOf(
                    TokenDto(0, "नमस्ते", isWord = true, status = "learning", lemmaId = "l1", romanization = "namaste", hasDefinition = true),
                ),
            ),
        )
        val r = repo(api)
        assertTrue(r.chapter("t1", 0) is Outcome.Success) // online → caches

        api.online = false
        val offline = r.chapter("t1", 0)
        assertTrue(offline is Outcome.Success)
        val first = (offline as Outcome.Success).data.tokens.first()
        assertEquals("नमस्ते", first.surface)
        assertEquals(KnownStatus.LEARNING, first.status)
        assertEquals("namaste", first.romanization)
        assertTrue(first.isWord)
    }

    @Test
    fun offlineWithoutCacheFails() = runTest {
        val r = repo(FakeReaderApi(meta = null, chapter = null).apply { online = false })
        assertTrue(r.textMeta("t1") is Outcome.Failure)
        assertTrue(r.chapter("t1", 0) is Outcome.Failure)
    }

    private fun http(code: Int) =
        HttpException(Response.error<Any>(code, "e".toResponseBody("text/plain".toMediaType())))
}

private class FakeReaderApi(
    private val meta: TextMetaDto? = null,
    private val chapter: ChapterTokensDto? = null,
    private val progress: TextProgressEnvelopeDto = TextProgressEnvelopeDto(progress = null),
    private val error: Throwable? = null,
    /** Flip to false to simulate going offline mid-session (throws like the transport would). */
    var online: Boolean = true,
) : ReaderApi {
    var lastSaved: SaveProgressRequest? = null

    private fun guard() {
        if (!online) throw IOException("offline")
        error?.let { throw it }
    }

    override suspend fun textMeta(textId: String): TextMetaDto {
        guard(); return meta!!
    }

    override suspend fun chapterTokens(textId: String, chapterIdx: Int): ChapterTokensDto {
        guard(); return chapter!!
    }

    override suspend fun progress(textId: String): TextProgressEnvelopeDto {
        guard(); return progress
    }

    override suspend fun saveProgress(textId: String, body: SaveProgressRequest): TextProgressEnvelopeDto {
        lastSaved = body
        return TextProgressEnvelopeDto(progress = TextProgressDto(body.chapterIdx, body.tokenIdx, body.pctRead))
    }
}

/** In-memory stand-in for the Room DAO so the repository test stays pure-JVM. */
private class FakeReaderCacheDao : ReaderCacheDao {
    private val texts = mutableMapOf<String, CachedTextEntity>()
    private val refs = mutableMapOf<String, MutableList<CachedChapterRefEntity>>()
    private val chapters = mutableMapOf<Pair<String, Int>, CachedChapterEntity>()

    override suspend fun upsertText(text: CachedTextEntity) {
        texts[text.textId] = text
    }

    override suspend fun text(textId: String): CachedTextEntity? = texts[textId]

    override suspend fun upsertChapterRefs(refs: List<CachedChapterRefEntity>) {
        refs.forEach { ref ->
            val list = this.refs.getOrPut(ref.textId) { mutableListOf() }
            list.removeAll { it.idx == ref.idx }
            list.add(ref)
        }
    }

    override suspend fun chapterRefs(textId: String): List<CachedChapterRefEntity> =
        refs[textId].orEmpty().sortedBy { it.idx }

    override suspend fun upsertChapter(chapter: CachedChapterEntity) {
        chapters[chapter.textId to chapter.chapterIdx] = chapter
    }

    override suspend fun chapter(textId: String, chapterIdx: Int): CachedChapterEntity? =
        chapters[textId to chapterIdx]

    override suspend fun deleteText(textId: String) {
        texts.remove(textId)
    }

    override suspend fun deleteChapterRefs(textId: String) {
        refs.remove(textId)
    }

    override suspend fun deleteChapters(textId: String) {
        chapters.keys.removeAll { it.first == textId }
    }
}
