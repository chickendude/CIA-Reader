package com.ciareader.reader.ui.downloads

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ciareader.reader.R
import com.ciareader.reader.data.local.Download
import java.util.Locale

@Composable
fun DownloadsScreen(
    onBack: () -> Unit,
    viewModel: DownloadsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    DownloadsScreenContent(state = state, onBack = onBack, onDelete = viewModel::delete)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DownloadsScreenContent(
    state: DownloadsUiState,
    onBack: () -> Unit,
    onDelete: (String) -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Downloads") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(painterResource(R.drawable.ic_chevron_left), contentDescription = "Back")
                    }
                },
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

                state.isEmpty ->
                    Text(
                        "Nothing downloaded yet. Texts you open are saved here for offline reading.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.align(Alignment.Center).padding(32.dp),
                    )

                else -> LazyColumn(Modifier.fillMaxSize()) {
                    item {
                        Text(
                            "${state.downloads.size} texts · ${formatBytes(state.totalBytes)}",
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                    items(state.downloads, key = { it.textId }) { d ->
                        DownloadRow(d, onDelete)
                    }
                }
            }
        }
    }
}

@Composable
private fun DownloadRow(download: Download, onDelete: (String) -> Unit) {
    ListItem(
        headlineContent = { Text(download.title) },
        supportingContent = {
            Text(
                "${download.language.uppercase(Locale.US)} · ${download.chapters} chapters · ${formatBytes(download.sizeBytes)}",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        trailingContent = {
            IconButton(onClick = { onDelete(download.textId) }) {
                Icon(painterResource(R.drawable.ic_close), contentDescription = "Remove ${download.title}")
            }
        },
    )
}

/** Compact human size (decimal units, matching how stores report download size). */
internal fun formatBytes(bytes: Long): String = when {
    bytes >= 1_000_000 -> String.format(Locale.US, "%.1f MB", bytes / 1_000_000.0)
    bytes >= 1_000 -> "${bytes / 1_000} KB"
    else -> "$bytes B"
}
