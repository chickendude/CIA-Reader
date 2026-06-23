package com.ciareader.reader.ui.settings

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
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
class SettingsScreenTest {

    @get:Rule
    val compose = createComposeRule()

    private fun content(
        state: SettingsUiState = SettingsUiState(),
        onBack: () -> Unit = {},
        onSetRomanization: (Boolean) -> Unit = {},
        onSetFontSize: (Int) -> Unit = {},
        onClearCache: () -> Unit = {},
        onLogout: () -> Unit = {},
    ) {
        compose.setContent {
            CiaReaderTheme {
                SettingsScreenContent(
                    state = state,
                    onBack = onBack,
                    onSetRomanization = onSetRomanization,
                    onSetPageMode = {},
                    onSetFontSize = onSetFontSize,
                    onSetLineSpacing = {},
                    onClearCache = onClearCache,
                    onCacheClearedShown = {},
                    onOpenDownloads = {},
                    onLogout = onLogout,
                )
            }
        }
    }

    @Test
    fun rendersSectionsAndActions() {
        content(SettingsUiState(fontSize = 18))
        compose.onNodeWithText("Reading").assertIsDisplayed()
        compose.onNodeWithText("Romanization").assertIsDisplayed()
        compose.onNodeWithText("18pt").assertIsDisplayed()
        compose.onNodeWithText("Clear offline downloads").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Log out").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun togglingRomanizationRowCallsBack() {
        var value: Boolean? = null
        content(onSetRomanization = { value = it })
        compose.onNodeWithText("Romanization").performClick()
        assertEquals(true, value)
    }

    @Test
    fun fontStepperIncreases() {
        var requested: Int? = null
        content(SettingsUiState(fontSize = 18), onSetFontSize = { requested = it })
        compose.onNodeWithContentDescription("Increase Font size").performClick()
        assertEquals(19, requested)
    }

    @Test
    fun clearCacheAndLogoutCallBack() {
        var cleared = false
        var loggedOut = false
        content(onClearCache = { cleared = true }, onLogout = { loggedOut = true })
        compose.onNodeWithText("Clear offline downloads").performScrollTo().performClick()
        compose.onNodeWithText("Log out").performScrollTo().performClick()
        assertTrue(cleared)
        assertTrue(loggedOut)
    }

    @Test
    fun backCallsBack() {
        var backed = false
        content(onBack = { backed = true })
        compose.onNodeWithContentDescription("Back").performClick()
        assertTrue(backed)
    }
}
