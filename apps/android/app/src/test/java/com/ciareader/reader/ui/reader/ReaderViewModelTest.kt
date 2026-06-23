package com.ciareader.reader.ui.reader

import androidx.lifecycle.SavedStateHandle
import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.core.settings.SettingsStore
import com.ciareader.reader.data.collection.CollectionChapter
import com.ciareader.reader.data.collection.CollectionDetail
import com.ciareader.reader.data.collection.CollectionRepository
import com.ciareader.reader.data.collection.CollectionSummary
import com.ciareader.reader.data.dictionary.DictionaryRepository
import com.ciareader.reader.data.dictionary.LemmaTranslations
import com.ciareader.reader.data.dictionary.WordTranslation
import com.ciareader.reader.data.reader.Chapter
import com.ciareader.reader.data.reader.ChapterRef
import com.ciareader.reader.data.reader.KnownStatus
import com.ciareader.reader.data.reader.ReaderRepository
import com.ciareader.reader.data.reader.ReaderToken
import com.ciareader.reader.data.reader.ReadingProgress
import com.ciareader.reader.data.reader.TextMeta
import com.ciareader.reader.util.MainDispatcherRule
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ReaderViewModelTest {

    @get:Rule
    val mainRule = MainDispatcherRule()

    private fun vm(
        repo: ReaderRepository,
        dict: DictionaryRepository = FakeDictionaryRepository(),
        settings: SettingsStore = FakeSettingsStore(),
        collections: CollectionRepository = FakeCollectionRepository(),
        collectionId: String? = null,
        atEnd: Boolean = false,
    ) = ReaderViewModel(
        repo,
        dict,
        settings,
        collections,
        SavedStateHandle(
            buildMap {
                put("textId", "t1")
                collectionId?.let { put("collectionId", it) }
                if (atEnd) put("atEnd", true)
            },
        ),
    )

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

    @Test
    fun restoresSavedChapterAndToken() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(
            meta = meta(2),
            chapters = mapOf(0 to Chapter(0, listOf(word("a"))), 1 to Chapter(1, listOf(word("b")))),
            savedProgress = ReadingProgress(chapterIdx = 1, tokenIdx = 7, pctRead = 42.0),
        )
        val v = vm(repo)
        advanceUntilIdle()

        assertEquals(1, v.state.value.chapterIdx)
        assertEquals(7, v.state.value.restoreTokenIdx)
    }

    @Test
    fun recordPositionWritesDebouncedProgress() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, listOf(word("a")))))
        val v = vm(repo)
        advanceUntilIdle()

        v.recordPosition(tokenIdx = 12, pctRead = 30.0)
        advanceUntilIdle()

        assertEquals(ReadingProgress(0, 12, 30.0), repo.lastSaved)
    }

    @Test
    fun togglesRomanizationAndPersists() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, listOf(word("a")))))
        val settings = FakeSettingsStore(romanization = false)
        val v = vm(repo, settings = settings)
        advanceUntilIdle()

        assertFalse(v.state.value.romanize)
        v.toggleRomanization()
        advanceUntilIdle()

        assertTrue(v.state.value.romanize)
        assertEquals(true, settings.lastSetRomanization)
    }

    @Test
    fun restoresRomanizationPreference() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, listOf(word("a")))))
        val v = vm(repo, settings = FakeSettingsStore(romanization = true))
        advanceUntilIdle()

        assertTrue(v.state.value.romanize)
    }

    @Test
    fun togglesPageModeAndPersists() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, listOf(word("a")))))
        val settings = FakeSettingsStore(paged = false)
        val v = vm(repo, settings = settings)
        advanceUntilIdle()

        assertFalse(v.state.value.pageMode)
        v.togglePageMode()
        advanceUntilIdle()

        assertTrue(v.state.value.pageMode)
        assertEquals(true, settings.lastSetPageMode)
    }

    @Test
    fun restoresPageModePreference() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, listOf(word("a")))))
        val v = vm(repo, settings = FakeSettingsStore(paged = true))
        advanceUntilIdle()

        assertTrue(v.state.value.pageMode)
    }

    @Test
    fun marksRtlForHebrewScriptLanguage() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(meta = meta(1, language = "yi"), chapters = mapOf(0 to Chapter(0, emptyList())))
        val v = vm(repo)
        advanceUntilIdle()

        assertTrue(v.state.value.isRtl)
    }

    @Test
    fun leftToRightForOtherLanguages() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(meta = meta(1, language = "hi"), chapters = mapOf(0 to Chapter(0, emptyList())))
        val v = vm(repo)
        advanceUntilIdle()

        assertFalse(v.state.value.isRtl)
    }

    @Test
    fun exposesSiblingChaptersWhenReadingABook() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, emptyList())))
        val collections = FakeCollectionRepository(
            detail = CollectionDetail(
                id = "c1",
                title = "Book",
                chapters = listOf(
                    CollectionChapter("t0", "One", 0, "ready", wordCount = 100),
                    CollectionChapter("t1", "Two", 1, "ready", wordCount = 200),
                    CollectionChapter("t2", "Three", 2, "ready", wordCount = 300),
                ),
            ),
        )
        val v = vm(repo, collections = collections, collectionId = "c1")
        advanceUntilIdle()

        assertEquals("t0", v.state.value.prevTextId)
        assertEquals("t2", v.state.value.nextTextId)
        assertTrue(v.state.value.canGoPrev)
        assertTrue(v.state.value.canGoNext)
        // Full chapter list for the TOC, with the current chapter flagged.
        assertEquals(listOf("t0", "t1", "t2"), v.state.value.chapters.map { it.textId })
        assertTrue(v.state.value.chapters[1].isCurrent)
        assertEquals(200, v.state.value.chapters[1].wordCount)
    }

    @Test
    fun noSiblingNavWithoutCollection() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, emptyList())))
        val v = vm(repo)
        advanceUntilIdle()

        assertNull(v.state.value.prevTextId)
        assertNull(v.state.value.nextTextId)
        assertFalse(v.state.value.canGoPrev)
        assertFalse(v.state.value.canGoNext)
    }

    @Test
    fun setFontSizeClampsAndPersists() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, listOf(word("a")))))
        val settings = FakeSettingsStore()
        val v = vm(repo, settings = settings)
        advanceUntilIdle()

        v.setFontSize(22)
        advanceUntilIdle()
        assertEquals(22, v.state.value.fontSize)
        assertEquals(22, settings.lastSetFontSize)

        v.setFontSize(999)
        advanceUntilIdle()
        assertEquals(28, v.state.value.fontSize) // clamped to max
    }

    @Test
    fun restoresFontSettings() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, listOf(word("a")))))
        val v = vm(repo, settings = FakeSettingsStore(fontSize = 24, lineSpacingValue = 2.0f))
        advanceUntilIdle()

        assertEquals(24, v.state.value.fontSize)
        assertEquals(2.0f, v.state.value.lineSpacing, 0.0001f)
    }

    @Test
    fun fontChangeReanchorsToCurrentTopWord() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, listOf(word("a")))))
        val v = vm(repo)
        advanceUntilIdle()

        v.recordPosition(tokenIdx = 5, pctRead = 20.0) // user scrolled; top word = token 5
        advanceUntilIdle()
        v.setFontSize(22)

        assertEquals(5, v.state.value.restoreTokenIdx)
    }

    @Test
    fun bookProgressIsEvenAcrossChaptersWithoutWordCounts() {
        val s = ReaderUiState(
            chapters = listOf(
                ReaderChapterRef("a", "t0", null, isCurrent = false),
                ReaderChapterRef("b", "t1", null, isCurrent = true),
                ReaderChapterRef("c", "t2", null, isCurrent = false),
                ReaderChapterRef("d", "t3", null, isCurrent = false),
            ),
            progress = 0.5f,
        )
        assertEquals(0.375f, s.bookProgress, 0.0001f) // (1 + 0.5) / 4
    }

    @Test
    fun bookProgressIsWeightedByWordCounts() {
        val s = ReaderUiState(
            chapters = listOf(
                ReaderChapterRef("a", "t0", null, isCurrent = false, wordCount = 100),
                ReaderChapterRef("b", "t1", null, isCurrent = true, wordCount = 300),
            ),
            progress = 0.5f,
        )
        assertEquals(0.625f, s.bookProgress, 0.0001f) // (100 + 0.5*300) / 400
    }

    @Test
    fun goingBackOpensChapterAtItsLastToken() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(
            meta = meta(1),
            chapters = mapOf(0 to Chapter(0, listOf(word("a"), word("b"), word("c")))),
        )
        val v = vm(repo, atEnd = true)
        advanceUntilIdle()

        assertEquals(2, v.state.value.restoreTokenIdx) // last of 3 tokens
    }

    @Test
    fun savesAndRestoresReadingSpot() = runTest(mainRule.dispatcher) {
        // A repo that actually persists progress, like the server round-trip.
        val repo = SavingReaderRepository(
            meta = meta(1),
            chapterTokens = listOf(word("a"), word("b"), word("c")),
        )

        // Read to token 2 and let the debounced save fire.
        val first = vm(repo)
        advanceUntilIdle()
        first.recordPosition(tokenIdx = 2, pctRead = 66.0)
        advanceUntilIdle()

        // Reopen the same text → it resumes at the saved token.
        val reopened = vm(repo)
        advanceUntilIdle()
        assertEquals(2, reopened.state.value.restoreTokenIdx)
    }

    private fun word(surface: String) =
        ReaderToken(0, surface, true, KnownStatus.UNKNOWN, null, null, null, false, false, false)

    private fun meta(chapterCount: Int, language: String = "hi") = TextMeta(
        id = "t1",
        title = "Book",
        language = language,
        status = "ready",
        chapterCount = chapterCount,
        chapters = (0 until chapterCount).map { ChapterRef(it, "c$it", 1) },
    )
}

