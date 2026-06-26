@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package com.ciareader.reader.ui.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ciareader.reader.R
import com.ciareader.reader.data.dictionary.BasqueReference
import com.ciareader.reader.data.dictionary.LemmaTranslations
import com.ciareader.reader.data.dictionary.WordTranslation
import com.ciareader.reader.data.reader.KnownStatus
import com.ciareader.reader.BuildConfig
import coil.compose.AsyncImage
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.material3.TextButton
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import com.ciareader.reader.data.reader.ReaderToken
import com.ciareader.reader.data.reader.SentenceTranslation
import kotlin.math.roundToInt

@Composable
fun ReaderScreen(
    onBack: () -> Unit,
    onOpenChapterText: (textId: String, atEnd: Boolean) -> Unit,
    viewModel: ReaderViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    ReaderScreenContent(
        state = state,
        onBack = onBack,
        onWordTap = viewModel::onWordTap,
        onDismissWord = viewModel::dismissWord,
        // Top arrows jump to the START of the adjacent chapter.
        onPrevChapter = {
            if (state.hasPrev) viewModel.prevChapter() else state.prevTextId?.let { onOpenChapterText(it, false) }
        },
        onNextChapter = {
            if (state.hasNext) viewModel.nextChapter() else state.nextTextId?.let { onOpenChapterText(it, false) }
        },
        // Edge-swiping back opens the previous chapter at its LAST page.
        onSwipeToPrevChapter = {
            if (state.hasPrev) {
                viewModel.loadChapter(state.chapterIdx - 1, atEnd = true, saveOnLoad = true)
            } else {
                state.prevTextId?.let { onOpenChapterText(it, true) }
            }
        },
        onRetry = viewModel::retry,
        onSetStatus = viewModel::setStatus,
        onSelectParse = viewModel::selectParse,
        onAddDefinition = viewModel::addDefinition,
        onTranslateSentence = viewModel::translateSentence,
        onRefreshWord = viewModel::refreshSelectedWord,
        onSetBasqueRefSource = viewModel::setBasqueRefSource,
        onRecordPosition = viewModel::recordPosition,
        onRestoreConsumed = viewModel::onRestoreConsumed,
        onToggleRomanize = viewModel::toggleRomanization,
        onTogglePageMode = viewModel::togglePageMode,
        onToggleImageView = viewModel::toggleImageView,
        onSetFontSize = viewModel::setFontSize,
        onSetLineSpacing = viewModel::setLineSpacing,
        onSelectChapter = { ref ->
            val tid = ref.textId
            if (tid != null) {
                onOpenChapterText(tid, false)
            } else {
                ref.chapterIdx?.let { viewModel.loadChapter(it, saveOnLoad = true) }
            }
        },
        onProgress = viewModel::setProgress,
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
    onSwipeToPrevChapter: () -> Unit = onPrevChapter,
    onRetry: () -> Unit,
    onSetStatus: (KnownStatus) -> Unit,
    onSelectParse: (String) -> Unit = {},
    onAddDefinition: (String) -> Unit = {},
    onTranslateSentence: () -> Unit = {},
    onRefreshWord: () -> Unit = {},
    onSetBasqueRefSource: (String) -> Unit = {},
    onRecordPosition: (Int, Double) -> Unit,
    onRestoreConsumed: () -> Unit,
    onToggleRomanize: () -> Unit,
    onTogglePageMode: () -> Unit,
    onToggleImageView: () -> Unit = {},
    onSetFontSize: (Int) -> Unit = {},
    onSetLineSpacing: (Float) -> Unit = {},
    onSelectChapter: (ReaderChapterRef) -> Unit = {},
    onProgress: (Float) -> Unit = {},
) {
    var showSettings by remember { mutableStateOf(false) }
    var showChapters by remember { mutableStateOf(false) }
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = onPrevChapter, enabled = state.canGoPrev) {
                            Icon(
                                painter = painterResource(R.drawable.ic_chevron_left),
                                contentDescription = "Previous chapter",
                            )
                        }
                        Text(
                            state.title,
                            modifier = Modifier
                                .weight(1f)
                                .clickable(enabled = state.chapters.isNotEmpty()) { showChapters = true },
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            textAlign = TextAlign.Center,
                        )
                        IconButton(onClick = onNextChapter, enabled = state.canGoNext) {
                            Icon(
                                painter = painterResource(R.drawable.ic_chevron_right),
                                contentDescription = "Next chapter",
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(painter = painterResource(R.drawable.ic_close), contentDescription = "Close")
                    }
                },
                actions = {
                    // Image chapters (PDFs) toggle between the page image and the
                    // reflowable OCR text; the label is the view you'll switch to.
                    if (state.pageImageUrl != null) {
                        TextButton(onClick = onToggleImageView) {
                            Text(if (state.imageView) "Text" else "Page")
                        }
                    }
                    IconButton(onClick = { showSettings = true }) {
                        Icon(
                            painter = painterResource(R.drawable.ic_settings),
                            contentDescription = "Reader settings",
                        )
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

                state.errorMessage != null ->
                    ReaderError(message = state.errorMessage, onRetry = onRetry)

                state.isProcessing ->
                    ReaderProcessing(modifier = Modifier.align(Alignment.Center))

                state.pageImageUrl != null && state.imageView ->
                    ReaderImage(
                        imageUrl = BuildConfig.API_BASE_URL.trimEnd('/') + state.pageImageUrl,
                        pageWidth = state.pageWidth,
                        pageHeight = state.pageHeight,
                        tokens = state.tokens,
                        onWordTap = onWordTap,
                        modifier = Modifier.fillMaxSize(),
                    )

                state.pageMode ->
                    PagedChapter(
                        tokens = state.tokens,
                        romanize = state.romanize,
                        rtl = state.isRtl,
                        fontSize = state.fontSize,
                        lineSpacing = state.lineSpacing,
                        canGoPrev = state.canGoPrev,
                        canGoNext = state.canGoNext,
                        prevTitle = state.prevTitle,
                        nextTitle = state.nextTitle,
                        onPrev = onSwipeToPrevChapter,
                        onNext = onNextChapter,
                        onWordTap = onWordTap,
                        onProgress = onProgress,
                        onRecordPosition = onRecordPosition,
                        restoreTokenIdx = state.restoreTokenIdx,
                        onRestoreConsumed = onRestoreConsumed,
                        modifier = Modifier.fillMaxSize(),
                    )

                else ->
                    ChapterText(
                        tokens = state.tokens,
                        romanize = state.romanize,
                        rtl = state.isRtl,
                        fontSize = state.fontSize,
                        lineSpacing = state.lineSpacing,
                        onWordTap = onWordTap,
                        restoreTokenIdx = state.restoreTokenIdx,
                        onRecordPosition = onRecordPosition,
                        onRestoreConsumed = onRestoreConsumed,
                        onProgress = onProgress,
                        modifier = Modifier.fillMaxSize(),
                    )
            }
            if (!state.isLoading && state.errorMessage == null) {
                Row(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surface)
                        .padding(horizontal = 12.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    LinearProgressIndicator(
                        progress = { state.bookProgress },
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "${(state.bookProgress * 100).roundToInt()}%",
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }
        }
    }

    val selected = state.selectedWord
    if (selected != null) {
        // skipPartiallyExpanded: with no partial anchor the sheet can't snap back
        // down when its content changes (e.g. expanding examples) or on any tap.
        ModalBottomSheet(
            onDismissRequest = onDismissWord,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            WordDetails(
                token = selected,
                translations = state.wordTranslations,
                basqueReference = state.basqueReference,
                basqueRefSource = state.basqueRefSource,
                isLoading = state.isWordLoading,
                sentenceTranslation = state.sentenceTranslation,
                isSentenceTranslating = state.isSentenceTranslating,
                sentenceTranslateError = state.sentenceTranslateError,
                autoExpandSentence = state.autoExpandSentence,
                onSetStatus = onSetStatus,
                activeParseLemmaId = state.activeParseLemmaId,
                primaryHeadword = state.primaryHeadword,
                primaryPos = state.primaryPos,
                onSelectParse = onSelectParse,
                onAddDefinition = onAddDefinition,
                onTranslateSentence = onTranslateSentence,
                onRefresh = onRefreshWord,
                onSelectBasqueSource = onSetBasqueRefSource,
            )
        }
    }

    if (showSettings) {
        ModalBottomSheet(onDismissRequest = { showSettings = false }) {
            ReaderSettingsSheet(
                fontSize = state.fontSize,
                lineSpacing = state.lineSpacing,
                pageMode = state.pageMode,
                romanize = state.romanize,
                onSetFontSize = onSetFontSize,
                onSetLineSpacing = onSetLineSpacing,
                onTogglePageMode = onTogglePageMode,
                onToggleRomanize = onToggleRomanize,
            )
        }
    }

    if (showChapters) {
        ModalBottomSheet(onDismissRequest = { showChapters = false }) {
            ChapterListSheet(
                chapters = state.chapters,
                onSelect = {
                    showChapters = false
                    onSelectChapter(it)
                },
            )
        }
    }
}

/** The text to render for a token — romanization for words when enabled. */
private fun displayText(token: ReaderToken, romanize: Boolean): String =
    if (romanize && token.isWord) token.romanization ?: token.surface else token.surface

@Composable
private fun ChapterText(
    tokens: List<ReaderToken>,
    romanize: Boolean,
    rtl: Boolean,
    fontSize: Int,
    lineSpacing: Float,
    onWordTap: (ReaderToken) -> Unit,
    restoreTokenIdx: Int?,
    onRecordPosition: (Int, Double) -> Unit,
    onRestoreConsumed: () -> Unit,
    onProgress: (Float) -> Unit,
    modifier: Modifier = Modifier,
) {
    val scheme = MaterialTheme.colorScheme
    // One AnnotatedString for proper text flow, plus per-token char ranges so a
    // tap maps back to the token under the finger.
    val annotated = remember(tokens, scheme, romanize) {
        buildAnnotatedString {
            tokens.forEach { token ->
                withStyle(spanStyleFor(token, scheme)) { append(displayText(token, romanize)) }
            }
        }
    }
    val ranges = remember(tokens, romanize) {
        var offset = 0
        tokens.map { token ->
            val text = displayText(token, romanize)
            val start = offset
            offset += text.length
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
            onProgress((pct / 100.0).toFloat())
        }
    }

    Text(
        text = annotated,
        onTextLayout = { layout = it },
        style = MaterialTheme.typography.bodyLarge.copy(
            fontSize = fontSize.sp,
            lineHeight = (fontSize * lineSpacing).sp,
            textDirection = if (rtl) TextDirection.Rtl else TextDirection.Content,
            textAlign = if (rtl) TextAlign.Right else TextAlign.Start,
        ),
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
private fun PagedChapter(
    tokens: List<ReaderToken>,
    romanize: Boolean,
    rtl: Boolean,
    fontSize: Int,
    lineSpacing: Float,
    canGoPrev: Boolean,
    canGoNext: Boolean,
    prevTitle: String?,
    nextTitle: String?,
    onPrev: () -> Unit,
    onNext: () -> Unit,
    onWordTap: (ReaderToken) -> Unit,
    onProgress: (Float) -> Unit,
    onRecordPosition: (Int, Double) -> Unit,
    restoreTokenIdx: Int?,
    onRestoreConsumed: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val scheme = MaterialTheme.colorScheme
    val style = MaterialTheme.typography.bodyLarge.copy(
        fontSize = fontSize.sp,
        lineHeight = (fontSize * lineSpacing).sp,
        textDirection = if (rtl) TextDirection.Rtl else TextDirection.Content,
        textAlign = if (rtl) TextAlign.Right else TextAlign.Start,
    )
    val annotated = remember(tokens, scheme, romanize) {
        buildAnnotatedString {
            tokens.forEach { token ->
                withStyle(spanStyleFor(token, scheme)) { append(displayText(token, romanize)) }
            }
        }
    }
    val ranges = remember(tokens, romanize) {
        var offset = 0
        tokens.map { token ->
            val text = displayText(token, romanize)
            val start = offset
            offset += text.length
            start until offset
        }
    }
    val measurer = rememberTextMeasurer()

    BoxWithConstraints(modifier.fillMaxSize().padding(16.dp)) {
        // maxWidth/maxHeight (the BoxWithConstraints scope) → px for the measure pass.
        val availableWidth = maxWidth
        val availableHeight = maxHeight
        val density = LocalDensity.current
        val widthPx = with(density) { availableWidth.roundToPx() }
        val heightPx = with(density) { availableHeight.roundToPx() }
        // One measure pass at the page width; group lines into page-sized ranges.
        val pages = remember(annotated, widthPx, heightPx, style) {
            if (widthPx <= 0 || heightPx <= 0 || annotated.isEmpty()) {
                listOf(0 until annotated.length)
            } else {
                val layout = measurer.measure(
                    text = annotated,
                    style = style,
                    constraints = Constraints(maxWidth = widthPx),
                )
                paginateLines(
                    lineCount = layout.lineCount,
                    lineTop = layout::getLineTop,
                    lineBottom = layout::getLineBottom,
                    lineStart = layout::getLineStart,
                    lineEnd = { layout.getLineEnd(it, visibleEnd = true) },
                    pageHeightPx = heightPx.toFloat(),
                )
            }
        }
        // Sentinel "splash" pages at each edge so swiping past the chapter's
        // first/last page flips to the adjacent chapter.
        val leading = if (canGoPrev) 1 else 0
        val trailing = if (canGoNext) 1 else 0
        val total = leading + pages.size + trailing
        // Start on the saved anchor's page — the last page when coming back to a
        // chapter — otherwise the first real page.
        val restorePage = restoreTokenIdx?.let { t ->
            ranges.getOrNull(t)?.first?.let { c -> pages.indexOfFirst { c in it }.takeIf { it >= 0 } }
        }
        val pagerState = rememberPagerState(initialPage = leading + (restorePage ?: 0), pageCount = { total })
        LaunchedEffect(restoreTokenIdx) { if (restoreTokenIdx != null) onRestoreConsumed() }
        // Settling on an edge splash flips to that chapter.
        LaunchedEffect(pagerState, total) {
            snapshotFlow { pagerState.settledPage }.collect { settled ->
                when {
                    leading == 1 && settled == 0 -> onPrev()
                    trailing == 1 && settled == total - 1 -> onNext()
                }
            }
        }
        LaunchedEffect(pagerState, total, pages) {
            snapshotFlow { pagerState.currentPage }.collect { p ->
                val fraction = if (total > 1) p.toFloat() / (total - 1) else 0f
                onProgress(fraction)
                // Save the spot: the first token of the current (real) page.
                val realPage = (p - leading).coerceIn(0, (pages.size - 1).coerceAtLeast(0))
                val charOffset = pages.getOrNull(realPage)?.first ?: 0
                val tokenIdx = ranges.indexOfFirst { charOffset in it }.coerceAtLeast(0)
                onRecordPosition(tokenIdx, (fraction * 100).toDouble())
            }
        }

        HorizontalPager(state = pagerState, modifier = Modifier.fillMaxSize()) { page ->
            when {
                leading == 1 && page == 0 -> ChapterSplash("Previous chapter", prevTitle)
                trailing == 1 && page == total - 1 -> ChapterSplash("Next chapter", nextTitle)
                else -> {
                    val range = pages.getOrElse(page - leading) { 0 until annotated.length }
                    val start = range.first.coerceIn(0, annotated.length)
                    val end = (range.last + 1).coerceIn(start, annotated.length)
                    PageText(
                        text = annotated.subSequence(start, end),
                        baseOffset = start,
                        style = style,
                        ranges = ranges,
                        tokens = tokens,
                        onWordTap = onWordTap,
                    )
                }
            }
        }
    }
}

@Composable
private fun ChapterSplash(label: String, title: String?) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (!title.isNullOrBlank()) {
            Spacer(Modifier.height(8.dp))
            Text(title, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
        }
        Spacer(Modifier.height(20.dp))
        CircularProgressIndicator()
    }
}

@Composable
private fun PageText(
    text: AnnotatedString,
    baseOffset: Int,
    style: TextStyle,
    ranges: List<IntRange>,
    tokens: List<ReaderToken>,
    onWordTap: (ReaderToken) -> Unit,
) {
    var layout by remember(text) { mutableStateOf<TextLayoutResult?>(null) }
    Text(
        text = text,
        style = style,
        onTextLayout = { layout = it },
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(text) {
                detectTapGestures { pos ->
                    val result = layout ?: return@detectTapGestures
                    val global = baseOffset + result.getOffsetForPosition(pos)
                    val tokenIndex = ranges.indexOfFirst { global in it }
                    tokens.getOrNull(tokenIndex)?.let { if (it.isWord) onWordTap(it) }
                }
            },
    )
}

@Composable
internal fun ChapterListSheet(
    chapters: List<ReaderChapterRef>,
    onSelect: (ReaderChapterRef) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier.fillMaxWidth()) {
        item {
            Text(
                "Chapters",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp),
            )
        }
        items(chapters) { ch ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onSelect(ch) }
                    .padding(horizontal = 24.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        ch.title,
                        style = MaterialTheme.typography.bodyLarge,
                        color = if (ch.isCurrent) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        },
                    )
                    if (ch.wordCount > 0) {
                        Text(
                            "${ch.wordCount} words",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (ch.isCurrent) {
                    Text(
                        "Current",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }
}

@Composable
internal fun ReaderSettingsSheet(
    fontSize: Int,
    lineSpacing: Float,
    pageMode: Boolean,
    romanize: Boolean,
    onSetFontSize: (Int) -> Unit,
    onSetLineSpacing: (Float) -> Unit,
    onTogglePageMode: () -> Unit,
    onToggleRomanize: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(24.dp),
    ) {
        Text("Reader settings", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(12.dp))
        StepperRow(
            label = "Font size",
            value = "${fontSize}pt",
            decreaseDesc = "Decrease font size",
            increaseDesc = "Increase font size",
            onDecrease = { onSetFontSize(fontSize - 1) },
            onIncrease = { onSetFontSize(fontSize + 1) },
        )
        StepperRow(
            label = "Line spacing",
            value = "%.1f".format(lineSpacing),
            decreaseDesc = "Decrease line spacing",
            increaseDesc = "Increase line spacing",
            onDecrease = { onSetLineSpacing(lineSpacing - 0.1f) },
            onIncrease = { onSetLineSpacing(lineSpacing + 0.1f) },
        )
        SwitchRow(label = "Page mode", checked = pageMode, onToggle = onTogglePageMode)
        SwitchRow(label = "Romanization", checked = romanize, onToggle = onToggleRomanize)
    }
}

@Composable
private fun StepperRow(
    label: String,
    value: String,
    decreaseDesc: String,
    increaseDesc: String,
    onDecrease: () -> Unit,
    onIncrease: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        IconButton(onClick = onDecrease, modifier = Modifier.semantics { contentDescription = decreaseDesc }) {
            Text("−", style = MaterialTheme.typography.titleLarge)
        }
        Text(value, style = MaterialTheme.typography.bodyMedium)
        IconButton(onClick = onIncrease, modifier = Modifier.semantics { contentDescription = increaseDesc }) {
            Text("+", style = MaterialTheme.typography.titleLarge)
        }
    }
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onToggle: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onToggle() }
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Switch(checked = checked, onCheckedChange = { onToggle() })
    }
}

