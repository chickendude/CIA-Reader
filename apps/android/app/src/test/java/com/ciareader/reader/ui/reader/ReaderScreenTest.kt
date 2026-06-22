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
                )
            }
        }
        compose.onNodeWithText("namaste").assertIsDisplayed()
    }

    @Test
    fun romanizeToggleInvokesCallback() {
        var toggled = false
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
                    onToggleRomanize = { toggled = true },
                )
            }
        }
        compose.onNodeWithContentDescription("Show romanization").performClick()
        assertTrue(toggled)
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

    private fun token(surface: String, isWord: Boolean, status: KnownStatus = KnownStatus.UNKNOWN) =
        ReaderToken(0, surface, isWord, status, null, null, null, false, false, false)
}
