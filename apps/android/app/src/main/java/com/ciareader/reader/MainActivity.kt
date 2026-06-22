package com.ciareader.reader

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.lifecycleScope
import com.ciareader.reader.data.auth.AuthRepository
import com.ciareader.reader.ui.CiaReaderRoot
import com.ciareader.reader.ui.theme.CiaReaderTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var authRepository: AuthRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleMagicLink(intent)
        setContent {
            CiaReaderTheme {
                CiaReaderRoot()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleMagicLink(intent)
    }

    /**
     * Handles email sign-in deep links of the form
     * `<APP_BASE_URL>/auth/magic/<token>`. On success the stored auth state
     * flips and [CiaReaderRoot] recomposes into the app.
     */
    private fun handleMagicLink(intent: Intent?) {
        val segments = intent
            ?.takeIf { it.action == Intent.ACTION_VIEW }
            ?.data
            ?.pathSegments
            ?: return
        if (segments.size >= 3 && segments[0] == "auth" && segments[1] == "magic") {
            val token = segments[2]
            lifecycleScope.launch { authRepository.consumeMagicLink(token) }
        }
    }
}