@Composable
internal fun WordDetails(
    token: ReaderToken,
    translations: LemmaTranslations?,
    isLoading: Boolean,
    onSetStatus: (KnownStatus) -> Unit,
    onAddDefinition: (String) -> Unit = {},
    sentenceTranslation: SentenceTranslation? = null,
    isSentenceTranslating: Boolean = false,
    sentenceTranslateError: String? = null,
    autoExpandSentence: Boolean = false,
    onTranslateSentence: () -> Unit = {},
    onRefresh: () -> Unit = {},
    basqueReference: List<BasqueReference> = emptyList(),
    basqueRefSource: String? = null,
    onSelectBasqueSource: (String) -> Unit = {},
    modifier: Modifier = Modifier,
    activeParseLemmaId: String? = token.lemmaId,
    primaryHeadword: String? = null,
    primaryPos: String? = null,
    onSelectParse: (String) -> Unit = {},
) {
    // The parser's chosen lemma plus any alternate candidates the parser scored.
    // Two or more selectable parses surface the switcher so a reader can view the
    // definition of a lemma the parser didn't pick.
    val parses = remember(token, primaryHeadword, primaryPos) {
        buildList {
            token.lemmaId?.let { add(WordParse(it, primaryHeadword ?: token.surface, primaryPos)) }
            token.candidates.forEach { add(WordParse(it.lemmaId, it.headword, it.pos)) }
        }
    }
    Column(
        modifier = modifier
            .fillMaxWidth()
            // Scrollable so revealing examples grows the content, not the sheet —
            // otherwise the bottom sheet re-settles (snaps back down) on expand.
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
    ) {
        if (parses.size >= 2) {
            ParseSwitcher(parses = parses, activeLemmaId = activeParseLemmaId, onSelect = onSelectParse)
            Spacer(Modifier.height(12.dp))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(translations?.headword ?: token.surface, style = MaterialTheme.typography.headlineSmall)
                val subtitle = listOfNotNull(token.romanization, translations?.pos).joinToString("  ·  ")
                if (subtitle.isNotEmpty()) {
                    Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (token.lemmaId != null) {
                IconButton(
                    onClick = onRefresh,
                    modifier = Modifier.semantics { contentDescription = "Refresh definitions" },
                ) {
                    Text("↻", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary)
                }
            }
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
            BrandChip("New", token.status == KnownStatus.UNKNOWN) { onSetStatus(KnownStatus.UNKNOWN) }
            BrandChip("Learning", token.status == KnownStatus.LEARNING) { onSetStatus(KnownStatus.LEARNING) }
            BrandChip("Known", token.status == KnownStatus.KNOWN) { onSetStatus(KnownStatus.KNOWN) }
            BrandChip("Ignored", token.status == KnownStatus.IGNORED) { onSetStatus(KnownStatus.IGNORED) }
        }

        // Sentence translation (OpenAI, server-cached). Offered for any word in
        // a chapter; the server reconstructs the sentence around this token.
        if (token.isWord) {
            Spacer(Modifier.height(16.dp))
            SentenceTranslationSection(
                translation = sentenceTranslation,
                isTranslating = isSentenceTranslating,
                error = sentenceTranslateError,
                startExpanded = autoExpandSentence,
                onTranslate = onTranslateSentence,
            )
        }

        // Your own definition sits above the (admin) reference dictionaries.
        // Only words with a lemma can carry a user definition (OOV/punctuation can't).
        if (token.lemmaId != null) {
            Spacer(Modifier.height(16.dp))
            AddDefinitionField(onAdd = onAddDefinition)
        }

        if (basqueReference.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            BasqueReferenceSection(basqueReference, basqueRefSource, onSelectBasqueSource)
        }
    }
}

/**
 * Sentence translation. Before translating, a subtle text action (not a big
 * button). While in flight, a small spinner. Once a translation exists, a
 * tappable "Sentence translation" header expands/collapses the sentence + its
 * translation — collapsed by default on recall, expanded right after an explicit
 * translate ([startExpanded]).
 */
@Composable
private fun SentenceTranslationSection(
    translation: SentenceTranslation?,
    isTranslating: Boolean,
    error: String?,
    startExpanded: Boolean,
    onTranslate: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        when {
            translation != null -> {
                var expanded by remember(translation) { mutableStateOf(startExpanded) }
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { expanded = !expanded },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Sentence translation",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        if (expanded) "–" else "+",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                if (expanded) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        translation.sentence,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(translation.translation, style = MaterialTheme.typography.bodyLarge)
                }
            }

            isTranslating ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    Text(
                        "Translating sentence…",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

            else -> {
                // Outlined (not filled/full-width) — clearly a button so it's
                // obvious it translates the sentence, without dominating the sheet.
                OutlinedButton(
                    onClick = onTranslate,
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                ) {
                    Text("Translate sentence", color = MaterialTheme.colorScheme.onSurface)
                }
                if (error != null) {
                    Text(
                        error,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }
    }
}

@Composable
private fun AddDefinitionField(onAdd: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            placeholder = { Text("Add your own definition") },
            singleLine = true,
            modifier = Modifier.weight(1f),
        )
        Button(onClick = { onAdd(text); text = "" }, enabled = text.isNotBlank()) {
            Text("Add")
        }
    }
}

@Composable
private fun BrandChip(label: String, selected: Boolean, onClick: () -> Unit) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label) },
        // Default selected chip has a transparent border + a container near our
        // surface colour, so it reads as unselected — give it the saffron brand.
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
            selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
        ),
        border = FilterChipDefaults.filterChipBorder(
            enabled = true,
            selected = selected,
            selectedBorderColor = MaterialTheme.colorScheme.primary,
            selectedBorderWidth = 1.dp,
        ),
    )
}

