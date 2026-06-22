@file:OptIn(ExperimentalMaterial3Api::class)

package com.ciareader.reader.ui.collection

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ciareader.reader.data.collection.CollectionChapter

@Composable
fun CollectionDetailScreen(
    onBack: () -> Unit,
    onOpenText: (String) -> Unit,
    viewModel: CollectionDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    CollectionDetailContent(
        state = state,
        onBack = onBack,
        onOpenText = onOpenText,
        onRetry = viewModel::load,
    )
}

@Composable
internal fun CollectionDetailContent(
    state: CollectionDetailUiState,
    onBack: () -> Unit,
    onOpenText: (String) -> Unit,
    onRetry: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(state.title.ifEmpty { "Book" }, maxLines = 1, overflow = TextOverflow.Ellipsis)
                },
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
            )
        },
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when {
                state.isLoading ->
                    CircularProgressIndicator(Modifier.align(Alignment.Center))

                state.errorMessage != null ->
                    DetailError(state.errorMessage, onRetry)

                else ->
                    ChapterList(state.chapters, onOpenText)
            }
        }
    }
}

@Composable
private fun ChapterList(chapters: List<CollectionChapter>, onOpenText: (String) -> Unit) {
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        items(chapters, key = { it.textId }) { chapter ->
            ListItem(
                headlineContent = { Text(chapter.title) },
                supportingContent = {
                    if (!chapter.isReady) {
                        Text(chapter.status, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
                modifier = Modifier.clickable(enabled = chapter.isReady) { onOpenText(chapter.textId) },
            )
            HorizontalDivider()
        }
    }
}

@Composable
private fun DetailError(message: String, onRetry: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(message, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
        Button(onClick = onRetry, modifier = Modifier.padding(top = 16.dp)) { Text("Retry") }
    }
}
