package com.ciareader.reader.ui.reader

import androidx.lifecycle.SavedStateHandle
import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.data.dictionary.DictionaryRepository
import com.ciareader.reader.data.dictionary.LemmaTranslations
import com.ciareader.reader.data.dictionary.WordTranslation
import com.ciareader.reader.data.reader.Chapter
import com.ciareader.reader.data.reader.ChapterRef
import com.ciareader.reader.data.reader.KnownStatus
import com.ciareader.reader.data.reader.ReaderRepository
import com.ciareader.reader.data.reader.ReaderToken
import com.ciareader.reader.data.reader.TextMeta
import com.ciareader.reader.util.MainDispatcherRule
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ReaderViewModelTest {

    @get:Rule
    val mainRule = MainDispatcherRule()

    private fun vm(repo: ReaderRepository, dict: DictionaryRepository = FakeDictionaryRepository()) =
        ReaderViewModel(repo, dict, SavedStateHandle(mapOf("textId" to "t1")))

    @Test
    fun loadsTitleAndFirstChapter() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(
            meta = meta(chapterCount = 2),
            chapters = mapOf(0 to Chapter(0, listOf(word("नमस्ते")))),
        )
        val v = vm(repo)
        advanceUntilIdle()

        val s = v.state.value
        assertEquals("Book", s.title)
        assertEquals(2, s.chapterCount)
        assertEquals(1, s.tokens.size)
        assertFalse(s.isLoading)
        assertNull(s.errorMessage)
    }

    @Test
    fun metaErrorSurfaces() = runTest(mainRule.dispatcher) {
        val v = vm(FakeReaderRepository(metaError = "boom"))
        advanceUntilIdle()
        assertEquals("boom", v.state.value.errorMessage)
        assertFalse(v.state.value.isLoading)
    }

    @Test
    fun wordTapSelectsAndDismissClears() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, listOf(word("x")))))
        val v = vm(repo)
        advanceUntilIdle()

        val w = word("x")
        v.onWordTap(w)
        assertEquals(w, v.state.value.selectedWord)
        v.dismissWord()
        assertNull(v.state.value.selectedWord)
    }

    @Test
    fun tappingPunctuationDoesNotSelect() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, emptyList())))
        val v = vm(repo)
        advanceUntilIdle()

        v.onWordTap(ReaderToken(0, "।", false, KnownStatus.UNKNOWN, null, null, null, false, false, false))
        assertNull(v.state.value.selectedWord)
    }

    @Test
    fun wordTapFetchesTranslations() = runTest(mainRule.dispatcher) {
        val w = ReaderToken(0, "नमस्ते", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, listOf(w))))
        val dict = FakeDictionaryRepository(
            translations = LemmaTranslations(
                headword = "नमस्ते",
                pos = "INTJ",
                gloss = "hello",
                personal = emptyList(),
                official = listOf(WordTranslation("greeting", null)),
                community = emptyList(),
            ),
        )
        val v = vm(repo, dict)
        advanceUntilIdle()

        v.onWordTap(w)
        advanceUntilIdle()

        assertNotNull(v.state.value.wordTranslations)
        assertEquals("नमस्ते", v.state.value.wordTranslations?.headword)
        assertFalse(v.state.value.isWordLoading)
    }

    @Test
    fun setStatusRecolorsTokensAndSelectedWord() = runTest(mainRule.dispatcher) {
        val w = ReaderToken(0, "नमस्ते", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, listOf(w))))
        val v = vm(repo)
        advanceUntilIdle()

        v.onWordTap(w)
        advanceUntilIdle()
        v.setStatus(KnownStatus.KNOWN)
        advanceUntilIdle()

        assertEquals(KnownStatus.KNOWN, v.state.value.tokens[0].status)
        assertEquals(KnownStatus.KNOWN, v.state.value.selectedWord?.status)
    }

    @Test
    fun nextChapterLoadsThatChapter() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(
            meta = meta(2),
            chapters = mapOf(
                0 to Chapter(0, listOf(word("a"))),
                1 to Chapter(1, listOf(word("b"), word("c"))),
            ),
        )
        val v = vm(repo)
        advanceUntilIdle()

        v.nextChapter()
        advanceUntilIdle()

        assertEquals(1, v.state.value.chapterIdx)
        assertEquals(2, v.state.value.tokens.size)
    }

    private fun word(surface: String) =
        ReaderToken(0, surface, true, KnownStatus.UNKNOWN, null, null, null, false, false, false)

    private fun meta(chapterCount: Int) = TextMeta(
        id = "t1",
        title = "Book",
        language = "hi",
        status = "ready",
        chapterCount = chapterCount,
        chapters = (0 until chapterCount).map { ChapterRef(it, "c$it", 1) },
    )
}

private class FakeReaderRepository(
    private val meta: TextMeta? = null,
    private val chapters: Map<Int, Chapter> = emptyMap(),
    private val metaError: String? = null,
    private val chapterError: String? = null,
) : ReaderRepository {
    override suspend fun textMeta(textId: String): Outcome<TextMeta> =
        metaError?.let { Outcome.Failure(it) } ?: Outcome.Success(meta!!)

    override suspend fun chapter(textId: String, chapterIdx: Int): Outcome<Chapter> =
        chapterError?.let { Outcome.Failure(it) }
            ?: Outcome.Success(chapters[chapterIdx] ?: Chapter(chapterIdx, emptyList()))
}

private class FakeDictionaryRepository(
    private val translations: LemmaTranslations? = null,
) : DictionaryRepository {
    override suspend fun translations(lemmaId: String): Outcome<LemmaTranslations> =
        translations?.let { Outcome.Success(it) } ?: Outcome.Failure("no translations")

    override suspend fun setStatus(lemmaId: String, status: KnownStatus): Outcome<KnownStatus> =
        Outcome.Success(status)
}
