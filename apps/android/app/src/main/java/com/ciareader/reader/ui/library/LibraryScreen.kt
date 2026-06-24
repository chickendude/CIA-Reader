package com.ciareader.reader.ui.library

import androidx.annotation.DrawableRes
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
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
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.ui.res.painterResource
import com.ciareader.reader.R
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
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
        onEditCollection = viewModel::editCollection,
        onDeleteCollection = viewModel::deleteCollection,
        onDeleteText = viewModel::deleteText,
        onShowStats = viewModel::showStats,
        onDismissStats = viewModel::dismissStats,
        onClearActionError = viewModel::clearActionError,
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
    onEditCollection: (String, String, String?) -> Unit = { _, _, _ -> },
    onDeleteCollection: (String) -> Unit = {},
    onDeleteText: (String) -> Unit = {},
    onShowStats: (CollectionSummary) -> Unit = {},
    onDismissStats: () -> Unit = {},
    onClearActionError: () -> Unit = {},
) {
    val snackbarHostState = remember { SnackbarHostState() }
    // Surface an edit/delete failure as a transient banner, then clear it.
    LaunchedEffect(state.actionError) {
        state.actionError?.let {
            snackbarHostState.showSnackbar(it)
            onClearActionError()
        }
    }
    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
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
                        onEditCollection = onEditCollection,
                        onDeleteCollection = onDeleteCollection,
                        onDeleteText = onDeleteText,
                        onShowStats = onShowStats,
                    )
            }
        }
    }

    // The stats sheet floats above the list when a book's "Stats" is chosen.
    state.stats?.let { StatsSheet(stats = it, onDismiss = onDismissStats) }
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
    onEditCollection: (String, String, String?) -> Unit,
    onDeleteCollection: (String) -> Unit,
    onDeleteText: (String) -> Unit,
    onShowStats: (CollectionSummary) -> Unit,
) {
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        if (collections.isNotEmpty()) {
            item { SectionHeader("Books") }
            items(collections, key = { "c-${it.id}" }) { c ->
                CollectionRow(
                    collection = c,
                    onOpen = { onOpenCollection(c) },
                    onEdit = { title, desc -> onEditCollection(c.id, title, desc) },
                    onDelete = { onDeleteCollection(c.id) },
                    onShowStats = { onShowStats(c) },
                )
                HorizontalDivider()
            }
        }
        if (texts.isNotEmpty()) {
            item { SectionHeader("Texts") }
            items(texts, key = { "t-${it.id}" }) { card ->
                TextRow(
                    card = card,
                    onOpen = { onOpenText(card.id) },
                    onDelete = { onDeleteText(card.id) },
                )
                HorizontalDivider()
            }
        }
    }
}

/** A book row with tap-to-open, an overflow menu, and long-press for the same
 *  menu. Hosts the per-book Edit dialog, Delete confirm, and Stats trigger. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun CollectionRow(
    collection: CollectionSummary,
    onOpen: () -> Unit,
    onEdit: (title: String, description: String?) -> Unit,
    onDelete: () -> Unit,
    onShowStats: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    var showEdit by remember { mutableStateOf(false) }
    var showDeleteConfirm by remember { mutableStateOf(false) }

    ListItem(
        headlineContent = { Text(collection.title) },
        supportingContent = {
            Text("${collection.textCount} chapters", color = MaterialTheme.colorScheme.onSurfaceVariant)
        },
        trailingContent = {
            Box {
                OverflowButton(
                    contentDescription = "More actions for ${collection.title}",
                    onClick = { menuOpen = true },
                )
                BookMenu(
                    expanded = menuOpen,
                    onDismiss = { menuOpen = false },
                    onEdit = { menuOpen = false; showEdit = true },
                    onStats = { menuOpen = false; onShowStats() },
                    onDelete = { menuOpen = false; showDeleteConfirm = true },
                )
            }
        },
        modifier = Modifier.combinedClickable(
            onClick = onOpen,
            onLongClick = { menuOpen = true },
        ),
    )

    if (showEdit) {
        EditCollectionDialog(
            initialTitle = collection.title,
            onDismiss = { showEdit = false },
            onConfirm = { title, desc ->
                showEdit = false
                onEdit(title, desc)
            },
        )
    }
    if (showDeleteConfirm) {
        ConfirmDeleteDialog(
            itemName = collection.title,
            kind = "book",
            onDismiss = { showDeleteConfirm = false },
            onConfirm = {
                showDeleteConfirm = false
                onDelete()
            },
        )
    }
}

/** A text row: tap-to-open (ready only), overflow + long-press Delete. Texts have
 *  no PATCH endpoint yet, so Edit/Stats are book-only. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TextRow(
    card: TextCard,
    onOpen: () -> Unit,
    onDelete: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    var showDeleteConfirm by remember { mutableStateOf(false) }

    ListItem(
        headlineContent = { Text(card.title) },
        supportingContent = {
            if (!card.isReady) Text(card.status, color = MaterialTheme.colorScheme.onSurfaceVariant)
        },
        trailingContent = {
            Box {
                OverflowButton(
                    contentDescription = "More actions for ${card.title}",
                    onClick = { menuOpen = true },
                )
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(
                        text = { Text("Delete") },
                        onClick = { menuOpen = false; showDeleteConfirm = true },
                    )
                }
            }
        },
        modifier = Modifier.combinedClickable(
            // Tapping a not-ready text does nothing, but long-press still offers Delete.
            onClick = { if (card.isReady) onOpen() },
            onLongClick = { menuOpen = true },
        ),
    )

    if (showDeleteConfirm) {
        ConfirmDeleteDialog(
            itemName = card.title,
            kind = "text",
            onDismiss = { showDeleteConfirm = false },
            onConfirm = {
                showDeleteConfirm = false
                onDelete()
            },
        )
    }
}

/** The kebab (⋮) overflow trigger, labelled for screen readers. */
@Composable
private fun OverflowButton(contentDescription: String, onClick: () -> Unit) {
    IconButton(
        onClick = onClick,
        modifier = Modifier.semantics { this.contentDescription = contentDescription },
    ) {
        Text("⋮", style = MaterialTheme.typography.titleLarge)
    }
}

