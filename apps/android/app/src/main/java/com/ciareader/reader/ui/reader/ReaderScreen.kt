@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package com.ciareader.reader.ui.reader

import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.BottomAppBar
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ciareader.reader.data.dictionary.LemmaTranslations
import com.ciareader.reader.data.dictionary.WordTranslation
import com.ciareader.reader.data.reader.KnownStatus
import com.ciareader.reader.data.reader.ReaderToken
import kotlin.math.roundToInt

@Composable
fun ReaderScreen(onBack: () -> Unit, viewModel: ReaderViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    ReaderScreenContent(
        state = state,
        onBack = onBack,
        onWordTap = viewModel::onWordTap,
        onDismissWord = viewModel::dismissWord,
        onPrevChapter = viewModel::prevChapter,
        onNextChapter = viewModel::nextChapter,
        onRetry = viewModel::retry,
        onSetStatus = viewModel::setStatus,
        onRecordPosition = viewModel::recordPosition,
        onRestoreConsumed = viewModel::onRestoreConsumed,
    )
}

@Composable
internal fun ReaderScreenContent(
    state: ReaderUiState,
    onBack: () -> Unit,
    onWordTap: (ReaderToken) -> Unit,
    onDismissWord: () -> Unit,
    onPrevChapter: () -> Unit,
    onNextChapter: () -> Unit,
    onRetry: () -> Unit,
    onSetStatus: (KnownStatus) -> Unit,
    onRecordPosition: (Int, Double) -> Unit,
    onRestoreConsumed: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        state.title.ifEmpty { "Reader" },
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
            )
        },
        bottomBar = {
            if (state.chapterCount > 1) {
                ChapterNavBar(
                    chapterIdx = state.chapterIdx,
                    chapterCount = state.chapterCount,
                    hasPrev = state.hasPrev,
                    hasNext = state.hasNext,
                    onPrev = onPrevChapter,
                    onNext = onNextChapter,
                )
            }
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
                    ReaderError(message = state.errorMessage, onRetry = onRetry)

                else ->
                    ChapterText(
                        tokens = state.tokens,
                        onWordTap = onWordTap,
                        restoreTokenIdx = state.restoreTokenIdx,
                        onRecordPosition = onRecordPosition,
                        onRestoreConsumed = onRestoreConsumed,
                        modifier = Modifier.fillMaxSize(),
                    )
            }
        }
    }

    val selected = state.selectedWord
    if (selected != null) {
        ModalBottomSheet(onDismissRequest = onDismissWord) {
            WordDetails(
                token = selected,
                translations = state.wordTranslations,
                isLoading = state.isWordLoading,
                onSetStatus = onSetStatus,
            )
        }
    }
}

@Composable
private fun ChapterText(
    tokens: List<ReaderToken>,
    onWordTap: (ReaderToken) -> Unit,
    restoreTokenIdx: Int?,
    onRecordPosition: (Int, Double) -> Unit,
    onRestoreConsumed: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val scheme = MaterialTheme.colorScheme
    // One AnnotatedString for proper text flow, plus per-token char ranges so a
    // tap maps back to the token under the finger.
    val annotated = remember(tokens, scheme) {
        buildAnnotatedString {
            tokens.forEach { token ->
                withStyle(spanStyleFor(token, scheme)) { append(token.surface) }
            }
        }
    }
    val ranges = remember(tokens) {
        var offset = 0
        tokens.map { token ->
            val start = offset
            offset += token.surface.length
            start until offset
        }
    }
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    // Fresh scroll position per chapter, so navigating starts at the top.
    val scrollState = remember(tokens) { ScrollState(0) }

    // Restore the saved reading anchor once the chapter has laid out.
    LaunchedEffect(layout, restoreTokenIdx) {
        val result = layout ?: return@LaunchedEffect
        val target = restoreTokenIdx ?: return@LaunchedEffect
        ranges.getOrNull(target)?.let { range ->
            scrollState.scrollTo(result.getLineTop(result.getLineForOffset(range.first)).roundToInt())
        }
        onRestoreConsumed()
    }

    // Report the top-visible token + percentage as the user scrolls; the
    // ViewModel debounces the actual write-back.
    LaunchedEffect(layout, scrollState) {
        val result = layout ?: return@LaunchedEffect
        snapshotFlow { scrollState.value }.collect { y ->
            val line = result.getLineForVerticalPosition(y.toFloat())
            val charOffset = result.getLineStart(line)
            val tokenIdx = ranges.indexOfFirst { charOffset in it }.coerceAtLeast(0)
            val pct = if (scrollState.maxValue > 0) {
                (y.toFloat() / scrollState.maxValue * 100).toDouble()
            } else {
                0.0
            }
            onRecordPosition(tokenIdx, pct)
        }
    }

    Text(
        text = annotated,
        onTextLayout = { layout = it },
        style = MaterialTheme.typography.bodyLarge,
        modifier = modifier
            .verticalScroll(scrollState)
            .padding(16.dp)
            .pointerInput(tokens) {
                detectTapGestures { pos ->
                    val result = layout ?: return@detectTapGestures
                    val charOffset = result.getOffsetForPosition(pos)
                    val tokenIndex = ranges.indexOfFirst { charOffset in it }
                    tokens.getOrNull(tokenIndex)?.let { if (it.isWord) onWordTap(it) }
                }
            },
    )
}

