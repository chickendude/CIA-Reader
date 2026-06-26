package com.ciareader.reader.ui.importer

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.ciareader.reader.ui.theme.CiaReaderTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class)
class ImportSheetTest {

    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        isSubmitting: Boolean = false,
        errorMessage: String? = null,
    ) {
        compose.setContent {
            CiaReaderTheme {
                ImportSheetBody(
                    language = "hi",
                    isSubmitting = isSubmitting,
                    errorMessage = errorMessage,
                    onSubmitPaste = { _, _, _ -> },
                    onImportTxt = { _, _ -> },
                    onImportEpub = { _, _ -> },
                    onImportPdf = { _, _ -> },
                )
            }
        }
    }

    @Test
    fun showsAllImportOptionsIncludingPdf() {
        setContent()
        compose.onNodeWithText("Paste text").assertIsDisplayed()
        compose.onNodeWithText("Plain text file (.txt)").assertIsDisplayed()
        compose.onNodeWithText("EPUB book (.epub)").assertIsDisplayed()
        compose.onNodeWithText("PDF document (.pdf)").assertIsDisplayed()
    }

    @Test
    fun showsSpinnerWhileSubmitting() {
        setContent(isSubmitting = true)
        compose.onNodeWithText("Importing…").assertIsDisplayed()
        // Options are hidden while a submit is in flight.
        compose.onNodeWithText("Paste text").assertDoesNotExist()
    }

    @Test
    fun showsError() {
        setContent(errorMessage = "Daily text upload limit reached. Try again tomorrow.")
        compose.onNodeWithText("Daily text upload limit reached. Try again tomorrow.")
            .assertIsDisplayed()
    }
}