/** Edit / Stats / Delete menu shared by the overflow button and long-press. */
@Composable
private fun BookMenu(
    expanded: Boolean,
    onDismiss: () -> Unit,
    onEdit: () -> Unit,
    onStats: () -> Unit,
    onDelete: () -> Unit,
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        DropdownMenuItem(text = { Text("Edit") }, onClick = onEdit)
        DropdownMenuItem(text = { Text("Stats") }, onClick = onStats)
        DropdownMenuItem(text = { Text("Delete") }, onClick = onDelete)
    }
}

/** Title (required) + optional description editor for a book. */
@Composable
private fun EditCollectionDialog(
    initialTitle: String,
    onDismiss: () -> Unit,
    onConfirm: (title: String, description: String?) -> Unit,
) {
    var title by rememberSaveable { mutableStateOf(initialTitle) }
    var description by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Edit book") },
        text = {
            Column {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("Title") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.size(12.dp))
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    label = { Text("Description (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(title.trim(), description.trim().ifBlank { null }) },
                // Title is required by the endpoint (min length 1).
                enabled = title.isNotBlank(),
            ) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Generic destructive confirm for a book or text. */
@Composable
private fun ConfirmDeleteDialog(
    itemName: String,
    kind: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Delete $kind?") },
        text = { Text("\"$itemName\" will be permanently deleted. This can't be undone.") },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                colors = androidx.compose.material3.ButtonDefaults.textButtonColors(
                    contentColor = MaterialTheme.colorScheme.error,
                ),
            ) { Text("Delete") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** A bottom sheet of per-book figures (comprehension, words, chapters, progress). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StatsSheet(stats: StatsUiState, onDismiss: () -> Unit) {
    val sheetState = rememberModalBottomSheetState()
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
        ) {
            Text(
                stats.title,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.size(16.dp))
            when {
                stats.isLoading ->
                    CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally))

                stats.errorMessage != null ->
                    Text(stats.errorMessage, color = MaterialTheme.colorScheme.error)

                stats.stats != null -> {
                    val s = stats.stats
                    StatRow("Comprehension", "${s.comprehensionPct}%")
                    StatRow("Total words", s.totalWords.toString())
                    StatRow("Chapters", s.chapterCount.toString())
                    StatRow("Reading progress", "${s.progressPct}%")
                }
            }
        }
    }
}

@Composable
private fun StatRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp)
            .semantics(mergeDescendants = true) { contentDescription = "$label: $value" },
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontWeight = FontWeight.SemiBold)
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
        current?.let { LanguageChip(it) }
    }
    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
        languages.forEach { lang ->
            DropdownMenuItem(
                text = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        LanguageChip(lang)
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

/** A small round chip for a language: a custom emblem where we have one (e.g.
 *  the Basque pinwheel), otherwise the language's script glyph (ह Hindi, म
 *  Marathi, ଓ Odia, א Yiddish). */
@Composable
private fun LanguageChip(language: Language) {
    val iconRes = languageIconRes(language.code)
    if (iconRes != null) {
        Image(
            painter = painterResource(iconRes),
            contentDescription = null,
            modifier = Modifier.size(28.dp),
        )
    } else {
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.size(28.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(language.glyph(), style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

/** A custom chip emblem for a language, or null to use its script glyph. */
@DrawableRes
private fun languageIconRes(code: String): Int? = when (code) {
    "eu" -> R.drawable.ic_lang_eu
    else -> null
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
