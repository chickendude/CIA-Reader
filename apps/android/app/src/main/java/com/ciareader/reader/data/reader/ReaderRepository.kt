package com.ciareader.reader.data.reader

import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.core.network.apiCall
import javax.inject.Inject
import javax.inject.Singleton

/** A word/lemma's familiarity, driving its highlight in the reader. */
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

/** A rendered token in a chapter (word or punctuation/whitespace). */
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

interface ReaderRepository {
    suspend fun textMeta(textId: String): Outcome<TextMeta>
    suspend fun chapter(textId: String, chapterIdx: Int): Outcome<Chapter>
}

@Singleton
class ReaderRepositoryImpl @Inject constructor(
    private val api: ReaderApi,
) : ReaderRepository {

    override suspend fun textMeta(textId: String): Outcome<TextMeta> =
        apiCall { api.textMeta(textId).toDomain() }

    override suspend fun chapter(textId: String, chapterIdx: Int): Outcome<Chapter> =
        apiCall { api.chapterTokens(textId, chapterIdx).toDomain() }
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
