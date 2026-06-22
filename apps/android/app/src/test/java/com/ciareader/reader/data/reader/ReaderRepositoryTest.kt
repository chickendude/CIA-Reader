package com.ciareader.reader.data.reader

import com.ciareader.reader.core.network.Outcome
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class ReaderRepositoryTest {

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
        val repo = ReaderRepositoryImpl(api)

        val result = repo.chapter("t1", 0)

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
        val repo = ReaderRepositoryImpl(api)

        val result = repo.textMeta("t1")

        assertTrue(result is Outcome.Success)
        val meta = (result as Outcome.Success).data
        assertEquals("My Book", meta.title)
        assertEquals(2, meta.chapterCount)
        assertEquals("Intro", meta.chapters[0].title)
        assertEquals("Untitled", meta.chapters[1].title)
    }

    @Test
    fun mapsHttpErrorToFailure() = runTest {
        val repo = ReaderRepositoryImpl(FakeReaderApi(error = http(404)))
        val result = repo.chapter("missing", 0)
        assertTrue(result is Outcome.Failure)
        assertEquals("Not found.", (result as Outcome.Failure).message)
    }

    @Test
    fun mapsProgressToDomain() = runTest {
        val api = FakeReaderApi(
            progress = TextProgressEnvelopeDto(TextProgressDto(lastChapterIdx = 2, lastTokenIdx = 40, pctRead = 15.0)),
        )
        val result = ReaderRepositoryImpl(api).progress("t1")
        assertTrue(result is Outcome.Success)
        val p = (result as Outcome.Success).data
        assertEquals(2, p?.chapterIdx)
        assertEquals(40, p?.tokenIdx)
    }

    @Test
    fun mapsNullProgressToNull() = runTest {
        val result = ReaderRepositoryImpl(FakeReaderApi()).progress("t1")
        assertTrue(result is Outcome.Success)
        assertEquals(null, (result as Outcome.Success).data)
    }

    @Test
    fun saveProgressSendsValues() = runTest {
        val api = FakeReaderApi()
        val result = ReaderRepositoryImpl(api).saveProgress("t1", chapterIdx = 1, tokenIdx = 9, pctRead = 33.0)
        assertTrue(result is Outcome.Success)
        assertEquals(SaveProgressRequest(1, 9, 33.0), api.lastSaved)
    }

    private fun http(code: Int) =
        HttpException(Response.error<Any>(code, "e".toResponseBody("text/plain".toMediaType())))
}

private class FakeReaderApi(
    private val meta: TextMetaDto? = null,
    private val chapter: ChapterTokensDto? = null,
    private val progress: TextProgressEnvelopeDto = TextProgressEnvelopeDto(progress = null),
    private val error: Throwable? = null,
) : ReaderApi {
    var lastSaved: SaveProgressRequest? = null

    override suspend fun textMeta(textId: String): TextMetaDto = error?.let { throw it } ?: meta!!
    override suspend fun chapterTokens(textId: String, chapterIdx: Int): ChapterTokensDto =
        error?.let { throw it } ?: chapter!!

    override suspend fun progress(textId: String): TextProgressEnvelopeDto = error?.let { throw it } ?: progress

    override suspend fun saveProgress(textId: String, body: SaveProgressRequest): TextProgressEnvelopeDto {
        lastSaved = body
        return TextProgressEnvelopeDto(progress = TextProgressDto(body.chapterIdx, body.tokenIdx, body.pctRead))
    }
}
