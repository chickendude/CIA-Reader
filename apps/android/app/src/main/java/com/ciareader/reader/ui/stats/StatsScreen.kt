package com.ciareader.reader.ui.stats

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ciareader.reader.R

@Composable
fun StatsScreen(
    onBack: () -> Unit,
    viewModel: StatsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    StatsScreenContent(state = state, onBack = onBack)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatsScreenContent(
    state: StatsUiState,
    onBack: () -> Unit,
) {
    Scaffold(
        topBar = {
            androidx.compose.material3.TopAppBar(
                title = { Text("Stats") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(painterResource(R.drawable.ic_chevron_left), contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
        ) {
            if (state.languageLabel.isNotEmpty()) {
                SectionHeader("Words · ${state.languageLabel}")
            } else {
                SectionHeader("Words")
            }

            StatRow(
                label = "Words known",
                value = if (state.errorMessage != null) "—" else state.knownWords.toString(),
            )
            StatRow(
                label = "Words learning",
                value = if (state.errorMessage != null) "—" else state.learningWords.toString(),
            )
            StatRow(
                label = "Phrases known",
                value = if (state.errorMessage != null) "—" else state.knownPhrases.toString(),
            )
            StatRow(
                label = "Estimated comprehension",
                value = when {
                    state.errorMessage != null -> "—"
                    state.estimatedComprehensionPct == null -> "—"
                    else -> "${state.estimatedComprehensionPct}%"
                },
            )

            Spacer(Modifier.height(24.dp))
            SectionHeader("Reading time")
            StatRow(
                label = if (state.languageLabel.isNotEmpty()) state.languageLabel else "This language",
                value = formatDuration(state.languageReadingTimeMs),
            )
            StatRow(
                label = "All languages",
                value = formatDuration(state.totalReadingTimeMs),
            )
            Text(
                "Reading time is tracked on this device only.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp, bottom = 8.dp),
            )

            if (state.isLoading) {
                Spacer(Modifier.height(16.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                ) {
                    CircularProgressIndicator()
                }
            }

            if (state.errorMessage != null) {
                Spacer(Modifier.height(8.dp))
                Text(
                    state.errorMessage,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 16.dp, bottom = 4.dp),
    )
}

@Composable
private fun StatRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Text(
            value,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
        )
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

/**
 * Human-readable duration for the stats rows. Shows "0m" for nothing,
 * "Xm" under an hour, and "Hh Mm" once it passes an hour — coarse on
 * purpose; second-level precision isn't useful here.
 */
fun formatDuration(ms: Long): String {
    val totalMinutes = ms / 60_000L
    if (totalMinutes <= 0L) return "0m"
    val hours = totalMinutes / 60L
    val minutes = totalMinutes % 60L
    return if (hours > 0L) "${hours}h ${minutes}m" else "${minutes}m"
}
