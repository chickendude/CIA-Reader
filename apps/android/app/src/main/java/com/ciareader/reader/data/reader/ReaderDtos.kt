package com.ciareader.reader.data.reader

import kotlinx.serialization.Serializable

// --- GET /api/v1/texts/:id (metadata + chapter list) ---

@Serializable
data class TextMetaDto(
    val text: TextMetaTextDto,
    val chapterCount: Int = 0,
    val chapters: List<ChapterRefDto> = emptyList(),
)

@Serializable
data class TextMetaTextDto(
    val id: String,
    val title: String,
    val language: String,
    val status: String,
)

@Serializable
data class ChapterRefDto(
    val idx: Int,
    val title: String? = null,
    val tokenCount: Int = 0,
)

// --- GET /api/v1/texts/:id/chapters/:idx/tokens ---

@Serializable
data class ChapterTokensDto(
    val chapterId: String,
    val chapterIdx: Int,
    val body: String = "",
    val tokens: List<TokenDto> = emptyList(),
    val phraseSpans: List<PhraseSpanDto> = emptyList(),
)

@Serializable
data class TokenDto(
    val idx: Int,
    val surface: String,
    val isWord: Boolean = false,
    val status: String = "unknown",
    val lemmaId: String? = null,
    val romanization: String? = null,
    val glossDefault: String? = null,
    val isOov: Boolean = false,
    val isAmbiguous: Boolean = false,
    val hasDefinition: Boolean = false,
    /** Alternate lemmas the parser scored for this surface form (T-6.1 on the
     *  web). The server already excludes the chosen lemma, so this is the list of
     *  *other* parsings the word sheet's parse switcher offers. Empty when the
     *  parse is unambiguous. The wire entries also carry `score`/`features`,
     *  which we drop (ignoreUnknownKeys). */
    val candidates: List<CandidateDto> = emptyList(),
)

@Serializable
data class CandidateDto(
    val lemmaId: String,
    val headword: String,
    val pos: String? = null,
    val glossDefault: String? = null,
)

@Serializable
data class PhraseSpanDto(
    val phraseId: String,
    val startTokenIdx: Int,
    val endTokenIdx: Int,
    val glossDefault: String? = null,
    val status: String = "unknown",
)

// --- GET / PATCH /api/v1/me/text-progress/:textId ---

@Serializable
data class TextProgressEnvelopeDto(val progress: TextProgressDto? = null)

@Serializable
data class TextProgressDto(
    val lastChapterIdx: Int = 0,
    val lastTokenIdx: Int = 0,
    val pctRead: Double = 0.0,
)

@Serializable
data class SaveProgressRequest(
    val chapterIdx: Int,
    val tokenIdx: Int,
    val pctRead: Double,
)
