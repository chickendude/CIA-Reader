package com.ciareader.reader.ui.library

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.ui.res.painterResource
import com.ciareader.reader.R
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.ciareader.reader.data.collection.CollectionSummary
import com.ciareader.reader.data.language.Language
import com.ciareader.reader.data.library.TextCard

@Composable
fun LibraryScreen(
    onOpenText: (String) -> Unit,
    onOpenCollection: (CollectionSummary) -> Unit,
    onOpenSettings: () -> Unit,
    viewModel: LibraryViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner, viewModel) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) viewModel.refreshCurrentLanguage()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    LibraryScreenContent(
        state = state,
        onSelectLanguage = viewModel::selectLanguage,
        onOpenText = onOpenText,
        onOpenCollection = onOpenCollection,
        onRetry = viewModel::load,
        onOpenSettings = onOpenSettings,
        onRefresh = viewModel::refresh,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun LibraryScreenContent(
    state: LibraryUiState,
    onSelectLanguage: (String) -> Unit,
    onOpenText: (String) -> Unit,
    onOpenCollection: (CollectionSummary) -> Unit,
    onRetry: () -> Unit,
    onOpenSettings: () -> Unit,
    onRefresh: () -> Unit = {},
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Library") },
                actions = {
                    // Only once we know the languages — avoids a "Language"
                    // placeholder flashing before the (cached) list resolves.
                    if (state.languages.isNotEmpty()) {
                        LanguageSwitcher(
                            languages = state.languages,
                            currentCode = state.currentLanguage,
                            onSelect = onSelectLanguage,
                        )
                    }
                    IconButton(onClick = onOpenSettings) {
                        Icon(
                            painterResource(R.drawable.ic_settings),
                            contentDescription = "Settings",
                        )
                    }
                },
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.isRefreshing,
            onRefresh = onRefresh,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when {
                // The initial full-screen spinner; pull-to-refresh uses its own.
                state.isLoading ->
                    CircularProgressIndicator(Modifier.align(Alignment.Center))

                // Wrapped so a downward drag still triggers pull-to-refresh even
                // with nothing to scroll.
                state.errorMessage != null ->
                    PullableCenter { ErrorState(message = state.errorMessage, onRetry = onRetry) }

                state.isEmpty ->
                    PullableCenter { EmptyState() }

                else ->
                    ContentList(
                        collections = state.collections,
                        texts = state.texts,
                        onOpenCollection = onOpenCollection,
                        onOpenText = onOpenText,
                    )
            }
        }
    }
}

@Composable
private fun PullableCenter(content: @Composable () -> Unit) {
    // A single full-viewport item keeps a scroll container present (so
    // PullToRefreshBox captures the drag) while centering the message.
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) { content() }
        }
    }
}

@Composable
private fun ContentList(
    collections: List<CollectionSummary>,
    texts: List<TextCard>,
    onOpenCollection: (CollectionSummary) -> Unit,
    onOpenText: (String) -> Unit,
) {
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        if (collections.isNotEmpty()) {
            item { SectionHeader("Books") }
            items(collections, key = { "c-${it.id}" }) { c ->
                ListItem(
                    headlineContent = { Text(c.title) },
                    supportingContent = {
                        Text("${c.textCount} chapters", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    },
                    modifier = Modifier.clickable { onOpenCollection(c) },
                )
                HorizontalDivider()
            }
        }
        if (texts.isNotEmpty()) {
            item { SectionHeader("Texts") }
            items(texts, key = { "t-${it.id}" }) { card ->
                ListItem(
                    headlineContent = { Text(card.title) },
                    supportingContent = {
                        if (!card.isReady) Text(card.status, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    },
                    modifier = Modifier.clickable(enabled = card.isReady) { onOpenText(card.id) },
                )
                HorizontalDivider()
            }
        }
    }
}

@Composable
private fun SectionHeader(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

@Composable
private fun LanguageSwitcher(
    languages: List<Language>,
    currentCode: String?,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val current = languages.firstOrNull { it.code == currentCode }
    IconButton(
        onClick = { expanded = true },
        // The chip alone is opaque to screen readers, so name the language.
        modifier = Modifier.semantics { contentDescription = "Language: ${current?.displayName ?: "none"}" },
    ) {
        LanguageChip(current?.glyph().orEmpty())
    }
    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
        languages.forEach { lang ->
            DropdownMenuItem(
                text = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        LanguageChip(lang.glyph())
                        Spacer(Modifier.width(12.dp))
                        Text("${lang.displayName} · ${lang.nativeName}")
                    }
                },
                onClick = {
                    expanded = false
                    onSelect(lang.code)
                },
            )
        }
    }
}

/** A small round chip showing a language's script — a compact stand-in for its
 *  name (e.g. ह for Hindi, म for Marathi, א for Yiddish, E for Basque). */
@Composable
private fun LanguageChip(glyph: String) {
    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.primaryContainer,
        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        modifier = Modifier.size(28.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(glyph, style = MaterialTheme.typography.labelLarge)
        }
    }
}

/** The language's representative glyph: the first letter of its native name
 *  (its own script), falling back to the language code. */
private fun Language.glyph(): String {
    val native = nativeName.trim()
    return if (native.isNotEmpty()) native.take(1) else code.uppercase().take(2)
}

@Composable
private fun EmptyState() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Nothing here yet", style = MaterialTheme.typography.titleMedium)
        Text(
            "Add a text or book from the web app to start reading.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun ErrorState(message: String, onRetry: () -> Unit) {
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