private val BASQUE_REF_ORDER = listOf("elhuyar_es", "elhuyar_en", "euskaltzaindia")

private fun basqueRefTabLabel(source: String): String = when (source) {
    "elhuyar_es" -> "ES"
    "elhuyar_en" -> "EN"
    "euskaltzaindia" -> "EU"
    else -> source.uppercase()
}

@Composable
private fun BasqueReferenceSection(
    entries: List<BasqueReference>,
    selectedSource: String?,
    onSelectSource: (String) -> Unit,
) {
    val available = BASQUE_REF_ORDER.filter { src -> entries.any { it.source == src } }
    if (available.isEmpty()) return
    val selected = selectedSource?.takeIf { it in available } ?: available.first()

    Text(
        "Reference dictionaries",
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.primary,
    )
    Spacer(Modifier.height(8.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        available.forEach { src ->
            BrandChip(
                label = basqueRefTabLabel(src),
                selected = src == selected,
                onClick = { onSelectSource(src) },
            )
        }
    }
    Spacer(Modifier.height(8.dp))
    val shown = entries.filter { it.source == selected }
    // POS shows only when it changes from the previous entry (1,2,3 izond. → one label).
    shown.forEachIndexed { i, e ->
        BasqueRefEntry(e, showPos = i == 0 || shown[i - 1].pos != e.pos)
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun BasqueRefEntry(entry: BasqueReference, showPos: Boolean) {
    var showExamples by remember { mutableStateOf(false) }
    val hasExamples = entry.examples.isNotEmpty()
    if (showPos && entry.pos.isNotBlank()) {
        Text(entry.pos, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        // The whole row toggles the examples, not just the +.
        modifier = if (hasExamples) {
            Modifier
                .fillMaxWidth()
                .clickable { showExamples = !showExamples }
                .semantics { contentDescription = if (showExamples) "Hide examples" else "Show examples" }
        } else {
            Modifier.fillMaxWidth()
        },
    ) {
        if (entry.definition.isNotBlank()) {
            Text(entry.definition, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        }
        if (hasExamples) {
            Text(
                if (showExamples) "–" else "+",
                style = MaterialTheme.typography.titleLarge,
                color = if (showExamples) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 12.dp),
            )
        }
    }
    if (showExamples) {
        entry.examples.forEach { ex ->
            Text(ex, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** One selectable parsing of the tapped word: a lemma plus a label. */
private data class WordParse(val lemmaId: String, val headword: String, val pos: String?)

/** Segmented control at the top of the word sheet for switching which parsing's
 *  definition is shown. Scrolls horizontally so any number of candidates fits.
 *  POS rides on the label so same-headword parses (e.g. a noun vs. a verb) stay
 *  distinguishable. */
@Composable
private fun ParseSwitcher(
    parses: List<WordParse>,
    activeLemmaId: String?,
    onSelect: (String) -> Unit,
) {
    // Folder tabs: a light base line flanks the tabs. The active tab is open at the
    // bottom (3-sided outline) and paints over the line with the sheet colour, so
    // the line is broken under it and the tab "opens" into the definition panel
    // below — while still bordering the line to its left and right. Neutral colours
    // (no bold accent). A plain clickable Box (not Surface) avoids the 48dp min
    // touch target that would add a gap.
    // One colour for the base line AND every tab border, so they read as a single
    // continuous frame. onSurface (near-white in dark, near-black in light) so the
    // frame stands out a bit more than the faint outline roles, theme-safely.
    val lineColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
    val sheetColor = BottomSheetDefaults.ContainerColor
    val tabShape = RoundedCornerShape(topStart = 10.dp, topEnd = 10.dp)
    Box(modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Word parsings" }) {
        HorizontalDivider(
            modifier = Modifier.align(Alignment.BottomStart),
            thickness = 1.dp,
            color = lineColor,
        )
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            parses.forEach { parse ->
                val selected = parse.lemmaId == activeLemmaId
                val label = parse.pos?.takeIf { it.isNotBlank() }?.let { "${parse.headword} · $it" } ?: parse.headword
                val tabModifier =
                    if (selected) {
                        Modifier
                            .background(sheetColor, tabShape) // break the line under the open mouth
                            .openTopTabOutline(lineColor, 1.5.dp, 10.dp)
                    } else {
                        Modifier.border(1.dp, lineColor, tabShape)
                    }
                Box(
                    modifier = Modifier
                        .clip(tabShape)
                        .then(tabModifier)
                        .clickable { onSelect(parse.lemmaId) }
                        .padding(horizontal = 14.dp, vertical = if (selected) 9.dp else 6.dp),
                ) {
                    Text(
                        label,
                        style = MaterialTheme.typography.labelLarge,
                        color = if (selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

/** A rounded-top, OPEN-bottom border (top + both sides only) so the active parse
 *  tab reads like a folder tab opening into the content below. */
private fun Modifier.openTopTabOutline(color: Color, stroke: Dp, radius: Dp): Modifier =
    drawBehind {
        val sw = stroke.toPx()
        val r = radius.toPx()
        val inset = sw / 2f
        val left = inset
        val right = size.width - inset
        val top = inset
        val bottom = size.height
        val path = Path().apply {
            moveTo(left, bottom)
            lineTo(left, top + r)
            arcTo(Rect(left, top, left + 2f * r, top + 2f * r), 180f, 90f, false)
            lineTo(right - r, top)
            arcTo(Rect(right - 2f * r, top, right, top + 2f * r), 270f, 90f, false)
            lineTo(right, bottom)
        }
        drawPath(path, color, style = Stroke(width = sw))
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

/** Shown while a freshly-imported chapter is still being tokenized server-side. */
@Composable
private fun ReaderProcessing(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator()
        Spacer(Modifier.size(16.dp))
        Text("Preparing this text…", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.size(4.dp))
        Text(
            "Words become tappable once it's ready.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * Page-image (PDF) reader: the rasterized page with each OCR word overlaid as a
 * tappable region (from its normalized bbox). Pinch-zoom + pan; new/learning
 * words get a faint tint so they stand out against the page.
 */
@Composable
private fun ReaderImage(
    imageUrl: String,
    pageWidth: Int?,
    pageHeight: Int?,
    tokens: List<ReaderToken>,
    onWordTap: (ReaderToken) -> Unit,
    modifier: Modifier = Modifier,
) {
    val scheme = MaterialTheme.colorScheme
    val aspect = if (pageWidth != null && pageHeight != null && pageHeight > 0) {
        pageWidth.toFloat() / pageHeight.toFloat()
    } else {
        1f
    }
    var scale by remember(imageUrl) { mutableStateOf(1f) }
    var offset by remember(imageUrl) { mutableStateOf(Offset.Zero) }
    val transformState = rememberTransformableState { zoomChange, panChange, _ ->
        scale = (scale * zoomChange).coerceIn(1f, 5f)
        offset = if (scale <= 1f) Offset.Zero else offset + panChange
    }
    Box(modifier, contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(aspect)
                .graphicsLayer(
                    scaleX = scale,
                    scaleY = scale,
                    translationX = offset.x,
                    translationY = offset.y,
                )
                .transformable(transformState)
                .pointerInput(tokens) {
                    detectTapGestures { tap ->
                        val nx = tap.x / size.width
                        val ny = tap.y / size.height
                        tokens.firstOrNull { t ->
                            val b = t.bbox
                            t.isWord && b != null &&
                                nx >= b.x && nx <= b.x + b.w &&
                                ny >= b.y && ny <= b.y + b.h
                        }?.let(onWordTap)
                    }
                },
        ) {
            AsyncImage(
                model = imageUrl,
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.FillBounds,
            )
            Canvas(Modifier.fillMaxSize()) {
                tokens.forEach { t ->
                    val b = t.bbox ?: return@forEach
                    if (!t.isWord) return@forEach
                    val tint = overlayTint(t.status, scheme) ?: return@forEach
                    drawRect(
                        color = tint,
                        topLeft = Offset(b.x * size.width, b.y * size.height),
                        size = Size(b.w * size.width, b.h * size.height),
                    )
                }
            }
        }
    }
}

/** Faint highlight for words worth attention on the page image; null = no tint,
 *  so known/ignored words read cleanly against the page. */
private fun overlayTint(status: KnownStatus, scheme: ColorScheme): Color? = when (status) {
    KnownStatus.UNKNOWN -> scheme.primary.copy(alpha = 0.20f)
    KnownStatus.LEARNING -> scheme.primaryContainer.copy(alpha = 0.45f)
    else -> null
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
