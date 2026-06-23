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
)

data class Chapter(
    val chapterIdx: Int,
    val tokens: List<ReaderToken>,
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

    override suspend fun progress(textId: String): Outcome<ReadingProgress?> =
        apiCall {
            api.progress(textId).progress?.let {
                ReadingProgress(it.lastChapterIdx, it.lastTokenIdx, it.pctRead)
            }
        }

    override suspend fun saveProgress(
        textId: String,
        chapterIdx: Int,
        tokenIdx: Int,
        pctRead: Double,
    ): Outcome<Unit> =
        apiCall { api.saveProgress(textId, SaveProgressRequest(chapterIdx, tokenIdx, pctRead)); Unit }
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
    tokens = tokens.map { it.toDomain() },
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
)
