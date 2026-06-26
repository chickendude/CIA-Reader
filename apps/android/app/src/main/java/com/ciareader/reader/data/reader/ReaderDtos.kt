package com.ciareader.reader.data.reader

import kotlinx.serialization.Serializable

// --- GET /api/v1/texts/:id (metadata + chapter list) ---

@Serializable
data class TextMetaDto(
    val text: TextMetaTextDto,
    val chapterCount: Int = 0,
    val chapters: List<ChapterRefDto> = emptyList(),
    /** Viewer's reading comprehension 0–100 (known word-tokens ÷ total), or null
     *  for anonymous viewers / before the text is tokenized. */
    val comprehensionPct: Int? = null,
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
    // Nullable: the server returns `null` (not `[]`) for a chapter that hasn't
    // been tokenized yet — a freshly imported / still-processing chapter. A
    // default only covers an absent key, so a non-null type crashes on `null`.
    val tokens: List<TokenDto>? = null,
    val phraseSpans: List<PhraseSpanDto>? = null,
    /** PDF (image) chapters only: the page image to render + its pixel size, so
     *  the app can overlay the per-token [TokenDto.bbox] as tappable words.
     *  Relative path (e.g. /pdf-assets/<key>); null for text-source chapters. */
    val pageImageUrl: String? = null,
    val pageWidth: Int? = null,
    val pageHeight: Int? = null,
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
    /** PDF source only: the word's normalized (0..1) bounding box on the page
     *  image, for the image-reader overlay. Null for text-source tokens. */
    val bbox: BboxDto? = null,
    /** Alternate lemmas the parser scored for this surface form (T-6.1 on the
     *  web). The server already excludes the chosen lemma, so this is the list of
     *  *other* parsings the word sheet's parse switcher offers. Empty when the
     *  parse is unambiguous. The wire entries also carry `score`/`features`,
     *  which we drop (ignoreUnknownKeys). */
    val candidates: List<CandidateDto> = emptyList(),
)

/** A word's normalized (0..1) bounding box on the page image. */
@Serializable
data class BboxDto(
    val x: Float = 0f,
    val y: Float = 0f,
    val w: Float = 0f,
    val h: Float = 0f,
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

// --- POST /api/v1/translate-sentence ---

/** Body for the sentence translator. The server reconstructs the sentence
 *  around [tokenIdx] within [chapterId] and translates it (default target en),
 *  so we send the locator rather than the text. */
@Serializable
data class TranslateSentenceRequest(
    val chapterId: String,
    val tokenIdx: Int,
    val language: String,
    // true = cache-only lookup: return a saved translation or nothing, never
    // calling the model. Used to recall a saved sentence when a word opens.
    val cachedOnly: Boolean? = null,
)

@Serializable
data class TranslateSentenceResponseDto(
    val sentence: String = "",
    val translation: String? = null,
    val cached: Boolean = false,
)
