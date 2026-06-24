package com.ciareader.reader.ui.library

import android.app.Application
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.ciareader.reader.data.collection.CollectionSummary
import com.ciareader.reader.data.language.Language
import com.ciareader.reader.data.library.TextCard
import com.ciareader.reader.ui.theme.CiaReaderTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class)
class LibraryScreenTest {

    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: LibraryUiState,
        onOpenText: (String) -> Unit = {},
        onOpenCollection: (CollectionSummary) -> Unit = {},
        onSelectLanguage: (String) -> Unit = {},
        onRetry: () -> Unit = {},
        onOpenSettings: () -> Unit = {},
    ) {
        compose.setContent {
            CiaReaderTheme {
                LibraryScreenContent(
                    state = state,
                    onSelectLanguage = onSelectLanguage,
                    onOpenText = onOpenText,
                    onOpenCollection = onOpenCollection,
                    onRetry = onRetry,
                    onOpenSettings = onOpenSettings,
                )
            }
        }
    }

    @Test
    fun showsTextsAndTapOpensReady() {
        var opened: String? = null
        setContent(
            LibraryUiState(
                isLoading = false,
                languages = listOf(lang("hi", "Hindi")),
                currentLanguage = "hi",
                texts = listOf(TextCard("t1", "Story One", "hi", "ready")),
            ),
            onOpenText = { opened = it },
        )
        compose.onNodeWithText("Story One").assertIsDisplayed()
        compose.onNodeWithText("Story One").performClick()
        assertEquals("t1", opened)
    }

    @Test
    fun showsComprehensionBadgeWhenPresentAndHidesItWhenNull() {
        setContent(
            LibraryUiState(
                isLoading = false,
                languages = listOf(lang("hi", "Hindi")),
                currentLanguage = "hi",
                texts = listOf(
                    TextCard("t1", "Scored", "hi", "ready", estimatedComprehensionPct = 85),
                    TextCard("t2", "Unscored", "hi", "ready", estimatedComprehensionPct = null),
                ),
            ),
        )
        // The scored card shows an "85%" pill; the unscored one shows none.
        compose.onNodeWithText("85%").assertIsDisplayed()
        compose.onAllNodesWithText("%", substring = true).assertCountEquals(1)
    }

    @Test
    fun showsComprehensionBadgeOnCollectionCards() {
        setContent(
            LibraryUiState(
                isLoading = false,
                languages = listOf(lang("eu", "Basque")),
                currentLanguage = "eu",
                collections = listOf(
                    CollectionSummary(
                        "c1",
                        "Afrika express",
                        "eu",
                        "chapter_book",
                        12,
                        estimatedComprehensionPct = 47,
                    ),
                ),
            ),
        )
        compose.onNodeWithText("47%").assertIsDisplayed()
    }

    @Test
    fun showsCollectionsAndTapOpens() {
        var opened: String? = null
        setContent(
            LibraryUiState(
                isLoading = false,
                languages = listOf(lang("eu", "Basque")),
                currentLanguage = "eu",
                collections = listOf(
                    CollectionSummary("c1", "Afrika express", "eu", "chapter_book", 12),
                ),
            ),
            onOpenCollection = { opened = it.id },
        )
        compose.onNodeWithText("Afrika express").assertIsDisplayed()
        compose.onNodeWithText("Afrika express").performClick()
        assertEquals("c1", opened)
    }

    @Test
    fun showsEmptyState() {
        setContent(
            LibraryUiState(
                isLoading = false,
                languages = listOf(lang("hi", "Hindi")),
                currentLanguage = "hi",
            ),
        )
        compose.onNodeWithText("Nothing here yet").assertIsDisplayed()
    }

    @Test
    fun showsCurrentLanguageChip() {
        setContent(
            LibraryUiState(
                isLoading = false,
                languages = listOf(lang("hi", "Hindi")),
                currentLanguage = "hi",
            ),
        )
        // Top bar shows a chip, not the full name; it's labelled for a11y.
        compose.onNodeWithContentDescription("Language: Hindi").assertIsDisplayed()
    }

    @Test
    fun showsErrorAndRetry() {
        var retried = false
        setContent(
            LibraryUiState(isLoading = false, errorMessage = "Network error — check your connection and try again."),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Retry").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertEquals(true, retried)
    }

    private fun lang(code: String, displayName: String) =
        Language(code = code, displayName = displayName, nativeName = displayName, script = "Deva", isDefault = true)
}
