package com.ciareader.reader.ui.reader

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.click
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import com.ciareader.reader.data.dictionary.LemmaTranslations
import com.ciareader.reader.data.dictionary.WordTranslation
import com.ciareader.reader.data.reader.KnownStatus
import com.ciareader.reader.data.reader.ParseCandidate
import com.ciareader.reader.data.reader.ReaderToken
import com.ciareader.reader.data.reader.SentenceTranslation
import com.ciareader.reader.ui.theme.CiaReaderTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class)
class ReaderScreenTest {

    @get:Rule
    val compose = createComposeRule()

    @Test
    fun rendersChapterTextAndTitle() {
        compose.setContent {
            CiaReaderTheme {
                ReaderScreenContent(
                    state = ReaderUiState(
                        isLoading = false,
                        title = "My Book",
                        tokens = listOf(
                            token("Hello", isWord = true),
                            token(" ", isWord = false),
                            token("world", isWord = true, status = KnownStatus.KNOWN),
                        ),
                    ),
                    onBack = {},
                    onWordTap = {},
                    onDismissWord = {},
                    onPrevChapter = {},
                    onNextChapter = {},
                    onRetry = {},
                    onToggleStatus = {},
                    onRecordPosition = { _, _ -> },
                    onRestoreConsumed = {},
                    onToggleRomanize = {},
                    onTogglePageMode = {},
                )
            }
        }
        compose.onNodeWithText("My Book").assertIsDisplayed()
        compose.onNodeWithText("Hello world").assertIsDisplayed()
    }

    @Test
    fun rendersRomanizationWhenEnabled() {
        compose.setContent {
            CiaReaderTheme {
                ReaderScreenContent(
                    state = ReaderUiState(
                        isLoading = false,
                        title = "Book",
                        romanize = true,
                        tokens = listOf(
                            ReaderToken(0, "नमस्ते", true, KnownStatus.UNKNOWN, "l1", "namaste", null, false, false, true),
                        ),
                    ),
                    onBack = {},
                    onWordTap = {},
                    onDismissWord = {},
                    onPrevChapter = {},
                    onNextChapter = {},
                    onRetry = {},
                    onToggleStatus = {},
                    onRecordPosition = { _, _ -> },
                    onRestoreConsumed = {},
                    onToggleRomanize = {},
                    onTogglePageMode = {},
                )
            }
        }
        compose.onNodeWithText("namaste").assertIsDisplayed()
    }

    @Test
    fun chapterChevronNavigatesNext() {
        var next = false
        compose.setContent {
            CiaReaderTheme {
                ReaderScreenContent(
                    state = ReaderUiState(isLoading = false, title = "Book", chapterCount = 2, chapterIdx = 0),
                    onBack = {},
                    onWordTap = {},
                    onDismissWord = {},
                    onPrevChapter = {},
                    onNextChapter = { next = true },
                    onRetry = {},
                    onToggleStatus = {},
                    onRecordPosition = { _, _ -> },
                    onRestoreConsumed = {},
                    onToggleRomanize = {},
                    onTogglePageMode = {},
                )
            }
        }
        compose.onNodeWithContentDescription("Next chapter").performClick()
        assertTrue(next)
    }

    @Test
    fun chapterListSelectsAChapter() {
        var picked: String? = null
        compose.setContent {
            CiaReaderTheme {
                ChapterListSheet(
                    chapters = listOf(
                        ReaderChapterRef("Intro", textId = "t0", chapterIdx = null, isCurrent = false, wordCount = 1200),
                        ReaderChapterRef("Two", textId = "t1", chapterIdx = null, isCurrent = true),
                    ),
                    onSelect = { picked = it.textId },
                )
            }
        }
        // Chapters are numbered so duplicate/blank titles stay distinguishable.
        compose.onNodeWithText("1. Intro").assertIsDisplayed()
        compose.onNodeWithText("2. Two").assertIsDisplayed()
        compose.onNodeWithText("1200 words").assertIsDisplayed()
        compose.onNodeWithText("Current").assertIsDisplayed()
        compose.onNodeWithText("1. Intro").performClick()
        assertEquals("t0", picked)
    }

    @Test
    fun showsSettingsButton() {
        compose.setContent {
            CiaReaderTheme {
                ReaderScreenContent(
                    state = ReaderUiState(isLoading = false, title = "Book"),
                    onBack = {},
                    onWordTap = {},
                    onDismissWord = {},
                    onPrevChapter = {},
                    onNextChapter = {},
                    onRetry = {},
                    onToggleStatus = {},
                    onRecordPosition = { _, _ -> },
                    onRestoreConsumed = {},
                    onToggleRomanize = {},
                    onTogglePageMode = {},
                )
            }
        }
        compose.onNodeWithContentDescription("Reader settings").assertIsDisplayed()
    }

