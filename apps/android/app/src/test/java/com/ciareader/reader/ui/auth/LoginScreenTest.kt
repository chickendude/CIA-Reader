package com.ciareader.reader.ui.auth

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.ciareader.reader.ui.theme.CiaReaderTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Compose UI test for the login screen, run on the JVM via Robolectric (no
 * emulator). Uses a plain Application (not the @HiltAndroidApp) since the
 * stateless content composable needs no DI.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class)
class LoginScreenTest {

    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: LoginUiState,
        onSubmit: () -> Unit = {},
        onToggleMode: () -> Unit = {},
        onSendMagicLink: () -> Unit = {},
    ) {
        compose.setContent {
            CiaReaderTheme {
                LoginScreenContent(
                    state = state,
                    onEmailChange = {},
                    onPasswordChange = {},
                    onDisplayNameChange = {},
                    onSubmit = onSubmit,
                    onToggleMode = onToggleMode,
                    onSendMagicLink = onSendMagicLink,
                )
            }
        }
    }

    @Test
    fun loginMode_showsLogInCta_andHidesDisplayNameField() {
        setContent(LoginUiState(email = "a@b.co", password = "secret1234"))
        compose.onNodeWithText("Log in").assertIsDisplayed()
        compose.onNodeWithText("Display name (optional)").assertDoesNotExist()
    }

    @Test
    fun registerMode_showsCreateAccount_andDisplayNameField() {
        setContent(
            LoginUiState(mode = AuthMode.REGISTER, email = "a@b.co", password = "secret1234"),
        )
        compose.onNodeWithText("Create account").assertIsDisplayed()
        compose.onNodeWithText("Display name (optional)").assertIsDisplayed()
    }

    @Test
    fun tappingSubmit_invokesCallback() {
        var submitted = false
        setContent(
            LoginUiState(email = "a@b.co", password = "secret1234"),
            onSubmit = { submitted = true },
        )
        compose.onNodeWithText("Log in").performClick()
        assertTrue(submitted)
    }

    @Test
    fun errorMessage_isShown() {
        setContent(
            LoginUiState(email = "a@b.co", password = "x", errorMessage = "Invalid email or password."),
        )
        compose.onNodeWithText("Invalid email or password.").assertIsDisplayed()
    }
}