@Composable
private fun ChapterNavBar(
    chapterIdx: Int,
    chapterCount: Int,
    hasPrev: Boolean,
    hasNext: Boolean,
    onPrev: () -> Unit,
    onNext: () -> Unit,
) {
    BottomAppBar {
        TextButton(onClick = onPrev, enabled = hasPrev) { Text("Previous") }
        Spacer(Modifier.weight(1f))
        Text("Ch. ${chapterIdx + 1} / $chapterCount")
        Spacer(Modifier.weight(1f))
        TextButton(onClick = onNext, enabled = hasNext) { Text("Next") }
    }
}

@Composable
internal fun WordDetails(
    token: ReaderToken,
    translations: LemmaTranslations?,
    isLoading: Boolean,
    onSetStatus: (KnownStatus) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(24.dp),
    ) {
        Text(translations?.headword ?: token.surface, style = MaterialTheme.typography.headlineSmall)
        val subtitle = listOfNotNull(token.romanization, translations?.pos).joinToString("  ·  ")
        if (subtitle.isNotEmpty()) {
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.height(12.dp))

        when {
            isLoading ->
                Text("Loading…", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

            translations != null && !translations.isEmpty ->
                TranslationGroups(translations)

            else ->
                Text(token.glossDefault ?: "No definition yet.", style = MaterialTheme.typography.bodyLarge)
        }

        Spacer(Modifier.height(16.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusChip("New", token.status == KnownStatus.UNKNOWN) { onSetStatus(KnownStatus.UNKNOWN) }
            StatusChip("Learning", token.status == KnownStatus.LEARNING) { onSetStatus(KnownStatus.LEARNING) }
            StatusChip("Known", token.status == KnownStatus.KNOWN) { onSetStatus(KnownStatus.KNOWN) }
            StatusChip("Ignored", token.status == KnownStatus.IGNORED) { onSetStatus(KnownStatus.IGNORED) }
        }
    }
}

@Composable
private fun StatusChip(label: String, selected: Boolean, onClick: () -> Unit) {
    FilterChip(selected = selected, onClick = onClick, label = { Text(label) })
}

@Composable
private fun TranslationGroups(translations: LemmaTranslations) {
    TranslationGroup("Your notes", translations.personal)
    TranslationGroup("Dictionary", translations.official)
    TranslationGroup("Community", translations.community)
}

@Composable
private fun TranslationGroup(title: String, items: List<WordTranslation>) {
    if (items.isEmpty()) return
    Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
    items.forEach { item ->
        // Source attribution is intentionally not shown here — the web reader
        // doesn't surface it either (it only appears in the admin dictionary
        // editor). WordTranslation.attribution is kept for potential future use.
        Text(item.body, style = MaterialTheme.typography.bodyLarge)
    }
    Spacer(Modifier.height(8.dp))
}

@Composable
private fun ReaderError(message: String, onRetry: () -> Unit) {
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

private fun spanStyleFor(token: ReaderToken, scheme: ColorScheme): SpanStyle = when {
    !token.isWord -> SpanStyle(color = scheme.onSurface)
    token.status == KnownStatus.UNKNOWN -> SpanStyle(color = scheme.primary)
    token.status == KnownStatus.LEARNING ->
        SpanStyle(color = scheme.onSurface, background = scheme.primaryContainer)
    token.status == KnownStatus.IGNORED -> SpanStyle(color = scheme.onSurfaceVariant)
    else -> SpanStyle(color = scheme.onSurface) // KNOWN
}

private fun statusLabel(status: KnownStatus): String = when (status) {
    KnownStatus.UNKNOWN -> "New"
    KnownStatus.LEARNING -> "Learning"
    KnownStatus.KNOWN -> "Known"
    KnownStatus.IGNORED -> "Ignored"
}