    @Test
    fun settingsSheetStepsFontAndToggles() {
        var font: Int? = null
        var pagedToggled = false
        compose.setContent {
            CiaReaderTheme {
                ReaderSettingsSheet(
                    fontSize = 18,
                    lineSpacing = 1.5f,
                    pageMode = false,
                    romanize = false,
                    onSetFontSize = { font = it },
                    onSetLineSpacing = {},
                    onTogglePageMode = { pagedToggled = true },
                    onToggleRomanize = {},
                )
            }
        }
        compose.onNodeWithText("18pt").assertIsDisplayed()
        compose.onNodeWithContentDescription("Increase font size").performClick()
        assertEquals(19, font)
        compose.onNodeWithText("Page mode").performClick()
        assertTrue(pagedToggled)
    }

    @Test
    fun showsErrorAndRetry() {
        var retried = false
        compose.setContent {
            CiaReaderTheme {
                ReaderScreenContent(
                    state = ReaderUiState(isLoading = false, errorMessage = "Not found."),
                    onBack = {},
                    onWordTap = {},
                    onDismissWord = {},
                    onPrevChapter = {},
                    onNextChapter = {},
                    onRetry = { retried = true },
                    onToggleStatus = {},
                    onRecordPosition = { _, _ -> },
                    onRestoreConsumed = {},
                    onToggleRomanize = {},
                    onTogglePageMode = {},
                )
            }
        }
        compose.onNodeWithText("Not found.").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun wordDetailsShowsTranslations() {
        compose.setContent {
            CiaReaderTheme {
                WordDetails(
                    token = ReaderToken(
                        idx = 0,
                        surface = "नमस्ते",
                        isWord = true,
                        status = KnownStatus.LEARNING,
                        lemmaId = "l1",
                        romanization = "namaste",
                        glossDefault = "hello",
                        isOov = false,
                        isAmbiguous = false,
                        hasDefinition = true,
                    ),
                    translations = LemmaTranslations(
                        headword = "नमस्ते",
                        pos = "INTJ",
                        gloss = "hello",
                        personal = emptyList(),
                        official = listOf(WordTranslation("greeting", "Platts")),
                        community = emptyList(),
                    ),
                    isLoading = false,
                )
            }
        }
        // The headword/status/translate live in the popup header now; the body
        // shows the dictionary translations.
        compose.onNodeWithText("greeting").assertIsDisplayed()
        // Attribution is intentionally not surfaced in the reader (web parity).
        compose.onNodeWithText("Platts").assertDoesNotExist()
    }

    @Test
    fun wordDetailsShowsParseSwitcherAndSwitchesParse() {
        var picked: String? = null
        compose.setContent {
            CiaReaderTheme {
                WordDetails(
                    token = ReaderToken(
                        idx = 0,
                        surface = "सोने",
                        isWord = true,
                        status = KnownStatus.UNKNOWN,
                        lemmaId = "l-gold",
                        romanization = null,
                        glossDefault = null,
                        isOov = false,
                        isAmbiguous = true,
                        hasDefinition = true,
                        candidates = listOf(ParseCandidate("l-sleep", "सोना", "VERB", "to sleep")),
                    ),
                    translations = LemmaTranslations(
                        headword = "सोना",
                        pos = "NOUN",
                        gloss = "gold",
                        personal = emptyList(),
                        official = listOf(WordTranslation("gold", null)),
                        community = emptyList(),
                    ),
                    isLoading = false,
                    activeParseLemmaId = "l-gold",
                    primaryHeadword = "सोना",
                    primaryPos = "NOUN",
                    onSelectParse = { picked = it },
                )
            }
        }
        // Both parses appear as chips (POS disambiguates the shared headword).
        compose.onNodeWithText("सोना · NOUN").assertIsDisplayed()
        compose.onNodeWithText("सोना · VERB").assertIsDisplayed()
        compose.onNodeWithText("सोना · VERB").performClick()
        assertEquals("l-sleep", picked)
    }

    @Test
    fun wordDetailsHidesParseSwitcherWhenUnambiguous() {
        compose.setContent {
            CiaReaderTheme {
                WordDetails(
                    token = ReaderToken(0, "नमस्ते", true, KnownStatus.UNKNOWN, "l1", "namaste", "hello", false, false, true),
                    translations = null,
                    isLoading = false,
                    activeParseLemmaId = "l1",
                    primaryHeadword = "नमस्ते",
                    primaryPos = "INTJ",
                )
            }
        }
        // A single parse: no switcher chip pair, just the headword title.
        compose.onNodeWithText("नमस्ते · INTJ").assertDoesNotExist()
    }

    @Test
    fun wordDetailsFallsBackToInlineGloss() {
        compose.setContent {
            CiaReaderTheme {
                WordDetails(
                    token = ReaderToken(0, "नमस्ते", true, KnownStatus.UNKNOWN, "l1", "namaste", "hello", false, false, true),
                    translations = null,
                    isLoading = false,
                )
            }
        }
        compose.onNodeWithText("hello").assertIsDisplayed()
    }

    /**
     * Saving the spot, at the UI layer: rendering the reader in page mode must
     * report the current reading position (the top token of the visible page)
     * so it can be persisted. This is the wiring that was missing — page mode
     * never called onRecordPosition, so reopening a book never resumed.
     */
    @Test
    fun pageModeSavesReadingPosition() {
        var recordedToken: Int? = null
        compose.setContent {
            CiaReaderTheme {
                ReaderScreenContent(
                    state = ReaderUiState(
                        isLoading = false,
                        title = "Book",
                        pageMode = true,
                        tokens = listOf(
                            token("alpha", isWord = true),
                            token(" ", isWord = false),
                            token("beta", isWord = true),
                        ),
                    ),
                    onBack = {},
                    onWordTap = {},
                    onDismissWord = {},
                    onPrevChapter = {},
                    onNextChapter = {},
                    onRetry = {},
                    onToggleStatus = {},
                    onRecordPosition = { tokenIdx, _ -> recordedToken = tokenIdx },
                    onRestoreConsumed = {},
                    onToggleRomanize = {},
                    onTogglePageMode = {},
                )
            }
        }
        compose.waitForIdle()
        // The first page starts at the first token, so that's the saved spot.
        assertEquals(0, recordedToken)
    }

    @Test
    fun wordDetailsShowsSentenceTranslationResultWhenAutoExpanded() {
        compose.setContent {
            CiaReaderTheme {
                WordDetails(
                    token = ReaderToken(0, "नमस्ते", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true),
                    translations = null,
                    isLoading = false,
                    sentenceTranslation = SentenceTranslation("नमस्ते दुनिया।", "Hello world."),
                    autoExpandSentence = true, // expanded right after an explicit translate
                )
            }
        }
        compose.onNodeWithText("Hello world.").assertIsDisplayed()
        compose.onNodeWithText("नमस्ते दुनिया।").assertIsDisplayed()
    }

    @Test
    fun wordDetailsSentenceTranslationStartsCollapsedAndExpandsOnTap() {
        compose.setContent {
            CiaReaderTheme {
                WordDetails(
                    token = ReaderToken(0, "नमस्ते", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true),
                    translations = null,
                    isLoading = false,
                    sentenceTranslation = SentenceTranslation("नमस्ते दुनिया।", "Hello world."),
                    // autoExpandSentence defaults false → collapsed (recall behaviour)
                )
            }
        }
        compose.onNodeWithText("Sentence translation", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Hello world.").assertDoesNotExist()
        compose.onNodeWithText("Sentence translation", substring = true).performClick()
        compose.onNodeWithText("Hello world.").assertIsDisplayed()
    }

    @Test
    fun editingDefinitionSavesAndClearingDeletesIt() {
        var edited: Pair<String, String>? = null
        var deleted: String? = null
        compose.setContent {
            CiaReaderTheme {
                WordDetails(
                    token = ReaderToken(0, "aldatu", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true),
                    translations = LemmaTranslations(
                        headword = "aldatu",
                        pos = "VERB",
                        gloss = null,
                        personal = listOf(WordTranslation("my note", null, "p1")),
                        official = emptyList(),
                        community = emptyList(),
                    ),
                    isLoading = false,
                    onEditDefinition = { id, text -> edited = id to text },
                    onDeleteDefinition = { deleted = it },
                )
            }
        }
        // Tap the definition → inline field; edit + Enter saves.
        compose.onNodeWithText("my note").performClick()
        compose.onNode(hasSetTextAction()).performTextClearance()
        compose.onNode(hasSetTextAction()).performTextInput("changed")
        compose.onNode(hasSetTextAction()).performImeAction()
        assertEquals("p1" to "changed", edited)

        // Reopen, clear it, and Enter on the empty field deletes the note.
        compose.onNodeWithText("my note").performClick()
        compose.onNode(hasSetTextAction()).performTextClearance()
        compose.onNode(hasSetTextAction()).performImeAction()
        assertEquals("p1", deleted)
    }

    @Test
    fun tappingAddPlaceholderOpensInlineEditor() {
        var editing = false
        compose.setContent {
            CiaReaderTheme {
                WordDetails(
                    token = ReaderToken(0, "aldatu", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true),
                    translations = null,
                    isLoading = false,
                    onEditingChange = { editing = it },
                )
            }
        }
        compose.onNodeWithText("Add your own definition").performClick()
        assertTrue(editing)
    }

    @Test
    fun wordPopupHeaderShowsWordAndExpandToggles() {
        var expandTapped = false
        var closed = false
        compose.setContent {
            CiaReaderTheme {
                WordPopupHeader(
                    headword = "aldatu",
                    pos = "VERB",
                    romanization = null,
                    showRadial = true,
                    status = KnownStatus.UNKNOWN,
                    onKnown = {},
                    onRefresh = {},
                    onLearn = {},
                    onIgnore = {},
                    onTranslate = {},
                    expanded = false,
                    onToggleExpand = { expandTapped = true },
                    onClose = { closed = true },
                )
            }
        }
        // The word + POS live on the top row; expand sits left of the close X.
        compose.onNodeWithText("aldatu").assertIsDisplayed()
        compose.onNodeWithText("VERB").assertIsDisplayed()
        compose.onNodeWithContentDescription("Expand").performClick()
        assertTrue(expandTapped)
        compose.onNodeWithContentDescription("Close word").performClick()
        assertTrue(closed)
    }

    @Test
    fun radialButtonTapMarksKnown() {
        var tapped = false
        compose.setContent {
            CiaReaderTheme {
                RadialActionButton(
                    status = KnownStatus.UNKNOWN,
                    onKnown = { tapped = true },
                    onRefresh = {},
                    onLearn = {},
                    onIgnore = {},
                    onTranslate = {},
                )
            }
        }
        // A quick tap on the centre checkmark marks the word known.
        compose.onNodeWithContentDescription("Known").performTouchInput { click() }
        assertTrue(tapped)
    }

    @Test
    fun radialSelectionMapsDirectionsToActions() {
        val dz = 20f
        // Centre / dead zone → null (means "known").
        assertEquals(null, radialSelectionFor(Offset(0f, 0f), dz))
        assertEquals(null, radialSelectionFor(Offset(5f, 5f), dz))
        // Screen y is down: right=translate, down=ignore, left=learn, up=refresh.
        assertEquals(RadialAction.TRANSLATE, radialSelectionFor(Offset(100f, 0f), dz))
        assertEquals(RadialAction.IGNORE, radialSelectionFor(Offset(0f, 100f), dz))
        assertEquals(RadialAction.LEARN, radialSelectionFor(Offset(-100f, 0f), dz))
        assertEquals(RadialAction.REFRESH, radialSelectionFor(Offset(0f, -100f), dz))
    }

    @Test
    fun wordDetailsShowsReferenceSearchWhenAvailableEvenWithNoEntries() {
        compose.setContent {
            CiaReaderTheme {
                WordDetails(
                    token = ReaderToken(0, "etxea", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true),
                    translations = null,
                    isLoading = false,
                    basqueReference = emptyList(),
                    basqueRefAvailable = true,
                )
            }
        }
        // The panel and its search box appear so the user can recover the lemma.
        // (Below the word sheet's fold, hence assertExists rather than isDisplayed.)
        compose.onNodeWithText("Reference dictionaries").assertExists()
        compose.onNodeWithText("Search reference dictionaries…").assertExists()
        compose.onNodeWithText("No ES entries.").assertExists()
    }

    @Test
    fun wordDetailsReferenceSuggestionTapFiresSearch() {
        var searched: String? = null
        compose.setContent {
            CiaReaderTheme {
                WordDetails(
                    token = ReaderToken(0, "etxea", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true),
                    translations = null,
                    isLoading = false,
                    basqueReference = emptyList(),
                    basqueRefAvailable = true,
                    basqueRefSearch = "etx",
                    basqueRefSuggestions = listOf("etxe", "etxalde"),
                    onBasqueRefSearch = { searched = it },
                )
            }
        }
        compose.onNodeWithText("etxe").performClick()
        assertEquals("etxe", searched)
    }

    private fun token(surface: String, isWord: Boolean, status: KnownStatus = KnownStatus.UNKNOWN) =
        ReaderToken(0, surface, isWord, status, null, null, null, false, false, false)
}