/** Persists progress in-memory so a reopened reader resumes — a round-trip. */
private class SavingReaderRepository(
    private val meta: TextMeta,
    private val chapterTokens: List<ReaderToken>,
) : ReaderRepository {
    private var saved: ReadingProgress? = null
    override suspend fun textMeta(textId: String): Outcome<TextMeta> = Outcome.Success(meta)
    override suspend fun chapter(textId: String, chapterIdx: Int): Outcome<Chapter> =
        Outcome.Success(Chapter(chapterIdx, chapterTokens))
    override suspend fun progress(textId: String): Outcome<ReadingProgress?> = Outcome.Success(saved)
    override suspend fun saveProgress(
        textId: String,
        chapterIdx: Int,
        tokenIdx: Int,
        pctRead: Double,
    ): Outcome<Unit> {
        saved = ReadingProgress(chapterIdx, tokenIdx, pctRead)
        return Outcome.Success(Unit)
    }
}

private class FakeReaderRepository(
    private val meta: TextMeta? = null,
    private val chapters: Map<Int, Chapter> = emptyMap(),
    private val metaError: String? = null,
    private val chapterError: String? = null,
    private val savedProgress: ReadingProgress? = null,
) : ReaderRepository {
    var lastSaved: ReadingProgress? = null

    override suspend fun textMeta(textId: String): Outcome<TextMeta> =
        metaError?.let { Outcome.Failure(it) } ?: Outcome.Success(meta!!)

    override suspend fun chapter(textId: String, chapterIdx: Int): Outcome<Chapter> =
        chapterError?.let { Outcome.Failure(it) }
            ?: Outcome.Success(chapters[chapterIdx] ?: Chapter(chapterIdx, emptyList()))

    override suspend fun progress(textId: String): Outcome<ReadingProgress?> =
        Outcome.Success(savedProgress)

    override suspend fun saveProgress(
        textId: String,
        chapterIdx: Int,
        tokenIdx: Int,
        pctRead: Double,
    ): Outcome<Unit> {
        lastSaved = ReadingProgress(chapterIdx, tokenIdx, pctRead)
        return Outcome.Success(Unit)
    }
}

