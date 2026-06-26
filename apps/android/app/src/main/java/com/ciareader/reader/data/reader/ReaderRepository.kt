package com.ciareader.reader.data.reader

import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.core.network.apiCall
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/** A word/lemma's familiarity, driving its highlight in the reader. */
@Serializable
enum class KnownStatus {
    UNKNOWN,
    LEARNING,
    KNOWN,
    IGNORED,
    ;

    companion object {
        fun fromWire(value: String): KnownStatus = when (value) {
            "known" -> KNOWN
            "learning" -> LEARNING
            "ignored" -> IGNORED
            else -> UNKNOWN
        }
    }
}

/** An alternate parsing the parser scored for an ambiguous surface form. The
 *  word sheet's parse switcher lists these so a reader can view the definition
 *  of a lemma other than the one the parser chose. */
@Serializable
data class ParseCandidate(
    val lemmaId: String,
    val headword: String,
    val pos: String?,
    val glossDefault: String?,
)

/** A rendered token in a chapter (word or punctuation/whitespace).
 *  Serializable so a chapter's tokens can be cached as a JSON blob. */
@Serializable
data class ReaderToken(
    val idx: Int,
    val surface: String,
    val isWord: Boolean,
    val status: KnownStatus,
    val lemmaId: String?,
    val romanization: String?,
    val glossDefault: String?,
    val isOov: Boolean,
    val isAmbiguous: Boolean,
    val hasDefinition: Boolean,
    /** Alternate parsings beyond the parser's chosen lemma; empty when
     *  unambiguous. Drives the word sheet's parse switcher. */
    val candidates: List<ParseCandidate> = emptyList(),
    /** PDF source only: normalized (0..1) bounding box for the image overlay. */
    val bbox: Bbox? = null,
)

/** A word's normalized (0..1) box on the page image (image-reader overlay). */
@Serializable
data class Bbox(
    val x: Float,
    val y: Float,
    val w: Float,
    val h: Float,
)

data class Chapter(
    val chapterIdx: Int,
    val tokens: List<ReaderToken>,
    /** The chapter's server id (UUID), needed to ask the server to translate a
     *  sentence around a token. Null for chapters cached before this column was
     *  added (the destructive-migration DB clears those on upgrade anyway). */
    val chapterId: String? = null,
    /** PDF (image) chapters: the page image + its pixel size for the image
     *  reader's tappable overlay. Null for text-source chapters. */
    val pageImageUrl: String? = null,
    val pageWidth: Int? = null,
    val pageHeight: Int? = null,
)

/** A sentence and its translation, for the word sheet's "Translate sentence". */
data class SentenceTranslation(
    val sentence: String,
    val translation: String,
)

data class ChapterRef(
    val idx: Int,
    val title: String,
    val tokenCount: Int,
)

data class TextMeta(
    val id: String,
    val title: String,
    val language: String,
    val status: String,
    val chapterCount: Int,
    val chapters: List<ChapterRef>,
)

/** The reader's saved anchor: which chapter/token and how far through. */
data class ReadingProgress(
    val chapterIdx: Int,
    val tokenIdx: Int,
    val pctRead: Double,
)

interface ReaderRepository {
    suspend fun textMeta(textId: String): Outcome<TextMeta>
    suspend fun chapter(textId: String, chapterIdx: Int): Outcome<Chapter>
    suspend fun progress(textId: String): Outcome<ReadingProgress?>
    suspend fun saveProgress(
        textId: String,
        chapterIdx: Int,
        tokenIdx: Int,
        pctRead: Double,
    ): Outcome<Unit>

    /** Translate the sentence around [tokenIdx] in [chapterId] (server-side
     *  reconstruction + cache). A blank translation maps to Failure so the UI
     *  can show a "couldn't translate" message rather than an empty result. */
    suspend fun translateSentence(
        chapterId: String,
        tokenIdx: Int,
        language: String,
    ): Outcome<SentenceTranslation>

    /** Cache-only lookup for an already-saved sentence translation — never spends
     *  on the model. Failure on a miss. Used to recall a saved translation the
     *  moment a word in that sentence opens. */
    suspend fun cachedSentenceTranslation(
        chapterId: String,
        tokenIdx: Int,
        language: String,
    ): Outcome<SentenceTranslation>
}

