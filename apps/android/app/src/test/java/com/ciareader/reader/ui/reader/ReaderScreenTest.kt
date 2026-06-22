package com.ciareader.reader.ui.reader

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.ciareader.reader.data.reader.KnownStatus
import com.ciareader.reader.data.reader.ReaderToken
import com.ciareader.reader.ui.theme.CiaReaderTheme
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
                )
            }
        }
        compose.onNodeWithText("My Book").assertIsDisplayed()
        compose.onNodeWithText("Hello world").assertIsDisplayed()
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
                )
            }
        }
        compose.onNodeWithText("Not found.").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun wordDetailsShowsSurfaceRomanizationGloss() {
        compose.setContent {
            CiaReaderTheme {
                WordDetails(
                    ReaderToken(
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
                )
            }
        }
        compose.onNodeWithText("नमस्ते").assertIsDisplayed()
        compose.onNodeWithText("namaste").assertIsDisplayed()
        compose.onNodeWithText("hello").assertIsDisplayed()
        compose.onNodeWithText("Status: Learning").assertIsDisplayed()
    }

    private fun token(surface: String, isWord: Boolean, status: KnownStatus = KnownStatus.UNKNOWN) =
        ReaderToken(0, surface, isWord, status, null, null, null, false, false, false)
}
