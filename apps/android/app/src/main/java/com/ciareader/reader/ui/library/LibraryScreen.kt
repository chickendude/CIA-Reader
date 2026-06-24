package com.ciareader.reader.ui.library

import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
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
                        currentLanguage = state.languages.firstOrNull { it.code == state.currentLanguage },
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
    currentLanguage: Language?,
    collections: List<CollectionSummary>,
    texts: List<TextCard>,
    onOpenCollection: (CollectionSummary) -> Unit,
    onOpenText: (String) -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (collections.isNotEmpty()) {
            item(key = "h-books") { SectionHeader("Books") }
            items(collections, key = { "c-${it.id}" }) { c ->
                CollectionCard(
                    collection = c,
                    language = currentLanguage,
                    onClick = { onOpenCollection(c) },
                )
            }
        }
        if (texts.isNotEmpty()) {
            item(key = "h-texts") { SectionHeader("Texts") }
            items(texts, key = { "t-${it.id}" }) { card ->
                TextCardItem(
                    card = card,
                    language = currentLanguage,
                    onClick = { onOpenText(card.id) },
                )
            }
        }
    }
}

/** A book/collection row: a tinted cover with the title initial, the title, a
 *  chapter count, and a thin progress track at the foot of the card. Leaves
 *  room above the progress track for a sibling PR's comprehension/language
 *  badges. */
@Composable
private fun CollectionCard(
    collection: CollectionSummary,
    language: Language?,
    onClick: () -> Unit,
) {
    LibraryCard(onClick = onClick, enabled = true) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            CoverArt(initial = coverInitial(collection.title, language), tinted = true)
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    collection.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.size(4.dp))
                Text(
                    chapterLabel(collection.textCount),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        // Per-item progress. The library model doesn't carry per-book progress
        // yet, so this reads 0; a sibling PR wires the real fraction in.
        Spacer(Modifier.size(12.dp))
        ItemProgress(fraction = 0f, label = "Reading progress")
    }
}

/** A text row: a cover initial, the title, a status line for not-yet-ready
 *  texts, and a progress track for ready ones. */
@Composable
private fun TextCardItem(
    card: TextCard,
    language: Language?,
    onClick: () -> Unit,
) {
    LibraryCard(onClick = onClick, enabled = card.isReady) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            CoverArt(initial = coverInitial(card.title, language), tinted = false)
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    card.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!card.isReady) {
                    Spacer(Modifier.size(4.dp))
                    Text(
                        card.status,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        // Ready texts show a progress track (0 for now; a sibling PR supplies the
        // real value). Not-yet-ready texts surface their status line instead.
        if (card.isReady) {
            Spacer(Modifier.size(12.dp))
            ItemProgress(fraction = 0f, label = "Reading progress")
        }
    }
}

/** Shared card surface: an elevated paper card with consistent inner padding and
 *  click/disabled behavior. Children stack vertically. */
@Composable
private fun LibraryCard(
    onClick: () -> Unit,
    enabled: Boolean,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerLowest,
            contentColor = MaterialTheme.colorScheme.onSurface,
            // Keep disabled (not-ready) cards legible: same surface/ink, the
            // muted "processing" status line signals the disabled state instead.
            disabledContainerColor = MaterialTheme.colorScheme.surfaceContainerLowest,
            disabledContentColor = MaterialTheme.colorScheme.onSurface,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp), content = content)
    }
}

/** A square cover placeholder: a tinted block carrying the item's initial (or
 *  language script glyph). Books get a saffron tint; texts a calmer surface. */
@Composable
private fun CoverArt(initial: String, tinted: Boolean) {
    val container = if (tinted) {
        MaterialTheme.colorScheme.primaryContainer
    } else {
        MaterialTheme.colorScheme.secondaryContainer
    }
    val onContainer = if (tinted) {
        MaterialTheme.colorScheme.onPrimaryContainer
    } else {
        MaterialTheme.colorScheme.onSecondaryContainer
    }
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = container,
        contentColor = onContainer,
        modifier = Modifier.size(56.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(
                initial,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

/** A thin reading-progress track plus a trailing percentage. Labelled as one
 *  unit for screen readers ("Reading progress, 0 percent"). */
@Composable
private fun ItemProgress(fraction: Float, label: String) {
    val clamped = fraction.coerceIn(0f, 1f)
    val pct = (clamped * 100).toInt()
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.semantics(mergeDescendants = true) {
            contentDescription = "$label, $pct percent"
        },
    ) {
        LinearProgressIndicator(
            progress = { clamped },
            modifier = Modifier
                .weight(1f)
                .height(6.dp)
                .clip(RoundedCornerShape(3.dp)),
            color = MaterialTheme.colorScheme.primary,
            trackColor = MaterialTheme.colorScheme.surfaceContainerHighest,
        )
        Spacer(Modifier.width(12.dp))
        Text(
            "$pct%",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun SectionHeader(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 4.dp, bottom = 2.dp),
    )
}

/** "12 chapters" / "1 chapter" — never a bare "0". */
private fun chapterLabel(count: Int): String =
    if (count == 1) "1 chapter" else "$count chapters"

/** Cover glyph: the title's first letter/digit, falling back to the language
 *  script glyph for a title that starts with whitespace/symbols. */
private fun coverInitial(title: String, language: Language?): String {
    val first = title.trim().firstOrNull { it.isLetterOrDigit() }
    return when {
        first != null -> first.uppercase()
        language != null -> language.glyph()
        else -> "?"
    }
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
                        Column {
                            Text("${lang.displayName} · ${lang.nativeName}")
                            Text(
                                lang.knownWordsLabel(),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
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

/** Switcher subtitle: how many distinct words the user knows in this
 *  language. Singular/plural so "1 word" reads naturally. */
private fun Language.knownWordsLabel(): String =
    if (knownLemmaCount == 1) "1 word" else "$knownLemmaCount words"

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