@Singleton
class ReaderRepositoryImpl @Inject constructor(
    private val api: ReaderApi,
    private val cache: ReaderCache,
) : ReaderRepository {

    // Network-first: a successful fetch refreshes the on-device cache; a
    // failure (typically offline) falls back to the cache when we have it, so
    // a previously-read text stays readable without a connection.
    override suspend fun textMeta(textId: String): Outcome<TextMeta> =
        when (val net = apiCall { api.textMeta(textId).toDomain() }) {
            is Outcome.Success -> {
                cache.putTextMeta(net.data, System.currentTimeMillis())
                net
            }
            is Outcome.Failure -> cache.textMeta(textId)?.let { Outcome.Success(it) } ?: net
        }

    override suspend fun chapter(textId: String, chapterIdx: Int): Outcome<Chapter> =
        when (val net = apiCall { api.chapterTokens(textId, chapterIdx).toDomain() }) {
            is Outcome.Success -> {
                cache.putChapter(textId, net.data, System.currentTimeMillis())
                net
            }
            is Outcome.Failure -> cache.chapter(textId, chapterIdx)?.let { Outcome.Success(it) } ?: net
        }

    override suspend fun progress(textId: String): Outcome<ReadingProgress?> {
        val net = apiCall {
            api.progress(textId).progress?.let {
                ReadingProgress(it.lastChapterIdx, it.lastTokenIdx, it.pctRead)
            }
        }
        val pending = cache.pendingProgress(textId)
        return when (net) {
            // Online: an unsynced local position is newer than the server's, so
            // prefer it — and push the whole queue while we have a connection.
            is Outcome.Success -> {
                if (pending != null) flushPending()
                Outcome.Success(pending ?: net.data)
            }
            // Offline: resume from the queued local position if we have one.
            is Outcome.Failure -> Outcome.Success(pending)
        }
    }

    override suspend fun saveProgress(
        textId: String,
        chapterIdx: Int,
        tokenIdx: Int,
        pctRead: Double,
    ): Outcome<Unit> =
        when (val net = apiCall { api.saveProgress(textId, SaveProgressRequest(chapterIdx, tokenIdx, pctRead)); Unit }) {
            // Saved server-side: this is now the newest, so drop any stale queued
            // write for this text and opportunistically flush the rest.
            is Outcome.Success -> {
                cache.clearPending(textId)
                flushPending()
                net
            }
            // Offline: queue the position so it survives and syncs on reconnect.
            is Outcome.Failure -> {
                cache.queueProgress(textId, chapterIdx, tokenIdx, pctRead, System.currentTimeMillis())
                net
            }
        }

    override suspend fun translateSentence(
        chapterId: String,
        tokenIdx: Int,
        language: String,
    ): Outcome<SentenceTranslation> =
        sentenceTranslation(TranslateSentenceRequest(chapterId, tokenIdx, language), "Couldn't translate this sentence.")

    override suspend fun cachedSentenceTranslation(
        chapterId: String,
        tokenIdx: Int,
        language: String,
    ): Outcome<SentenceTranslation> =
        sentenceTranslation(
            TranslateSentenceRequest(chapterId, tokenIdx, language, cachedOnly = true),
            "No saved translation.",
        )

    private suspend fun sentenceTranslation(
        request: TranslateSentenceRequest,
        missMessage: String,
    ): Outcome<SentenceTranslation> =
        when (val net = apiCall { api.translateSentence(request) }) {
            is Outcome.Success -> {
                val body = net.data
                val translation = body.translation?.takeIf { it.isNotBlank() }
                if (translation != null) {
                    Outcome.Success(SentenceTranslation(body.sentence, translation))
                } else {
                    Outcome.Failure(missMessage)
                }
            }
            is Outcome.Failure -> net
        }

    /** Upload queued offline positions; drop each as it succeeds. */
    private suspend fun flushPending() {
        for (w in cache.pendingWrites()) {
            val res = apiCall {
                api.saveProgress(w.textId, SaveProgressRequest(w.chapterIdx, w.tokenIdx, w.pctRead)); Unit
            }
            if (res is Outcome.Success) cache.clearPending(w.textId)
        }
    }
}

private fun TextMetaDto.toDomain() = TextMeta(
    id = text.id,
    title = text.title,
    language = text.language,
    status = text.status,
    chapterCount = chapterCount,
    chapters = chapters.map {
        ChapterRef(idx = it.idx, title = it.title?.ifBlank { null } ?: "Untitled", tokenCount = it.tokenCount)
    },
)

private fun ChapterTokensDto.toDomain() = Chapter(
    chapterIdx = chapterIdx,
    tokens = tokens.orEmpty().map { it.toDomain() },
    chapterId = chapterId,
    pageImageUrl = pageImageUrl,
    pageWidth = pageWidth,
    pageHeight = pageHeight,
)

private fun TokenDto.toDomain() = ReaderToken(
    idx = idx,
    surface = surface,
    isWord = isWord,
    status = KnownStatus.fromWire(status),
    lemmaId = lemmaId,
    romanization = romanization,
    glossDefault = glossDefault,
    isOov = isOov,
    isAmbiguous = isAmbiguous,
    hasDefinition = hasDefinition,
    candidates = candidates.map {
        ParseCandidate(it.lemmaId, it.headword, it.pos, it.glossDefault)
    },
    bbox = bbox?.let { Bbox(it.x, it.y, it.w, it.h) },
)