private class FakeDictionaryRepository(
    private val translations: LemmaTranslations? = null,
) : DictionaryRepository {
    override suspend fun translations(lemmaId: String): Outcome<LemmaTranslations> =
        translations?.let { Outcome.Success(it) } ?: Outcome.Failure("no translations")

    override suspend fun setStatus(lemmaId: String, status: KnownStatus): Outcome<KnownStatus> =
        Outcome.Success(status)
}

private class FakeSettingsStore(
    private val romanization: Boolean = false,
    private val paged: Boolean = false,
    private val fontSize: Int = 18,
    private val lineSpacingValue: Float = 1.5f,
) : SettingsStore {
    var lastSetRomanization: Boolean? = null
    var lastSetPageMode: Boolean? = null
    override val currentLanguage: Flow<String?> = MutableStateFlow(null)
    override suspend fun currentLanguage(): String? = null
    override suspend fun setCurrentLanguage(code: String) {}
    override suspend fun showRomanization(): Boolean = romanization
    override suspend fun setShowRomanization(value: Boolean) {
        lastSetRomanization = value
    }
    override suspend fun pageMode(): Boolean = paged
    override suspend fun setPageMode(value: Boolean) {
        lastSetPageMode = value
    }

    var lastSetFontSize: Int? = null
    var lastSetLineSpacing: Float? = null
    override suspend fun fontSizeSp(): Int = fontSize
    override suspend fun setFontSizeSp(value: Int) {
        lastSetFontSize = value
    }
    override suspend fun lineSpacing(): Float = lineSpacingValue
    override suspend fun setLineSpacing(value: Float) {
        lastSetLineSpacing = value
    }
}

private class FakeCollectionRepository(
    private val detail: CollectionDetail? = null,
) : CollectionRepository {
    override suspend fun myCollections(): Outcome<List<CollectionSummary>> = Outcome.Success(emptyList())
    override suspend fun detail(collectionId: String): Outcome<CollectionDetail> =
        detail?.let { Outcome.Success(it) } ?: Outcome.Failure("no detail")
}
