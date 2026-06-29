@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package com.ciareader.reader.ui.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.indication
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextRange
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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
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
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.foundation.lazy.itemsIndexed
import com.ciareader.reader.data.reader.ReaderToken
import com.ciareader.reader.data.reader.SentenceTranslation
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlinx.coroutines.withTimeoutOrNull
import androidx.activity.compose.BackHandler
import androidx.compose.material3.Surface
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties

@Composable
fun ReaderScreen(
    onBack: () -> Unit,
    onOpenChapterText: (textId: String, atEnd: Boolean) -> Unit,
    viewModel: ReaderViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    // Local-only reading-time tracking: accrue active foreground time while
    // the reader is on-screen (START..STOP), flushing on background/leave.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner, viewModel) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> viewModel.onScreenVisible()
                Lifecycle.Event.ON_STOP -> viewModel.onScreenHidden()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            // Leaving the reader without an ON_STOP (e.g. nav back) still flushes.
            viewModel.onScreenHidden()
        }
    }

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
        onToggleStatus = viewModel::toggleStatus,
        onSelectParse = viewModel::selectParse,
        onAddDefinition = viewModel::addDefinition,
        onEditDefinition = viewModel::editDefinition,
        onDeleteDefinition = viewModel::deleteDefinition,
        onSaveDictionaryDefinition = viewModel::saveDefinitionFrom,
        onTranslateSentence = viewModel::translateSentence,
        onRefreshWord = viewModel::refreshSelectedWord,
        onSetBasqueRefSource = viewModel::setBasqueRefSource,
        onBasqueRefSearchInput = viewModel::onBasqueRefSearchInput,
        onBasqueRefSearch = viewModel::searchBasqueReference,
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
    onToggleStatus: (KnownStatus) -> Unit,
    onSelectParse: (String) -> Unit = {},
    onAddDefinition: (String) -> Unit = {},
    onEditDefinition: (String, String) -> Unit = { _, _ -> },
    onDeleteDefinition: (String) -> Unit = {},
    onSaveDictionaryDefinition: (String?, String) -> Unit = { _, _ -> },
    onTranslateSentence: () -> Unit = {},
    onRefreshWord: () -> Unit = {},
    onSetBasqueRefSource: (String) -> Unit = {},
    onBasqueRefSearchInput: (String) -> Unit = {},
    onBasqueRefSearch: (String) -> Unit = {},
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
    // Word popup: the tapped word's bounds in window px (anchors the popup) and
    // whether it's expanded to the full-screen editor.
    var wordAnchor by remember { mutableStateOf<Rect?>(null) }
    var wordExpanded by remember { mutableStateOf(false) }
    // True while an inline note field is open — the compact popup must be focusable
    // then so the keyboard can show (otherwise it stays non-focusable for one-tap
    // word switching).
    var wordEditing by remember { mutableStateOf(false) }
    // "You were here" marker: when the popup closes, the word that was open keeps
    // a brief outline that fades out so the reader can find their place again.
    // Tracked by the token's stable idx; one Animatable drives the alpha for every
    // reading mode, read in the draw phase so only the outline repaints.
    var highlightTokenIdx by remember { mutableStateOf<Int?>(null) }
    val highlightAlpha = remember { Animatable(0f) }
    val closeWord = {
        wordAnchor = null
        wordExpanded = false
        wordEditing = false
        onDismissWord()
    }
    val handleWordTap = { token: ReaderToken, rect: Rect ->
        wordAnchor = rect
        wordExpanded = false
        wordEditing = false
        highlightTokenIdx = token.idx
        onWordTap(token)
    }
    // Hold the outline solid while the popup is open; on close, briefly hold then
    // slowly fade it out (~2s total) over the word's last position.
    val selectionActive = state.selectedWord != null
    LaunchedEffect(selectionActive) {
        if (selectionActive) {
            highlightAlpha.snapTo(1f)
        } else if (highlightTokenIdx != null) {
            highlightAlpha.snapTo(1f)
            highlightAlpha.animateTo(1f, animationSpec = tween(durationMillis = 600))
            highlightAlpha.animateTo(0f, animationSpec = tween(durationMillis = 1600, easing = LinearEasing))
        }
    }
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
                        onWordTap = handleWordTap,
                        onDismissWord = closeWord,
                        onPrevPage = onPrevChapter,
                        onNextPage = onNextChapter,
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
                        onWordTap = handleWordTap,
                        onDismissWord = closeWord,
                        onProgress = onProgress,
                        onRecordPosition = onRecordPosition,
                        restoreTokenIdx = state.restoreTokenIdx,
                        onRestoreConsumed = onRestoreConsumed,
                        highlightTokenIdx = highlightTokenIdx,
                        highlightAlpha = { highlightAlpha.value },
                        modifier = Modifier.fillMaxSize(),
                    )

                else ->
                    ChapterText(
                        tokens = state.tokens,
                        romanize = state.romanize,
                        rtl = state.isRtl,
                        fontSize = state.fontSize,
                        lineSpacing = state.lineSpacing,
                        onWordTap = handleWordTap,
                        onDismissWord = closeWord,
                        onScrolled = closeWord,
                        restoreTokenIdx = state.restoreTokenIdx,
                        onRecordPosition = onRecordPosition,
                        onRestoreConsumed = onRestoreConsumed,
                        onProgress = onProgress,
                        highlightTokenIdx = highlightTokenIdx,
                        highlightAlpha = { highlightAlpha.value },
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
    val anchor = wordAnchor
    if (selected != null && anchor != null) {
        // The compact popup and full-screen editor share one content block; while a
        // note field is open it sets wordEditing so the compact popup turns focusable
        // (and can raise the keyboard).
        val details: @Composable (Modifier) -> Unit = { contentModifier ->
            WordDetails(
                token = selected,
                translations = state.wordTranslations,
                basqueReference = state.basqueReference,
                basqueRefSource = state.basqueRefSource,
                basqueRefAvailable = state.basqueRefAvailable,
                basqueRefSearch = state.basqueRefSearch,
                basqueRefPrefill = state.basqueRefPrefill,
                basqueRefSuggestions = state.basqueRefSuggestions,
                isBasqueRefLoading = state.isBasqueRefLoading,
                isLoading = state.isWordLoading,
                sentenceTranslation = state.sentenceTranslation,
                isSentenceTranslating = state.isSentenceTranslating,
                sentenceTranslateError = state.sentenceTranslateError,
                autoExpandSentence = state.autoExpandSentence,
                activeParseLemmaId = state.activeParseLemmaId,
                primaryHeadword = state.primaryHeadword,
                primaryPos = state.primaryPos,
                onSelectParse = onSelectParse,
                onAddDefinition = onAddDefinition,
                onEditDefinition = onEditDefinition,
                onDeleteDefinition = onDeleteDefinition,
                onSaveDictionaryDefinition = onSaveDictionaryDefinition,
                onSelectBasqueSource = onSetBasqueRefSource,
                onBasqueRefSearchInput = onBasqueRefSearchInput,
                onBasqueRefSearch = onBasqueRefSearch,
                onEditingChange = { wordEditing = it },
                modifier = contentModifier,
            )
        }
        val headword = state.wordTranslations?.headword ?: selected.surface
        val pos = state.wordTranslations?.pos
        val romanization = selected.romanization
        val hasLemma = selected.lemmaId != null
        // The VM toggles against its live status (re-selecting the active status
        // clears it to "new"), so repeated toggles in one open sheet work.
        // Marking known closes the popup right away; the recolor is optimistic in
        // the VM, so we don't wait on the network before dismissing. Toggle first
        // (while the word is still selected), then close.
        val onKnown = {
            onToggleStatus(KnownStatus.KNOWN)
            closeWord()
        }
        val onLearn = { onToggleStatus(KnownStatus.LEARNING) }
        val onIgnore = { onToggleStatus(KnownStatus.IGNORED) }
        if (wordExpanded) {
            Dialog(
                onDismissRequest = closeWord,
                properties = DialogProperties(usePlatformDefaultWidth = false),
            ) {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
                    Column(Modifier.fillMaxSize()) {
                        WordPopupHeader(
                            headword = headword,
                            pos = pos,
                            romanization = romanization,
                            frequency = state.wordFrequency,
                            showRadial = hasLemma,
                            status = selected.status,
                            onKnown = onKnown,
                            onRefresh = onRefreshWord,
                            onLearn = onLearn,
                            onIgnore = onIgnore,
                            onTranslate = onTranslateSentence,
                            expanded = true,
                            onToggleExpand = { wordExpanded = false },
                            onClose = closeWord,
                        )
                        HorizontalDivider()
                        details(Modifier.weight(1f))
                    }
                }
            }
        } else {
            // Back closes the popup rather than leaving the reader. (The expanded
            // Dialog handles its own back via onDismissRequest.)
            BackHandler(onBack = closeWord)
            val density = LocalDensity.current
            val provider = remember(anchor, density) {
                with(density) {
                    WordAnchorPositionProvider(anchor, gapPx = 8.dp.roundToPx(), marginPx = 8.dp.roundToPx())
                }
            }
            // Fixed height (independent of content) so the popup doesn't jump as a
            // note is added — the body scrolls instead. Capped to the screen so it
            // never overflows on short/landscape displays.
            val popupHeight = minOf(420.dp, (LocalConfiguration.current.screenHeightDp * 0.85f).dp)
            Popup(
                popupPositionProvider = provider,
                // Focusable only while editing a note, so the keyboard can show;
                // otherwise non-focusable so a tap on another word switches in one go.
                properties = PopupProperties(focusable = wordEditing),
                onDismissRequest = closeWord,
            ) {
                Surface(
                    modifier = Modifier
                        .width(320.dp)
                        .height(popupHeight),
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.surface,
                    tonalElevation = 3.dp,
                    shadowElevation = 12.dp,
                ) {
                    Column(Modifier.fillMaxSize()) {
                        WordPopupHeader(
                            headword = headword,
                            pos = pos,
                            romanization = romanization,
                            frequency = state.wordFrequency,
                            showRadial = hasLemma,
                            status = selected.status,
                            onKnown = onKnown,
                            onRefresh = onRefreshWord,
                            onLearn = onLearn,
                            onIgnore = onIgnore,
                            onTranslate = onTranslateSentence,
                            expanded = false,
                            onToggleExpand = { wordExpanded = true },
                            onClose = closeWord,
                        )
                        HorizontalDivider()
                        details(Modifier.weight(1f))
                    }
                }
            }
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
    onWordTap: (ReaderToken, Rect) -> Unit,
    onDismissWord: () -> Unit,
    onScrolled: () -> Unit,
    restoreTokenIdx: Int?,
    onRecordPosition: (Int, Double) -> Unit,
    onRestoreConsumed: () -> Unit,
    onProgress: (Float) -> Unit,
    highlightTokenIdx: Int?,
    highlightAlpha: () -> Float,
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
    // Char range of the word to outline as the "you were here" marker, mapped from
    // the highlighted token's stable idx.
    val highlightRange = remember(highlightTokenIdx, tokens, ranges) {
        highlightTokenIdx?.let { id ->
            tokens.indexOfFirst { it.idx == id }.takeIf { it >= 0 }?.let { ranges.getOrNull(it) }
        }
    }
    val outlineColor = scheme.primary
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    var textCoords by remember { mutableStateOf<LayoutCoordinates?>(null) }
    // Fresh scroll position per chapter, so navigating starts at the top.
    val scrollState = remember(tokens) { ScrollState(0) }

    // The word popup is anchored to a fixed window position, so any scroll would
    // detach it from its word — close it as soon as the reader scrolls.
    LaunchedEffect(scrollState) {
        snapshotFlow { scrollState.isScrollInProgress }.collect { if (it) onScrolled() }
    }

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
            .drawWithContent { drawWordOutline(layout, highlightRange, highlightAlpha(), outlineColor) }
            .onGloballyPositioned { textCoords = it }
            .pointerInput(tokens) {
                detectTapGestures { pos ->
                    val result = layout ?: return@detectTapGestures
                    val charOffset = result.getOffsetForPosition(pos)
                    val tokenIndex = ranges.indexOfFirst { charOffset in it }
                    val token = tokens.getOrNull(tokenIndex)
                    val range = ranges.getOrNull(tokenIndex)
                    val rect = if (token != null && token.isWord && range != null) {
                        wordRectInWindow(textCoords, result, range.first, range.last + 1)
                    } else {
                        null
                    }
                    // Tap a word → (re)anchor the popup there; tap anything else
                    // (gap, punctuation) → dismiss it.
                    if (token != null && token.isWord && rect != null) onWordTap(token, rect)
                    else onDismissWord()
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
    onWordTap: (ReaderToken, Rect) -> Unit,
    onDismissWord: () -> Unit,
    onProgress: (Float) -> Unit,
    onRecordPosition: (Int, Double) -> Unit,
    restoreTokenIdx: Int?,
    onRestoreConsumed: () -> Unit,
    highlightTokenIdx: Int?,
    highlightAlpha: () -> Float,
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
                        onDismissWord = onDismissWord,
                        highlightTokenIdx = highlightTokenIdx,
                        highlightAlpha = highlightAlpha,
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
    onWordTap: (ReaderToken, Rect) -> Unit,
    onDismissWord: () -> Unit,
    highlightTokenIdx: Int?,
    highlightAlpha: () -> Float,
) {
    var layout by remember(text) { mutableStateOf<TextLayoutResult?>(null) }
    var textCoords by remember(text) { mutableStateOf<LayoutCoordinates?>(null) }
    val outlineColor = MaterialTheme.colorScheme.primary
    // The highlighted token's char range relative to this page's substring; null
    // unless the word actually falls on this page.
    val highlightRange = remember(highlightTokenIdx, tokens, ranges, baseOffset, text) {
        highlightTokenIdx?.let { id ->
            tokens.indexOfFirst { it.idx == id }.takeIf { it >= 0 }
                ?.let { ranges.getOrNull(it) }
                ?.let { (it.first - baseOffset)..(it.last - baseOffset) }
                ?.takeIf { it.first >= 0 && it.last < text.length }
        }
    }
    Text(
        text = text,
        style = style,
        onTextLayout = { layout = it },
        modifier = Modifier
            .fillMaxSize()
            .drawWithContent { drawWordOutline(layout, highlightRange, highlightAlpha(), outlineColor) }
            .onGloballyPositioned { textCoords = it }
            .pointerInput(text) {
                detectTapGestures { pos ->
                    val result = layout ?: return@detectTapGestures
                    val localOffset = result.getOffsetForPosition(pos)
                    val global = baseOffset + localOffset
                    val tokenIndex = ranges.indexOfFirst { global in it }
                    val token = tokens.getOrNull(tokenIndex)
                    val range = ranges.getOrNull(tokenIndex)
                    val rect = if (token != null && token.isWord && range != null) {
                        wordRectInWindow(textCoords, result, range.first - baseOffset, range.last + 1 - baseOffset)
                    } else {
                        null
                    }
                    if (token != null && token.isWord && rect != null) onWordTap(token, rect)
                    else onDismissWord()
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
        itemsIndexed(chapters) { index, ch ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onSelect(ch) }
                    .padding(horizontal = 24.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        // Numbered so duplicate/blank chapter titles stay distinguishable.
                        "${index + 1}. ${ch.title}",
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
    onAddDefinition: (String) -> Unit = {},
    onEditDefinition: (String, String) -> Unit = { _, _ -> },
    onDeleteDefinition: (String) -> Unit = {},
    // Fork a dictionary entry (official/community/reference/gloss) into a personal
    // definition: (parentTranslationId or null, edited body).
    onSaveDictionaryDefinition: (String?, String) -> Unit = { _, _ -> },
    sentenceTranslation: SentenceTranslation? = null,
    isSentenceTranslating: Boolean = false,
    sentenceTranslateError: String? = null,
    autoExpandSentence: Boolean = false,
    basqueReference: List<BasqueReference> = emptyList(),
    basqueRefSource: String? = null,
    basqueRefAvailable: Boolean = false,
    basqueRefSearch: String = "",
    basqueRefPrefill: String = "",
    basqueRefSuggestions: List<String> = emptyList(),
    isBasqueRefLoading: Boolean = false,
    onSelectBasqueSource: (String) -> Unit = {},
    onBasqueRefSearchInput: (String) -> Unit = {},
    onBasqueRefSearch: (String) -> Unit = {},
    modifier: Modifier = Modifier,
    activeParseLemmaId: String? = token.lemmaId,
    primaryHeadword: String? = null,
    primaryPos: String? = null,
    onSelectParse: (String) -> Unit = {},
    // Fired when the inline note field opens/closes so the host can make the popup
    // focusable while editing (a focusable=false popup can't show the keyboard).
    onEditingChange: (Boolean) -> Unit = {},
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
            // Scrollable so revealing examples grows the content, not the popup.
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        if (parses.size >= 2) {
            ParseSwitcher(parses = parses, activeLemmaId = activeParseLemmaId, onSelect = onSelectParse)
            Spacer(Modifier.height(12.dp))
        }

        // Your own definition first — tap to edit inline, Enter to save.
        if (token.lemmaId != null) {
            PersonalDefinitionEditor(
                notes = translations?.personal.orEmpty(),
                onAdd = onAddDefinition,
                onEdit = onEditDefinition,
                onDelete = onDeleteDefinition,
                onEditingChange = onEditingChange,
            )
            Spacer(Modifier.height(12.dp))
            // A rule separates your own note(s) from the dictionary definitions below.
            if (translations?.personal?.isNotEmpty() == true) {
                HorizontalDivider(Modifier.testTag("personalNoteDivider"))
                Spacer(Modifier.height(12.dp))
            }
        }

        // The dictionary definitions (official/community/gloss). Each is tappable
        // to edit and save as your own personal definition (status + translate are
        // in the header).
        val official = translations?.official.orEmpty()
        val community = translations?.community.orEmpty()
        val hasDictionary =
            official.isNotEmpty() || community.isNotEmpty() || !token.glossDefault.isNullOrBlank()
        when {
            isLoading -> Text(
                "Loading…",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            hasDictionary -> DictionaryDefinitions(
                official = official,
                community = community,
                glossDefault = token.glossDefault,
                canSave = activeParseLemmaId != null,
                onSave = onSaveDictionaryDefinition,
                onEditingChange = onEditingChange,
            )
            // Nothing in the dictionary: only say so when there's no personal note
            // either, matching the pre-existing empty-state copy.
            translations?.personal.isNullOrEmpty() -> Text(
                "No definition yet.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }

        // Sentence translation result (the translate action is the icon up top).
        if (token.isWord && (sentenceTranslation != null || isSentenceTranslating || sentenceTranslateError != null)) {
            Spacer(Modifier.height(16.dp))
            SentenceTranslationSection(
                translation = sentenceTranslation,
                isTranslating = isSentenceTranslating,
                error = sentenceTranslateError,
                startExpanded = autoExpandSentence,
            )
        }

        // Admins see the reference panel whenever an eu lookup has confirmed
        // access — even with zero entries — so the search box is there to recover
        // an inflected/OOV surface form the auto-lookup missed.
        if (basqueRefAvailable) {
            Spacer(Modifier.height(16.dp))
            BasqueReferenceSection(
                entries = basqueReference,
                selectedSource = basqueRefSource,
                search = basqueRefSearch,
                prefill = basqueRefPrefill,
                suggestions = basqueRefSuggestions,
                isLoading = isBasqueRefLoading,
                wordKey = token,
                onSelectSource = onSelectBasqueSource,
                onSearchInput = onBasqueRefSearchInput,
                onSearch = onBasqueRefSearch,
                canSave = activeParseLemmaId != null,
                onSave = onSaveDictionaryDefinition,
                onEditingChange = onEditingChange,
            )
        }
    }
}

/** The hold-radial's four slide actions; a tap on the centre marks the word known. */
internal enum class RadialAction { REFRESH, LEARN, IGNORE, TRANSLATE }

/**
 * Maps a finger offset from the radial centre to a menu action — or null (the
 * centre / dead zone, meaning "known"). Sectors: right = translate, down =
 * ignore, left = learn, up = refresh.
 */
internal fun radialSelectionFor(offset: Offset, deadzonePx: Float): RadialAction? {
    if (offset.getDistance() < deadzonePx) return null
    val deg = Math.toDegrees(atan2(offset.y.toDouble(), offset.x.toDouble()))
    return when {
        deg >= -45 && deg < 45 -> RadialAction.TRANSLATE
        deg >= 45 && deg < 135 -> RadialAction.IGNORE
        deg >= -135 && deg < -45 -> RadialAction.REFRESH
        else -> RadialAction.LEARN
    }
}

/**
 * The header checkmark with a press-and-hold radial menu. A quick tap marks the
 * word known (toggles); holding pops up a radial of refresh / learn / ignore /
 * translate, and sliding toward one then releasing performs it. Releasing at the
 * centre cancels (escape) — only a quick tap marks the word known.
 */
@Composable
internal fun RadialActionButton(
    status: KnownStatus,
    onKnown: () -> Unit,
    onRefresh: () -> Unit,
    onLearn: () -> Unit,
    onIgnore: () -> Unit,
    onTranslate: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var menuVisible by remember { mutableStateOf(false) }
    var selection by remember { mutableStateOf<RadialAction?>(null) }
    // The button's centre in absolute screen px — the ring popup is positioned
    // there directly (anchorBounds is unreliable for a popup nested in the word popup).
    var screenCenter by remember { mutableStateOf(Offset.Zero) }
    val view = LocalView.current
    val interactionSource = remember { MutableInteractionSource() }
    val indication = LocalIndication.current

    Box(
        modifier = modifier
            .size(40.dp)
            .onGloballyPositioned { coords ->
                val loc = IntArray(2)
                view.getLocationOnScreen(loc)
                val p = coords.positionInWindow()
                val s = coords.size
                screenCenter = Offset(loc[0] + p.x + s.width / 2f, loc[1] + p.y + s.height / 2f)
            }
            .semantics { contentDescription = "Known" }
            .indication(interactionSource, indication)
            .pointerInput(Unit) {
                val deadzone = 26.dp.toPx()
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    val press = PressInteraction.Press(down.position)
                    interactionSource.tryEmit(press) // ripple feedback
                    selection = null
                    val center = Offset(size.width / 2f, size.height / 2f)
                    val releasedEarly = withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
                        waitForUpOrCancellation()
                    }
                    if (releasedEarly != null) {
                        interactionSource.tryEmit(PressInteraction.Release(press))
                        onKnown() // a tap (not a hold) is the only thing that marks known
                        return@awaitEachGesture
                    }
                    menuVisible = true
                    var current: RadialAction? = null
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.first()
                        current = radialSelectionFor(change.position - center, deadzone)
                        selection = current
                        if (event.changes.none { it.pressed }) break
                    }
                    menuVisible = false
                    selection = null
                    interactionSource.tryEmit(PressInteraction.Release(press))
                    when (current) {
                        null -> Unit // released at the centre = escape; no status change
                        RadialAction.REFRESH -> onRefresh()
                        RadialAction.LEARN -> onLearn()
                        RadialAction.IGNORE -> onIgnore()
                        RadialAction.TRANSLATE -> onTranslate()
                    }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painter = painterResource(R.drawable.ic_check),
            contentDescription = null,
            tint = if (status == KnownStatus.KNOWN) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        // The ring is centred on this button (the existing checkmark shows through
        // its open centre).
        if (menuVisible) {
            RadialMenuOverlay(screenCenter = screenCenter, status = status, selection = selection)
        }
    }
}

/**
 * Visual ring for [RadialActionButton], anchored to (and centred on) the button
 * so it surrounds the existing checkmark — which shows through the ring's open
 * centre. Purely visual; the gesture is tracked by the button itself.
 */
@Composable
private fun RadialMenuOverlay(screenCenter: Offset, status: KnownStatus, selection: RadialAction?) {
    val density = LocalDensity.current
    val rOuter = with(density) { 100.dp.toPx() }
    val rInner = with(density) { 44.dp.toPx() }
    val ringR = (rOuter + rInner) / 2f
    val thickness = rOuter - rInner
    val iconHalf = with(density) { 12.dp.toPx() }
    val boxDp = with(density) { (rOuter * 2f).toDp() }
    // Place the ring's box so its centre sits on the button's screen centre. The
    // returned offset is the popup window's screen position, so use screen px.
    val provider = remember(screenCenter) {
        object : PopupPositionProvider {
            override fun calculatePosition(
                anchorBounds: IntRect,
                windowSize: IntSize,
                layoutDirection: LayoutDirection,
                popupContentSize: IntSize,
            ) = IntOffset(
                (screenCenter.x - popupContentSize.width / 2f).roundToInt(),
                (screenCenter.y - popupContentSize.height / 2f).roundToInt(),
            )
        }
    }
    // The status that's currently set reads as "checked" (a faint band + tint).
    val activeAction = when (status) {
        KnownStatus.LEARNING -> RadialAction.LEARN
        KnownStatus.IGNORED -> RadialAction.IGNORE
        else -> null
    }
    Popup(popupPositionProvider = provider, properties = PopupProperties(focusable = false)) {
        val scheme = MaterialTheme.colorScheme
        val startFor = mapOf(
            RadialAction.TRANSLATE to -45f,
            RadialAction.IGNORE to 45f,
            RadialAction.LEARN to 135f,
            RadialAction.REFRESH to 225f,
        )
        Box(Modifier.size(boxDp)) {
            Canvas(Modifier.fillMaxSize()) {
                val c = Offset(size.width / 2f, size.height / 2f)
                // Donut ring (open centre, so the real checkmark shows through).
                drawCircle(
                    color = scheme.surfaceVariant,
                    radius = ringR,
                    center = c,
                    style = Stroke(width = thickness),
                )
                fun band(action: RadialAction, color: Color) = drawArc(
                    color = color,
                    startAngle = startFor.getValue(action),
                    sweepAngle = 90f,
                    useCenter = false,
                    topLeft = Offset(c.x - ringR, c.y - ringR),
                    size = Size(ringR * 2, ringR * 2),
                    style = Stroke(width = thickness),
                )
                activeAction?.let { band(it, scheme.primary.copy(alpha = 0.3f)) }
                selection?.let { band(it, scheme.primary) }
            }
            val items = listOf(
                Triple(RadialAction.REFRESH, R.drawable.ic_refresh, 270.0),
                Triple(RadialAction.TRANSLATE, R.drawable.ic_translate, 0.0),
                Triple(RadialAction.IGNORE, R.drawable.ic_delete, 90.0),
                Triple(RadialAction.LEARN, R.drawable.ic_add, 180.0),
            )
            items.forEach { (action, icon, deg) ->
                val rad = Math.toRadians(deg)
                val x = rOuter + (ringR * cos(rad)).toFloat()
                val y = rOuter + (ringR * sin(rad)).toFloat()
                Icon(
                    painter = painterResource(icon),
                    contentDescription = null,
                    tint = when {
                        selection == action -> scheme.onPrimary
                        action == activeAction -> scheme.primary
                        else -> scheme.onSurfaceVariant
                    },
                    modifier = Modifier.offset { IntOffset((x - iconHalf).roundToInt(), (y - iconHalf).roundToInt()) },
                )
            }
        }
    }
}


/**
 * Sentence translation result. While in flight, a small spinner. Once a
 * translation exists, a tappable "Sentence translation" header expands/collapses
 * the sentence + its translation — collapsed by default on recall, expanded right
 * after an explicit translate ([startExpanded]). The translate trigger itself is
 * the translate icon in the action row, not here.
 */
@Composable
private fun SentenceTranslationSection(
    translation: SentenceTranslation?,
    isTranslating: Boolean,
    error: String?,
    startExpanded: Boolean,
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

            error != null ->
                Text(
                    error,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
        }
    }
}

/**
 * The viewer's own definition, shown first and edited in place: tap the note (or
 * the "Add your own definition" placeholder) to open an inline field, Enter to
 * save. [onEditingChange] lets the host make the popup focusable while a field is
 * open (a focusable=false popup can't raise the keyboard).
 */
@Composable
private fun PersonalDefinitionEditor(
    notes: List<WordTranslation>,
    onAdd: (String) -> Unit,
    onEdit: (String, String) -> Unit,
    onDelete: (String) -> Unit,
    onEditingChange: (Boolean) -> Unit,
) {
    // The note id being edited, "" for the add field, or null for none.
    var editingKey by remember(notes) { mutableStateOf<String?>(null) }
    fun open(key: String) {
        editingKey = key
        onEditingChange(true)
    }
    fun close() {
        editingKey = null
        onEditingChange(false)
    }

    notes.forEach { note ->
        val id = note.id
        if (id != null && editingKey == id) {
            // Enter with text → save; Enter with the field cleared → delete it.
            NoteEditField(
                initial = note.body,
                onCommit = { t ->
                    if (t.isBlank()) onDelete(id) else onEdit(id, t)
                    close()
                },
            )
        } else {
            Text(
                note.body,
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(enabled = id != null) { if (id != null) open(id) }
                    .padding(vertical = 4.dp),
            )
        }
    }
    if (notes.isEmpty()) {
        if (editingKey == "") {
            NoteEditField(
                initial = "",
                onCommit = { t ->
                    if (t.isNotBlank()) onAdd(t)
                    close()
                },
            )
        } else {
            Text(
                "Add your own definition",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { open("") }
                    .padding(vertical = 4.dp),
            )
        }
    }
}

private const val GLOSS_KEY = "::gloss"

/**
 * The dictionary definitions for a word — official (internal) first, then any
 * community suggestions (labelled), else the inline gloss. Each entry is tappable:
 * tapping opens an inline editor seeded with that entry's text so the reader can
 * tweak it and press Enter to save it as their OWN personal definition. Official /
 * community entries pass their id as the parent so the server tracks the fork; the
 * gloss has no stored row, so it forks from null. [canSave] is false for OOV tokens
 * (no lemma to attach a personal definition to) — then entries are plain, read-only.
 *
 * Renders nothing when there are no dictionary entries at all (the caller owns the
 * "No definition yet." placeholder, so it isn't shown under a lone personal note).
 */
@Composable
private fun DictionaryDefinitions(
    official: List<WordTranslation>,
    community: List<WordTranslation>,
    glossDefault: String?,
    canSave: Boolean,
    onSave: (parentId: String?, text: String) -> Unit,
    onEditingChange: (Boolean) -> Unit,
) {
    // The entry key being edited, or null for none. Resets when the lists change
    // (e.g. after a save reconciles), mirroring PersonalDefinitionEditor.
    var editingKey by remember(official, community, glossDefault) { mutableStateOf<String?>(null) }
    fun open(key: String) {
        editingKey = key
        onEditingChange(true)
    }
    fun close() {
        editingKey = null
        onEditingChange(false)
    }

    @Composable
    fun entry(key: String, parentId: String?, body: String) {
        if (canSave && editingKey == key) {
            // Seed the editor with the dictionary text; Enter saves it as the
            // viewer's own. A cleared field just cancels (we never delete a
            // dictionary entry — only personal notes can be deleted).
            NoteEditField(
                initial = body,
                onCommit = { t ->
                    if (t.isNotBlank()) onSave(parentId, t)
                    close()
                },
            )
        } else {
            Text(
                body,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(enabled = canSave) { open(key) }
                    .padding(vertical = 4.dp),
            )
        }
    }

    if (official.isEmpty() && community.isEmpty()) {
        // Only the inline gloss to show (or nothing — the caller handles the
        // empty-state copy so it doesn't appear beneath a lone personal note).
        glossDefault?.takeUnless { it.isBlank() }?.let { gloss ->
            entry(key = GLOSS_KEY, parentId = null, body = gloss)
        }
        return
    }

    official.forEach { t -> entry(key = t.id ?: t.body, parentId = t.id, body = t.body) }

    if (community.isNotEmpty()) {
        if (official.isNotEmpty()) Spacer(Modifier.height(8.dp))
        Text(
            "Community",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.primary,
        )
        community.forEach { t ->
            entry(key = "community::" + (t.id ?: t.body), parentId = t.id, body = t.body)
        }
    }
}

/** Single-line inline editor: autofocuses; Enter (Done) commits the trimmed value
 *  (the caller treats a blank value as a delete). */
@Composable
private fun NoteEditField(initial: String, onCommit: (String) -> Unit) {
    // Seed the cursor at the END of the existing text so editing a dictionary entry
    // or note lands ready to tweak the tail, not at character 0.
    var value by remember { mutableStateOf(TextFieldValue(initial, selection = TextRange(initial.length))) }
    val focusRequester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    OutlinedTextField(
        value = value,
        onValueChange = { value = it },
        singleLine = true,
        modifier = Modifier
            .fillMaxWidth()
            .focusRequester(focusRequester),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onCommit(value.text.trim()) }),
    )
    LaunchedEffect(Unit) {
        // The popup has just turned focusable (onEditingChange) — focus the field
        // and explicitly raise the keyboard, which a freshly-focusable popup window
        // doesn't always do on its own.
        focusRequester.requestFocus()
        keyboard?.show()
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
    search: String,
    // The prefilled (parsed) word; the reset (X) appears once [search] differs from it.
    prefill: String,
    suggestions: List<String>,
    isLoading: Boolean,
    // Reset key — drops the focused field when the popup rebinds to another word
    // (the host turns the popup non-focusable again on every word tap).
    wordKey: Any?,
    onSelectSource: (String) -> Unit,
    onSearchInput: (String) -> Unit,
    onSearch: (String) -> Unit,
    onEditingChange: (Boolean) -> Unit,
    canSave: Boolean = false,
    onSave: (parentId: String?, text: String) -> Unit = { _, _ -> },
) {
    val selected = selectedSource?.takeIf { it in BASQUE_REF_ORDER } ?: BASQUE_REF_ORDER.first()
    val keyboard = LocalSoftwareKeyboardController.current
    // The compact popup is non-focusable so a tap on another word switches in one
    // go — but a non-focusable window can't raise the keyboard. So (like the note
    // editor) tapping the box flips the popup focusable, then we focus the field.
    var editing by remember(wordKey) { mutableStateOf(false) }
    fun stopEditing() {
        editing = false
        onEditingChange(false)
        keyboard?.hide()
    }

    // Which reference entry (source + index) is open for editing, if any. Resets
    // when the entries or the selected tab change.
    var editingKey by remember(entries, selected) { mutableStateOf<String?>(null) }
    fun open(key: String) {
        editingKey = key
        onEditingChange(true)
    }
    fun close() {
        editingKey = null
        onEditingChange(false)
    }

    Text(
        "Reference dictionaries",
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.primary,
    )
    Spacer(Modifier.height(8.dp))
    // Search box — the recovery path when the tapped surface isn't itself an entry
    // (Elhuyar wants the lemma; case + spelling matter, hence autocomplete).
    if (editing) {
        val focusRequester = remember { FocusRequester() }
        val density = LocalDensity.current
        // Local editable value so we control the cursor: seed it at the END of the
        // prefilled word (tapping the box usually means trimming the tail), not at 0.
        var fieldValue by remember {
            mutableStateOf(TextFieldValue(search, selection = TextRange(search.length)))
        }
        // Reflect a genuinely-external `search` change (a reset, a suggestion pick, a
        // programmatic prefill) into the field, cursor at the end — but ignore the echo
        // of our own keystrokes (guarded by lastSearch) so mid-word edits don't snap
        // the cursor back to the end on every keypress.
        var lastSearch by remember { mutableStateOf(search) }
        if (search != lastSearch) {
            lastSearch = search
            if (search != fieldValue.text) {
                fieldValue = TextFieldValue(search, selection = TextRange(search.length))
            }
        }
        // The field's bounds in window coordinates — a nested Popup can't trust the
        // anchorBounds it's handed (wrong coordinate space), so we anchor explicitly,
        // the same way the word popup itself does.
        var fieldBounds by remember { mutableStateOf<Rect?>(null) }
        Box(Modifier.fillMaxWidth()) {
            OutlinedTextField(
                value = fieldValue,
                onValueChange = {
                    fieldValue = it
                    onSearchInput(it.text)
                },
                placeholder = { Text("Search…") },
                singleLine = true,
                // Once you've changed the prefilled word, an X resets it and closes.
                trailingIcon = if (fieldValue.text != prefill) {
                    {
                        IconButton(onClick = { onSearchInput(prefill); stopEditing() }) {
                            Icon(painter = painterResource(R.drawable.ic_close), contentDescription = "Reset search")
                        }
                    }
                } else {
                    null
                },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { onSearch(fieldValue.text); stopEditing() }),
                modifier = Modifier
                    .fillMaxWidth()
                    .onGloballyPositioned { coords ->
                        // Absolute screen coords: the suggestion popup renders in a
                        // full-screen window, so window-relative bounds (which differ
                        // by the word popup's offset) would mis-place it.
                        val pos = coords.localToScreen(Offset.Zero)
                        fieldBounds = Rect(pos.x, pos.y, pos.x + coords.size.width, pos.y + coords.size.height)
                    }
                    .focusRequester(focusRequester)
                    .semantics { contentDescription = "Search reference dictionaries" },
            )
            // Suggestions float just above the field in their own window: a real
            // dropdown that overlays the sheet (no reflow) and clears the IME below.
            val bounds = fieldBounds
            if (suggestions.isNotEmpty() && bounds != null) {
                val gapPx = with(density) { 4.dp.roundToPx() }
                val positionProvider = remember(bounds, gapPx) {
                    SuggestionPopupPositionProvider(bounds, gapPx)
                }
                Popup(
                    popupPositionProvider = positionProvider,
                    // Non-focusable so the field keeps focus and the keyboard stays up.
                    properties = PopupProperties(focusable = false),
                    onDismissRequest = {},
                ) {
                    Surface(
                        modifier = Modifier
                            .width(with(density) { bounds.width.toDp() })
                            .heightIn(max = 240.dp),
                        shape = RoundedCornerShape(8.dp),
                        color = MaterialTheme.colorScheme.surface,
                        tonalElevation = 3.dp,
                        shadowElevation = 8.dp,
                    ) {
                        Column(Modifier.verticalScroll(rememberScrollState())) {
                            suggestions.forEach { s ->
                                Text(
                                    s,
                                    style = MaterialTheme.typography.bodyMedium,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable { onSearch(s); stopEditing() }
                                        .padding(horizontal = 12.dp, vertical = 10.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
        LaunchedEffect(Unit) {
            // The popup has just turned focusable — focus the field and raise the
            // keyboard, which a freshly-focusable popup window won't always do itself.
            focusRequester.requestFocus()
            keyboard?.show()
            // Surface suggestions for the prefilled word straight away.
            onSearchInput(search)
        }
    } else {
        ReferenceSearchBox(text = search, onClick = { editing = true; onEditingChange(true) })
    }
    Spacer(Modifier.height(8.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        BASQUE_REF_ORDER.forEach { src ->
            BrandChip(
                label = basqueRefTabLabel(src),
                selected = src == selected,
                onClick = { onSelectSource(src) },
            )
        }
    }
    Spacer(Modifier.height(8.dp))
    when {
        isLoading ->
            Text(
                "Looking up…",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

        else -> {
            val shown = entries.filter { it.source == selected }
            if (shown.isEmpty()) {
                Text(
                    "No ${basqueRefTabLabel(selected)} entries.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                // POS shows only when it changes from the previous entry (1,2,3 izond. → one label).
                // Each entry is tappable to edit + save as your own personal definition.
                shown.forEachIndexed { i, e ->
                    val key = "${e.source}::$i"
                    BasqueRefEntry(
                        entry = e,
                        showPos = i == 0 || shown[i - 1].pos != e.pos,
                        canSave = canSave,
                        editing = editingKey == key,
                        onStartEdit = { open(key) },
                        // A reference entry isn't a stored translation, so it forks from null.
                        onSave = { t ->
                            if (t.isNotBlank()) onSave(null, t)
                            close()
                        },
                    )
                    Spacer(Modifier.height(8.dp))
                }
            }
        }
    }
}

/** The non-editing face of the reference search: looks like the text field but is
 *  a plain tap target, so the first tap can flip the popup focusable before a real
 *  field appears (a tap straight onto a field in a non-focusable popup does nothing). */
@Composable
private fun ReferenceSearchBox(text: String, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(4.dp))
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(4.dp))
            .clickable(onClick = onClick)
            .semantics { contentDescription = "Search reference dictionaries" }
            .padding(horizontal = 16.dp, vertical = 16.dp),
    ) {
        Text(
            text.ifEmpty { "Search…" },
            style = MaterialTheme.typography.bodyLarge,
            color = if (text.isEmpty()) {
                MaterialTheme.colorScheme.onSurfaceVariant
            } else {
                MaterialTheme.colorScheme.onSurface
            },
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun BasqueRefEntry(
    entry: BasqueReference,
    showPos: Boolean,
    canSave: Boolean = false,
    editing: Boolean = false,
    onStartEdit: () -> Unit = {},
    onSave: (String) -> Unit = {},
) {
    var showExamples by remember { mutableStateOf(false) }
    val hasExamples = entry.examples.isNotEmpty()
    if (showPos && entry.pos.isNotBlank()) {
        Text(entry.pos, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (editing) {
        // Seed the editor with the reference text; Enter saves it as the viewer's own.
        NoteEditField(initial = entry.definition, onCommit = onSave)
        return
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth(),
    ) {
        if (entry.definition.isNotBlank()) {
            // Tap the definition to edit + save it as your own; the +/- toggles examples.
            Text(
                entry.definition,
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier
                    .weight(1f)
                    .clickable(enabled = canSave) { onStartEdit() },
            )
        }
        if (hasExamples) {
            Text(
                if (showExamples) "–" else "+",
                style = MaterialTheme.typography.titleLarge,
                color = if (showExamples) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .clickable { showExamples = !showExamples }
                    .semantics { contentDescription = if (showExamples) "Hide examples" else "Show examples" }
                    .padding(start = 12.dp),
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
    onWordTap: (ReaderToken, Rect) -> Unit,
    onDismissWord: () -> Unit,
    onPrevPage: () -> Unit,
    onNextPage: () -> Unit,
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
    // Accumulated horizontal drag while at 1× → a page swipe (reset per page).
    val swipeAccum = remember(imageUrl) { mutableStateOf(0f) }
    var imageCoords by remember(imageUrl) { mutableStateOf<LayoutCoordinates?>(null) }
    val onPrev by rememberUpdatedState(onPrevPage)
    val onNext by rememberUpdatedState(onNextPage)
    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        val swipeThreshold = constraints.maxWidth * 0.22f
        val transformState = rememberTransformableState { zoomChange, panChange, _ ->
            scale = (scale * zoomChange).coerceIn(1f, 5f)
            if (scale > 1f) {
                // Zoomed in: a drag pans the page.
                offset += panChange
            } else {
                // At 1×: a sustained horizontal drag flips to the prev/next page.
                offset = Offset.Zero
                swipeAccum.value += panChange.x
                when {
                    swipeAccum.value <= -swipeThreshold -> { onNext(); swipeAccum.value = 0f }
                    swipeAccum.value >= swipeThreshold -> { onPrev(); swipeAccum.value = 0f }
                }
            }
        }
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
                .onGloballyPositioned { imageCoords = it }
                .pointerInput(tokens) {
                    detectTapGestures { tap ->
                        val nx = tap.x / size.width
                        val ny = tap.y / size.height
                        val token = tokens.firstOrNull { t ->
                            val b = t.bbox
                            t.isWord && b != null &&
                                nx >= b.x && nx <= b.x + b.w &&
                                ny >= b.y && ny <= b.y + b.h
                        }
                        val b = token?.bbox
                        val coords = imageCoords
                        val rect = if (token != null && b != null && coords != null) {
                            val w = coords.size.width.toFloat()
                            val h = coords.size.height.toFloat()
                            val tl = coords.localToWindow(Offset(b.x * w, b.y * h))
                            val br = coords.localToWindow(Offset((b.x + b.w) * w, (b.y + b.h) * h))
                            Rect(tl.x, tl.y, br.x, br.y)
                        } else {
                            null
                        }
                        if (token != null && rect != null) onWordTap(token, rect)
                        else onDismissWord()
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

/**
 * Places the word popup just below the tapped word, or above it when there
 * isn't room below. Centred horizontally on the word and clamped to the screen.
 * [anchor] is the word's bounds in window px; [anchorBounds] (the popup's
 * parent) is intentionally ignored.
 */
/**
 * Positions the reference-search suggestions just above the field, left-aligned to
 * it (the IME sits below the field, so opening upward keeps them visible). Falls
 * back to just below the field only when there isn't room above.
 *
 * [anchor] is the field's bounds in absolute screen coordinates — the suggestion
 * popup renders in a full-screen window, so the [anchorBounds] Compose hands in
 * (relative to the nested word popup's window) can't be trusted.
 */
internal class SuggestionPopupPositionProvider(
    private val anchor: Rect,
    private val gapPx: Int,
) : PopupPositionProvider {
    override fun calculatePosition(
        anchorBounds: IntRect,
        windowSize: IntSize,
        layoutDirection: LayoutDirection,
        popupContentSize: IntSize,
    ): IntOffset {
        val above = anchor.top.roundToInt() - gapPx - popupContentSize.height
        val below = anchor.bottom.roundToInt() + gapPx
        // The field is on-screen and the popup matches its width, so its left edge
        // needs no clamping; only flip below when the popup wouldn't fit above.
        return IntOffset(anchor.left.roundToInt(), if (above >= 0) above else below)
    }
}

private class WordAnchorPositionProvider(
    private val anchor: Rect,
    private val gapPx: Int,
    private val marginPx: Int,
) : PopupPositionProvider {
    override fun calculatePosition(
        anchorBounds: IntRect,
        windowSize: IntSize,
        layoutDirection: LayoutDirection,
        popupContentSize: IntSize,
    ): IntOffset {
        val roomBelow = anchor.bottom + gapPx + popupContentSize.height <= windowSize.height
        val roomAbove = anchor.top - gapPx - popupContentSize.height >= 0
        val below = roomBelow || !roomAbove
        val y = if (below) anchor.bottom + gapPx else anchor.top - gapPx - popupContentSize.height
        val x = anchor.left + anchor.width / 2f - popupContentSize.width / 2f
        val maxX = max(marginPx, windowSize.width - popupContentSize.width - marginPx)
        val maxY = max(marginPx, windowSize.height - popupContentSize.height - marginPx)
        return IntOffset(
            x.roundToInt().coerceIn(marginPx, maxX),
            y.roundToInt().coerceIn(marginPx, maxY),
        )
    }
}

/**
 * Top row of the word popup / full-screen editor: the word itself on the left,
 * then refresh, expand-or-collapse, and close. Kept outside the scrolling body
 * so it stays put as the definition scrolls.
 */
@Composable
internal fun WordPopupHeader(
    headword: String,
    pos: String?,
    romanization: String?,
    /** Book-wide occurrence count; shows an "N×" badge before the action icons.
     *  Hidden when null or zero. */
    frequency: Int? = null,
    showRadial: Boolean,
    status: KnownStatus,
    onKnown: () -> Unit,
    onRefresh: () -> Unit,
    onLearn: () -> Unit,
    onIgnore: () -> Unit,
    onTranslate: () -> Unit,
    expanded: Boolean,
    onToggleExpand: () -> Unit,
    onClose: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 4.dp, top = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(headword, style = MaterialTheme.typography.titleLarge)
                // POS sits small + muted just to the right of the word.
                if (!pos.isNullOrBlank()) {
                    Spacer(Modifier.width(6.dp))
                    Text(
                        pos,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(bottom = 3.dp),
                    )
                }
            }
            if (!romanization.isNullOrBlank()) {
                Text(
                    romanization,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (frequency != null && frequency > 0) {
            Text(
                text = "${frequency}×",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
                modifier = Modifier
                    .semantics {
                        contentDescription =
                            "Appears $frequency ${if (frequency == 1) "time" else "times"} in this book"
                    }
                    .background(
                        MaterialTheme.colorScheme.secondaryContainer,
                        RoundedCornerShape(percent = 50),
                    )
                    .padding(horizontal = 10.dp, vertical = 4.dp),
            )
            Spacer(Modifier.width(8.dp))
        }
        if (showRadial) {
            RadialActionButton(
                status = status,
                onKnown = onKnown,
                onRefresh = onRefresh,
                onLearn = onLearn,
                onIgnore = onIgnore,
                onTranslate = onTranslate,
            )
        }
        IconButton(
            onClick = onToggleExpand,
            modifier = Modifier.size(40.dp).semantics { contentDescription = if (expanded) "Collapse" else "Expand" },
        ) {
            Icon(
                painter = painterResource(if (expanded) R.drawable.ic_fullscreen_exit else R.drawable.ic_fullscreen),
                contentDescription = null,
            )
        }
        IconButton(onClick = onClose, modifier = Modifier.size(40.dp)) {
            Icon(painter = painterResource(R.drawable.ic_close), contentDescription = "Close word")
        }
    }
}

/**
 * Draws the page content, then strokes a fading rounded outline around one token
 * — the "you were here" marker shown briefly after the word popup closes.
 * [localRange] is the token's char range within [layout]; the box hugs the word's
 * own bounds so it never reflows the text. A no-op when [alpha] is 0 or the token
 * isn't laid out on this text.
 */
private fun ContentDrawScope.drawWordOutline(
    layout: TextLayoutResult?,
    localRange: IntRange?,
    alpha: Float,
    color: Color,
) {
    drawContent()
    if (alpha <= 0f || layout == null || localRange == null) return
    val len = layout.layoutInput.text.length
    if (len == 0) return
    val start = localRange.first.coerceIn(0, len - 1)
    val end = localRange.last.coerceIn(start, len - 1)
    val a = layout.getBoundingBox(start)
    val b = layout.getBoundingBox(end)
    val padX = 2.dp.toPx()
    val padY = 1.dp.toPx()
    val left = minOf(a.left, b.left) - padX
    val top = minOf(a.top, b.top) - padY
    val right = maxOf(a.right, b.right) + padX
    val bottom = maxOf(a.bottom, b.bottom) + padY
    drawRoundRect(
        color = color.copy(alpha = alpha),
        topLeft = Offset(left, top),
        size = Size(right - left, bottom - top),
        cornerRadius = CornerRadius(4.dp.toPx()),
        style = Stroke(width = 1.5.dp.toPx()),
    )
}

/** Window-space bounds of a token from its (local) char range in a laid-out text. */
private fun wordRectInWindow(
    coords: LayoutCoordinates?,
    layout: TextLayoutResult,
    localStart: Int,
    localEndExclusive: Int,
): Rect? {
    if (coords == null) return null
    val len = layout.layoutInput.text.length
    if (len == 0) return null
    val start = localStart.coerceIn(0, len - 1)
    val end = (localEndExclusive - 1).coerceIn(start, len - 1)
    val a = layout.getBoundingBox(start)
    val b = layout.getBoundingBox(end)
    val topLeft = coords.localToWindow(Offset(minOf(a.left, b.left), minOf(a.top, b.top)))
    val bottomRight = coords.localToWindow(Offset(maxOf(a.right, b.right), maxOf(a.bottom, b.bottom)))
    return Rect(topLeft.x, topLeft.y, bottomRight.x, bottomRight.y)
}
