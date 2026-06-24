package com.ciareader.reader.ui.reader

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.ciareader.reader.data.dictionary.LemmaTranslations
import com.ciareader.reader.data.dictionary.WordTranslation
import com.ciareader.reader.data.reader.KnownStatus
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
                    onSetStatus = {},
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
                    onSetStatus = {},
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
                    onSetStatus = {},
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
        compose.onNodeWithText("Intro").assertIsDisplayed()
        compose.onNodeWithText("1200 words").assertIsDisplayed()
        compose.onNodeWithText("Current").assertIsDisplayed()
        compose.onNodeWithText("Intro").performClick()
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
                    onSetStatus = {},
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
                    onSetStatus = {},
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
    fun wordDetailsShowsTranslationsAndStatusButtons() {
        var chosen: KnownStatus? = null
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
                    onSetStatus = { chosen = it },
                )
            }
        }
        compose.onNodeWithText("नमस्ते").assertIsDisplayed()
        compose.onNodeWithText("greeting").assertIsDisplayed()
        // Attribution is intentionally not surfaced in the reader (web parity).
        compose.onNodeWithText("Platts").assertDoesNotExist()
        compose.onNodeWithText("Known").assertIsDisplayed()
        compose.onNodeWithText("Known").performClick()
        assertEquals(KnownStatus.KNOWN, chosen)
    }

    @Test
    fun wordDetailsFallsBackToInlineGloss() {
        compose.setContent {
            CiaReaderTheme {
                WordDetails(
                    token = ReaderToken(0, "नमस्ते", true, KnownStatus.UNKNOWN, "l1", "namaste", "hello", false, false, true),
                    translations = null,
                    isLoading = false,
                    onSetStatus = {},
                )
            }
        }
        compose.onNodeWithText("namaste").assertIsDisplayed()
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
                    onSetStatus = {},
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
    fun wordDetailsTranslateSentenceButtonFires() {
        var translated = false
        compose.setContent {
            CiaReaderTheme {
                WordDetails(
                    token = ReaderToken(0, "नमस्ते", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true),
                    translations = null,
                    isLoading = false,
                    onSetStatus = {},
                    onTranslateSentence = { translated = true },
                )
            }
        }
        compose.onNodeWithText("Translate sentence").performClick()
        assertTrue(translated)
    }

    @Test
    fun wordDetailsShowsSentenceTranslationResultWhenAutoExpanded() {
        compose.setContent {
            CiaReaderTheme {
                WordDetails(
                    token = ReaderToken(0, "नमस्ते", true, KnownStatus.UNKNOWN, "l1", null, null, false, false, true),
                    translations = null,
                    isLoading = false,
                    onSetStatus = {},
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
                    onSetStatus = {},
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

    private fun token(surface: String, isWord: Boolean, status: KnownStatus = KnownStatus.UNKNOWN) =
        ReaderToken(0, surface, isWord, status, null, null, null, false, false, false)
}
