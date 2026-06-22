package com.ciareader.reader.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ciareader.reader.ui.auth.LoginScreen
import com.ciareader.reader.ui.navigation.CiaReaderNavHost

/**
 * App root. Auth-gates the UI: while credentials resolve we show a spinner,
 * then route to the login screen or the in-app navigation graph.
 */
@Composable
fun CiaReaderRoot(rootViewModel: RootViewModel = hiltViewModel()) {
    val isAuthenticated by rootViewModel.isAuthenticated.collectAsStateWithLifecycle()

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        when (isAuthenticated) {
            null -> LoadingScreen()
            false -> LoginScreen()
            true -> CiaReaderNavHost(onLogout = rootViewModel::logout)
        }
    }
}

@Composable
private fun LoadingScreen() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}
