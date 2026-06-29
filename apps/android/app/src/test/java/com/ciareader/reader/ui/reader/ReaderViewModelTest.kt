package com.ciareader.reader.ui.reader

import androidx.lifecycle.SavedStateHandle
import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.core.settings.ReadingTimeStore
import com.ciareader.reader.core.settings.SettingsStore
import com.ciareader.reader.data.collection.CollectionChapter
import com.ciareader.reader.data.collection.CollectionDetail
import com.ciareader.reader.data.collection.CollectionRepository
import com.ciareader.reader.data.collection.CollectionSummary
import com.ciareader.reader.data.dictionary.BasqueReference
import com.ciareader.reader.data.dictionary.DictionaryRepository
import com.ciareader.reader.data.dictionary.LemmaTranslations
import com.ciareader.reader.data.dictionary.WordTranslation
import com.ciareader.reader.data.reader.Chapter
import com.ciareader.reader.data.reader.ChapterRef
import com.ciareader.reader.data.reader.KnownStatus
import com.ciareader.reader.data.reader.ParseCandidate
import com.ciareader.reader.data.reader.ReaderRepository
import com.ciareader.reader.data.reader.ReaderToken
import com.ciareader.reader.data.reader.ReadingProgress
import com.ciareader.reader.data.reader.SentenceTranslation
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
        readingTime: FakeReadingTimeStore = FakeReadingTimeStore(),
        collectionId: String? = null,
        atEnd: Boolean = false,
        resume: Boolean = true,
    ) = ReaderViewModel(
        repo,
        dict,
        settings,
        collections,
        readingTime,
        SavedStateHandle(
            buildMap {
                put("textId", "t1")
                collectionId?.let { put("collectionId", it) }
                if (atEnd) put("atEnd", true)
                if (!resume) put("resume", false)
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
    fun readingTimeAccruesBetweenVisibleAndHidden() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(
            meta = meta(1, language = "hi"),
            chapters = mapOf(0 to Chapter(0, emptyList())),
        )
        val timeStore = FakeReadingTimeStore()
        val v = vm(repo, readingTime = timeStore)
        advanceUntilIdle()

        var now = 1_000L
        v.clock = { now }
        v.onScreenVisible()
        now = 31_000L // 30s later
        v.onScreenHidden()
        advanceUntilIdle()

        assertEquals(30_000L, timeStore.readingTimeMs("hi"))
    }

    @Test
    fun readingTimeAccumulatesAcrossSessions() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, emptyList())))
        val timeStore = FakeReadingTimeStore()
        val v = vm(repo, readingTime = timeStore)
        advanceUntilIdle()

        var now = 0L
        v.clock = { now }
        v.onScreenVisible(); now = 10_000L; v.onScreenHidden()
        now = 50_000L; v.onScreenVisible(); now = 55_000L; v.onScreenHidden()
        advanceUntilIdle()

        assertEquals(15_000L, timeStore.readingTimeMs("hi"))
    }

    @Test
    fun secondVisibleWithoutHiddenIsIdempotent() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, emptyList())))
        val timeStore = FakeReadingTimeStore()
        val v = vm(repo, readingTime = timeStore)
        advanceUntilIdle()

        var now = 0L
        v.clock = { now }
        v.onScreenVisible()
        now = 5_000L
        v.onScreenVisible() // ignored — should not reset the start time
        now = 20_000L
        v.onScreenHidden()
        advanceUntilIdle()

        // Elapsed measured from the first onScreenVisible (0), not the second.
        assertEquals(20_000L, timeStore.readingTimeMs("hi"))
    }

    @Test
    fun hiddenWithoutVisibleRecordsNothing() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, emptyList())))
        val timeStore = FakeReadingTimeStore()
        val v = vm(repo, readingTime = timeStore)
        advanceUntilIdle()

        v.onScreenHidden()
        advanceUntilIdle()
        assertEquals(0L, timeStore.totalReadingTimeMs())
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
    fun wordTapDefaultsActiveParseToChosenLemma() = runTest(mainRule.dispatcher) {
        val w = ReaderToken(0, "सोने", true, KnownStatus.UNKNOWN, "l-gold", null, null, false, true, true)
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, listOf(w))))
        val dict = FakeDictionaryRepository(translations = translations("सोना", "gold"))
        val v = vm(repo, dict)
        advanceUntilIdle()

        v.onWordTap(w)
        advanceUntilIdle()

        assertEquals("l-gold", v.state.value.activeParseLemmaId)
        // The chosen lemma's headword/POS are captured for the primary chip label.
        assertEquals("सोना", v.state.value.primaryHeadword)
    }

    @Test
    fun selectParseLoadsAlternateDefinition() = runTest(mainRule.dispatcher) {
        val w = ReaderToken(
            idx = 0, surface = "सोने", isWord = true, status = KnownStatus.UNKNOWN,
            lemmaId = "l-gold", romanization = null, glossDefault = null,
            isOov = false, isAmbiguous = true, hasDefinition = true,
            candidates = listOf(ParseCandidate("l-sleep", "सोना", "VERB", "to sleep")),
        )
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, listOf(w))))
        val dict = FakeDictionaryRepository(
            byLemma = mapOf(
                "l-gold" to translations("सोना", "gold"),
                "l-sleep" to translations("सोना", "to sleep"),
            ),
        )
        val v = vm(repo, dict)
        advanceUntilIdle()

        v.onWordTap(w)
        advanceUntilIdle()
        assertEquals("gold", v.state.value.wordTranslations?.official?.first()?.body)

        v.selectParse("l-sleep")
        advanceUntilIdle()

        assertEquals("l-sleep", v.state.value.activeParseLemmaId)
        assertEquals("to sleep", v.state.value.wordTranslations?.official?.first()?.body)
        // The primary chip label stays anchored to the parser's chosen lemma.
        assertEquals("सोना", v.state.value.primaryHeadword)
        assertEquals(listOf("l-gold", "l-sleep"), dict.requestedLemmaIds)
    }

    @Test
    fun selectParseIsNoopForAlreadyActiveParse() = runTest(mainRule.dispatcher) {
        val w = ReaderToken(0, "सोने", true, KnownStatus.UNKNOWN, "l-gold", null, null, false, true, true)
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, listOf(w))))
        val dict = FakeDictionaryRepository(translations = translations("सोना", "gold"))
        val v = vm(repo, dict)
        advanceUntilIdle()

        v.onWordTap(w)
        advanceUntilIdle()
        v.selectParse("l-gold") // already the active parse
        advanceUntilIdle()

        // Only the initial tap fetched; the redundant select didn't refetch.
        assertEquals(listOf("l-gold"), dict.requestedLemmaIds)
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
    fun setStatusRecolorsImmediatelyBeforeNetwork() = runTest(mainRule.dispatcher) {
        val w = ReaderToken(0, "नमस्ते", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, listOf(w))))
        val v = vm(repo)
        advanceUntilIdle()

        v.onWordTap(w)
        advanceUntilIdle()
        v.setStatus(KnownStatus.KNOWN)
        // No advanceUntilIdle: the network coroutine hasn't run yet, but the
        // optimistic recolor must already be visible so the popup can close.
        assertEquals(KnownStatus.KNOWN, v.state.value.tokens[0].status)
        assertEquals(KnownStatus.KNOWN, v.state.value.selectedWord?.status)
    }

    @Test
    fun setStatusRollsBackWhenNetworkFails() = runTest(mainRule.dispatcher) {
        val w = ReaderToken(0, "नमस्ते", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, listOf(w))))
        val v = vm(repo, dict = FakeDictionaryRepository(statusFails = true))
        advanceUntilIdle()

        v.onWordTap(w)
        advanceUntilIdle()
        v.setStatus(KnownStatus.KNOWN)
        advanceUntilIdle()

        // The failed call rolls the optimistic change back to the prior status.
        assertEquals(KnownStatus.UNKNOWN, v.state.value.tokens[0].status)
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
    fun chapterNavigationOpenIgnoresOldSavedTokenAndSavesFreshStart() = runTest(mainRule.dispatcher) {
        val repo = FakeReaderRepository(
            meta = meta(1),
            chapters = mapOf(0 to Chapter(0, listOf(word("a"), word("b")))),
            savedProgress = ReadingProgress(chapterIdx = 0, tokenIdx = 7, pctRead = 42.0),
        )
        val v = vm(repo, resume = false)
        advanceUntilIdle()

        assertEquals(0, v.state.value.chapterIdx)
        assertNull(v.state.value.restoreTokenIdx)
        assertEquals(ReadingProgress(0, 0, 0.0), repo.lastSaved)
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
            savedProgress = ReadingProgress(chapterIdx = 0, tokenIdx = 1, pctRead = 50.0),
        )
        val v = vm(repo, atEnd = true, resume = false)
        advanceUntilIdle()

        assertEquals(2, v.state.value.restoreTokenIdx) // last of 3 tokens
        assertEquals(ReadingProgress(0, 2, 100.0), repo.lastSaved)
    }

    @Test
    fun nextChapterSavesFreshStartAsCurrentPosition() = runTest(mainRule.dispatcher) {
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
        assertEquals(ReadingProgress(1, 0, 0.0), repo.lastSaved)
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

    @Test
    fun addDefinitionPostsAndRefreshesPanel() = runTest(mainRule.dispatcher) {
        val dict = FakeDictionaryRepository(
            LemmaTranslations("नमस्ते", "INTJ", "hello", emptyList(), emptyList(), emptyList()),
        )
        val token = ReaderToken(0, "नमस्ते", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, listOf(token))))
        val v = vm(repo, dict)
        advanceUntilIdle()
        v.onWordTap(token)
        advanceUntilIdle()

        v.addDefinition("my own def")
        advanceUntilIdle()

        assertEquals("l1" to "my own def", dict.lastAdded)
        assertEquals(listOf("my own def"), v.state.value.wordTranslations?.personal?.map { it.body })
    }

    @Test
    fun editDefinitionPatchesAndRefreshesPanel() = runTest(mainRule.dispatcher) {
        val dict = FakeDictionaryRepository(
            LemmaTranslations("aldatu", "VERB", null, listOf(WordTranslation("old note", null, "p1")), emptyList(), emptyList()),
        )
        val token = ReaderToken(0, "aldatu", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, listOf(token))))
        val v = vm(repo, dict)
        advanceUntilIdle()
        v.onWordTap(token)
        advanceUntilIdle()

        v.editDefinition("p1", "new note")
        advanceUntilIdle()

        assertEquals("p1" to "new note", dict.lastEdited)
        assertEquals(listOf("new note"), v.state.value.wordTranslations?.personal?.map { it.body })
    }

    @Test
    fun deleteDefinitionRemovesAndRefreshesPanel() = runTest(mainRule.dispatcher) {
        val dict = FakeDictionaryRepository(
            LemmaTranslations("aldatu", "VERB", null, listOf(WordTranslation("note", null, "p1")), emptyList(), emptyList()),
        )
        val token = ReaderToken(0, "aldatu", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, listOf(token))))
        val v = vm(repo, dict)
        advanceUntilIdle()
        v.onWordTap(token)
        advanceUntilIdle()

        v.deleteDefinition("p1")
        advanceUntilIdle()

        assertEquals("p1", dict.lastDeleted)
        assertEquals(emptyList<String>(), v.state.value.wordTranslations?.personal?.map { it.body })
    }

    @Test
    fun translateSentenceLoadsAndSucceeds() = runTest(mainRule.dispatcher) {
        val token = ReaderToken(0, "नमस्ते", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val repo = FakeReaderRepository(
            meta = meta(1),
            chapters = mapOf(0 to Chapter(0, listOf(token), chapterId = "chap-1")),
            sentenceTranslation = SentenceTranslation("नमस्ते दुनिया।", "Hello world."),
        )
        val v = vm(repo)
        advanceUntilIdle()
        v.onWordTap(token)
        advanceUntilIdle()

        v.translateSentence()
        advanceUntilIdle()

        val s = v.state.value
        assertEquals("Hello world.", s.sentenceTranslation?.translation)
        assertEquals("नमस्ते दुनिया।", s.sentenceTranslation?.sentence)
        assertFalse(s.isSentenceTranslating)
        assertNull(s.sentenceTranslateError)
        // Sends the chapter id + tapped token idx + language.
        assertEquals(Triple("chap-1", 0, "hi"), repo.lastTranslate)
    }

    @Test
    fun openingWordRecallsSavedSentenceTranslation() = runTest(mainRule.dispatcher) {
        val token = ReaderToken(0, "नमस्ते", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val repo = FakeReaderRepository(
            meta = meta(1),
            chapters = mapOf(0 to Chapter(0, listOf(token), chapterId = "chap-1")),
            // A previously-saved translation for this sentence is in the cache.
            cachedSentence = SentenceTranslation("नमस्ते दुनिया।", "Hello world."),
        )
        val v = vm(repo)
        advanceUntilIdle()

        // Just opening the word recalls the saved translation — no translate tap.
        v.onWordTap(token)
        advanceUntilIdle()

        assertEquals("Hello world.", v.state.value.sentenceTranslation?.translation)
    }

    @Test
    fun translateSentenceSurfacesError() = runTest(mainRule.dispatcher) {
        val token = ReaderToken(0, "नमस्ते", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val repo = FakeReaderRepository(
            meta = meta(1),
            chapters = mapOf(0 to Chapter(0, listOf(token), chapterId = "chap-1")),
            sentenceTranslateError = "Couldn't translate this sentence.",
        )
        val v = vm(repo)
        advanceUntilIdle()
        v.onWordTap(token)
        advanceUntilIdle()

        v.translateSentence()
        advanceUntilIdle()

        val s = v.state.value
        assertNull(s.sentenceTranslation)
        assertFalse(s.isSentenceTranslating)
        assertEquals("Couldn't translate this sentence.", s.sentenceTranslateError)
    }

    @Test
    fun translateSentenceIsNoOpWithoutChapterId() = runTest(mainRule.dispatcher) {
        // A chapter cached before chapterId existed → no locator → no request.
        val token = ReaderToken(0, "नमस्ते", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val repo = FakeReaderRepository(
            meta = meta(1),
            chapters = mapOf(0 to Chapter(0, listOf(token), chapterId = null)),
            sentenceTranslation = SentenceTranslation("s", "t"),
        )
        val v = vm(repo)
        advanceUntilIdle()
        v.onWordTap(token)
        advanceUntilIdle()

        v.translateSentence()
        advanceUntilIdle()

        assertEquals(0, repo.translateCalls)
        assertNull(v.state.value.sentenceTranslation)
    }

    @Test
    fun translateSentenceDoesNotRefetchOnceLoaded() = runTest(mainRule.dispatcher) {
        val token = ReaderToken(0, "नमस्ते", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val repo = FakeReaderRepository(
            meta = meta(1),
            chapters = mapOf(0 to Chapter(0, listOf(token), chapterId = "chap-1")),
            sentenceTranslation = SentenceTranslation("s", "t"),
        )
        val v = vm(repo)
        advanceUntilIdle()
        v.onWordTap(token)
        advanceUntilIdle()

        v.translateSentence()
        advanceUntilIdle()
        v.translateSentence() // second tap is a no-op — result already shown
        advanceUntilIdle()

        assertEquals(1, repo.translateCalls)
    }

    @Test
    fun tappingAnotherWordClearsSentenceTranslation() = runTest(mainRule.dispatcher) {
        val a = ReaderToken(0, "एक", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val b = ReaderToken(2, "दो", true, KnownStatus.UNKNOWN, "l2", null, null, false, false, true)
        val repo = FakeReaderRepository(
            meta = meta(1),
            chapters = mapOf(0 to Chapter(0, listOf(a, b), chapterId = "chap-1")),
            sentenceTranslation = SentenceTranslation("s", "t"),
        )
        val v = vm(repo)
        advanceUntilIdle()
        v.onWordTap(a)
        advanceUntilIdle()
        v.translateSentence()
        advanceUntilIdle()
        assertNotNull(v.state.value.sentenceTranslation)

        v.onWordTap(b)
        assertNull(v.state.value.sentenceTranslation)
    }

    @Test
    fun basqueWordTapLoadsReferenceDictionaries() = runTest(mainRule.dispatcher) {
        val dict = FakeDictionaryRepository(
            translations = LemmaTranslations("etxe", null, null, emptyList(), emptyList(), emptyList()),
            basque = listOf(BasqueReference("elhuyar_es", "Elhuyar eu-es", "iz.", "casa", listOf("etxe handia"))),
        )
        val token = ReaderToken(0, "etxe", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val repo = FakeReaderRepository(meta = meta(1, "eu"), chapters = mapOf(0 to Chapter(0, listOf(token))))
        val v = vm(repo, dict)
        advanceUntilIdle()

        v.onWordTap(token)
        advanceUntilIdle()

        assertEquals(listOf("casa"), v.state.value.basqueReference.map { it.definition })
    }

    @Test
    fun nonBasqueWordTapSkipsReferenceDictionaries() = runTest(mainRule.dispatcher) {
        val dict = FakeDictionaryRepository(
            translations = LemmaTranslations("x", null, null, emptyList(), emptyList(), emptyList()),
            basque = listOf(BasqueReference("elhuyar_en", "L", "", "d", emptyList())),
        )
        val token = ReaderToken(0, "x", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val repo = FakeReaderRepository(meta = meta(1, "hi"), chapters = mapOf(0 to Chapter(0, listOf(token))))
        val v = vm(repo, dict)
        advanceUntilIdle()

        v.onWordTap(token)
        advanceUntilIdle()

        assertEquals(emptyList<String>(), v.state.value.basqueReference.map { it.definition })
    }

    @Test
    fun basqueRefPanelStaysAvailableForAdminEvenWithNoEntries() = runTest(mainRule.dispatcher) {
        // Admin, but the tapped (inflected) surface form has no reference entry.
        val dict = FakeDictionaryRepository(
            translations = LemmaTranslations("etxea", null, null, emptyList(), emptyList(), emptyList()),
            basqueAdmin = true,
        )
        val token = ReaderToken(0, "etxea", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val repo = FakeReaderRepository(meta = meta(1, "eu"), chapters = mapOf(0 to Chapter(0, listOf(token))))
        val v = vm(repo, dict)
        advanceUntilIdle()

        v.onWordTap(token)
        advanceUntilIdle()

        val s = v.state.value
        // No entries, but the panel (and its search box) stays available to recover.
        assertTrue(s.basqueRefAvailable)
        assertTrue(s.basqueReference.isEmpty())
        assertFalse(s.isBasqueRefLoading)
        // The search box is prefilled with the tapped word, ready to refine.
        assertEquals("etxea", s.basqueRefSearch)
    }

    @Test
    fun referenceSearchPrefillUpgradesToParsedLemma() = runTest(mainRule.dispatcher) {
        // Tapped form is inflected ("hamarrak"); its lemma parses to "hamar".
        val dict = FakeDictionaryRepository(
            translations = LemmaTranslations("hamar", null, null, emptyList(), emptyList(), emptyList()),
            basqueAdmin = true,
        )
        val token = ReaderToken(0, "hamarrak", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val repo = FakeReaderRepository(meta = meta(1, "eu"), chapters = mapOf(0 to Chapter(0, listOf(token))))
        val v = vm(repo, dict)
        advanceUntilIdle()

        v.onWordTap(token)
        advanceUntilIdle()

        val s = v.state.value
        // Once the lemma loads, the box shows the parsed form, not the surface.
        assertEquals("hamar", s.basqueRefSearch)
        assertEquals("hamar", s.basqueRefPrefill)
    }

    @Test
    fun referenceAutoLookupUsesParsedLemmaNotSurface() = runTest(mainRule.dispatcher) {
        // Tapping inflected "orduak" (lemma "ordu") should fetch entries for "ordu".
        val dict = FakeDictionaryRepository(
            translations = LemmaTranslations("ordu", null, null, emptyList(), emptyList(), emptyList()),
            basque = listOf(BasqueReference("elhuyar_es", "Elhuyar eu-es", "iz.", "hora", emptyList())),
        )
        val token = ReaderToken(0, "orduak", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val repo = FakeReaderRepository(meta = meta(1, "eu"), chapters = mapOf(0 to Chapter(0, listOf(token))))
        val v = vm(repo, dict)
        advanceUntilIdle()

        v.onWordTap(token)
        advanceUntilIdle()

        // The auto-lookup queried the lemma "ordu" (not the surface "orduak")…
        assertEquals("ordu" to false, dict.lastBasqueQuery)
        // …so its entries show up without the user having to search manually.
        assertEquals(listOf("hora"), v.state.value.basqueReference.map { it.definition })
    }

    @Test
    fun searchBasqueReferenceFetchesExactResults() = runTest(mainRule.dispatcher) {
        val dict = FakeDictionaryRepository(
            translations = LemmaTranslations("etxea", null, null, emptyList(), emptyList(), emptyList()),
            basqueAdmin = true,
            basqueSearchResults = listOf(BasqueReference("elhuyar_es", "Elhuyar eu-es", "iz.", "casa", emptyList())),
        )
        val token = ReaderToken(0, "etxea", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val repo = FakeReaderRepository(meta = meta(1, "eu"), chapters = mapOf(0 to Chapter(0, listOf(token))))
        val v = vm(repo, dict)
        advanceUntilIdle()
        v.onWordTap(token)
        advanceUntilIdle()

        v.searchBasqueReference("etxe")
        advanceUntilIdle()

        val s = v.state.value
        assertEquals(listOf("casa"), s.basqueReference.map { it.definition })
        assertEquals("etxe" to true, dict.lastBasqueQuery) // exact search
        assertEquals("etxe", s.basqueRefSearch)
        assertFalse(s.isBasqueRefLoading)
    }

    @Test
    fun basqueRefSearchInputFetchesSuggestions() = runTest(mainRule.dispatcher) {
        val dict = FakeDictionaryRepository(
            translations = LemmaTranslations("etxea", null, null, emptyList(), emptyList(), emptyList()),
            basqueAdmin = true,
            basqueSuggestions = listOf("etxe", "etxalde"),
        )
        val token = ReaderToken(0, "etxea", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val repo = FakeReaderRepository(meta = meta(1, "eu"), chapters = mapOf(0 to Chapter(0, listOf(token))))
        val v = vm(repo, dict)
        advanceUntilIdle()
        v.onWordTap(token)
        advanceUntilIdle()

        v.onBasqueRefSearchInput("etx")
        advanceUntilIdle() // lets the debounce delay elapse

        assertEquals(listOf("etxe", "etxalde"), v.state.value.basqueRefSuggestions)
        // Clearing the box drops the suggestions.
        v.onBasqueRefSearchInput("")
        advanceUntilIdle()
        assertTrue(v.state.value.basqueRefSuggestions.isEmpty())
    }

    private fun word(surface: String) =
        ReaderToken(0, surface, true, KnownStatus.UNKNOWN, null, null, null, false, false, false)

    private fun translations(headword: String, gloss: String) = LemmaTranslations(
        headword = headword,
        pos = "NOUN",
        gloss = gloss,
        personal = emptyList(),
        official = listOf(WordTranslation(gloss, null)),
        community = emptyList(),
    )

    @Test
    fun toggleStatusTogglesActiveStatusBackToNew() = runTest(mainRule.dispatcher) {
        val token = ReaderToken(0, "aldatu", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true)
        val repo = FakeReaderRepository(meta = meta(1), chapters = mapOf(0 to Chapter(0, listOf(token))))
        val v = vm(repo)
        advanceUntilIdle()
        v.onWordTap(token)
        advanceUntilIdle()

        v.toggleStatus(KnownStatus.KNOWN)
        advanceUntilIdle()
        assertEquals(KnownStatus.KNOWN, v.state.value.selectedWord?.status)

        // Re-applying the active status clears it to "new" — reads the live status,
        // so it works repeatedly within one open word sheet (no reopen needed).
        v.toggleStatus(KnownStatus.KNOWN)
        advanceUntilIdle()
        assertEquals(KnownStatus.UNKNOWN, v.state.value.selectedWord?.status)
    }

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

    override suspend fun translateSentence(
        chapterId: String,
        tokenIdx: Int,
        language: String,
    ): Outcome<SentenceTranslation> = Outcome.Failure("not used")

    override suspend fun cachedSentenceTranslation(
        chapterId: String,
        tokenIdx: Int,
        language: String,
    ): Outcome<SentenceTranslation> = Outcome.Failure("not used")
}

private class FakeReaderRepository(
    private val meta: TextMeta? = null,
    private val chapters: Map<Int, Chapter> = emptyMap(),
    private val metaError: String? = null,
    private val chapterError: String? = null,
    private val savedProgress: ReadingProgress? = null,
    private val sentenceTranslation: SentenceTranslation? = null,
    private val sentenceTranslateError: String? = null,
    private val cachedSentence: SentenceTranslation? = null,
) : ReaderRepository {
    var lastSaved: ReadingProgress? = null
    var lastTranslate: Triple<String, Int, String>? = null
    var translateCalls = 0

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

    override suspend fun translateSentence(
        chapterId: String,
        tokenIdx: Int,
        language: String,
    ): Outcome<SentenceTranslation> {
        translateCalls += 1
        lastTranslate = Triple(chapterId, tokenIdx, language)
        return sentenceTranslateError?.let { Outcome.Failure(it) }
            ?: sentenceTranslation?.let { Outcome.Success(it) }
            ?: Outcome.Failure("no translation configured")
    }

    override suspend fun cachedSentenceTranslation(
        chapterId: String,
        tokenIdx: Int,
        language: String,
    ): Outcome<SentenceTranslation> =
        cachedSentence?.let { Outcome.Success(it) } ?: Outcome.Failure("cache miss")
}

private class FakeDictionaryRepository(
    private var translations: LemmaTranslations? = null,
    private val basque: List<BasqueReference> = emptyList(),
    /** Whether reference lookups succeed (admin); else they 403 → Failure. Defaults
     *  to admin when [basque] entries are supplied, so most tests need not set it. */
    private val basqueAdmin: Boolean = basque.isNotEmpty(),
    /** Exact-search results, distinct from the auto-lookup's [basque] entries. */
    private val basqueSearchResults: List<BasqueReference> = basque,
    /** Autocomplete suggestions returned for any search term. */
    private val basqueSuggestions: List<String> = emptyList(),
    /** Per-lemma overrides so a test can fetch distinct definitions for the
     *  primary parse and its alternate candidates. */
    private val byLemma: Map<String, LemmaTranslations> = emptyMap(),
    /** When true, [setStatus] returns Failure so tests can exercise rollback. */
    private val statusFails: Boolean = false,
) : DictionaryRepository {
    var lastAdded: Pair<String, String>? = null
    var lastBasqueQuery: Pair<String, Boolean>? = null
    val requestedLemmaIds = mutableListOf<String>()

    override suspend fun translations(lemmaId: String): Outcome<LemmaTranslations> {
        requestedLemmaIds += lemmaId
        val hit = byLemma[lemmaId] ?: translations
        return hit?.let { Outcome.Success(it) } ?: Outcome.Failure("no translations")
    }

    override suspend fun refreshTranslations(lemmaId: String): Outcome<LemmaTranslations> =
        translations?.let { Outcome.Success(it) } ?: Outcome.Failure("no translations")

    override suspend fun setStatus(lemmaId: String, status: KnownStatus): Outcome<KnownStatus> =
        if (statusFails) Outcome.Failure("offline") else Outcome.Success(status)

    override suspend fun addDefinition(lemmaId: String, body: String): Outcome<Unit> {
        lastAdded = lemmaId to body
        translations = translations?.let { it.copy(personal = it.personal + WordTranslation(body, null, "p${it.personal.size + 1}")) }
        return Outcome.Success(Unit)
    }

    var lastEdited: Pair<String, String>? = null
    override suspend fun editDefinition(translationId: String, body: String): Outcome<Unit> {
        lastEdited = translationId to body
        translations = translations?.let {
            it.copy(personal = it.personal.map { p -> if (p.id == translationId) p.copy(body = body) else p })
        }
        return Outcome.Success(Unit)
    }

    var lastDeleted: String? = null
    override suspend fun deleteDefinition(translationId: String): Outcome<Unit> {
        lastDeleted = translationId
        translations = translations?.let { it.copy(personal = it.personal.filterNot { p -> p.id == translationId }) }
        return Outcome.Success(Unit)
    }

    override suspend fun basqueReference(word: String, exact: Boolean): Outcome<List<BasqueReference>> {
        lastBasqueQuery = word to exact
        if (!basqueAdmin) return Outcome.Failure("not admin")
        return Outcome.Success(if (exact) basqueSearchResults else basque)
    }

    override suspend fun basqueReferenceAutocomplete(term: String): Outcome<List<String>> =
        Outcome.Success(basqueSuggestions)
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
    override suspend fun showRomanization(language: String): Boolean = romanization
    override suspend fun setShowRomanization(language: String, value: Boolean) {
        lastSetRomanization = value
    }
    override suspend fun pageMode(language: String): Boolean = paged
    override suspend fun setPageMode(language: String, value: Boolean) {
        lastSetPageMode = value
    }

    var lastSetFontSize: Int? = null
    var lastSetLineSpacing: Float? = null
    override suspend fun fontSizeSp(language: String): Int = fontSize
    override suspend fun setFontSizeSp(language: String, value: Int) {
        lastSetFontSize = value
    }
    override suspend fun lineSpacing(language: String): Float = lineSpacingValue
    override suspend fun setLineSpacing(language: String, value: Float) {
        lastSetLineSpacing = value
    }

    private var basqueRef: String? = null
    override suspend fun basqueRefSource(): String? = basqueRef
    override suspend fun setBasqueRefSource(source: String) {
        basqueRef = source
    }
}

private class FakeCollectionRepository(
    private val detail: CollectionDetail? = null,
) : CollectionRepository {
    override suspend fun myCollections(): Outcome<List<CollectionSummary>> = Outcome.Success(emptyList())
    override suspend fun detail(collectionId: String): Outcome<CollectionDetail> =
        detail?.let { Outcome.Success(it) } ?: Outcome.Failure("no detail")

    override suspend fun update(
        collectionId: String,
        title: String?,
        description: String?,
    ): Outcome<String> = Outcome.Success(title ?: "untitled")

    override suspend fun delete(collectionId: String): Outcome<Unit> = Outcome.Success(Unit)

    override suspend fun cachedCollections(): List<CollectionSummary> = emptyList()
}

private class FakeReadingTimeStore : ReadingTimeStore {
    val added = mutableMapOf<String, Long>()
    override suspend fun addReadingTime(language: String, deltaMs: Long) {
        added[language] = (added[language] ?: 0L) + deltaMs
    }

    override suspend fun readingTimeMs(language: String): Long = added[language] ?: 0L
    override suspend fun readingTimeByLanguage(): Map<String, Long> = added.toMap()
    override suspend fun totalReadingTimeMs(): Long = added.values.sum()
}
