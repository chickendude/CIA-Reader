package com.ciareader.reader.data.upload

import kotlinx.serialization.Serializable

/**
 * POST /api/v1/texts — create a text from a paste or a `.txt` upload.
 *
 * The web endpoint discriminates on [sourceType] ('paste' | 'txt'); both land
 * on the same create path. We default to 'paste' to match the server's optional
 * literal and keep the body cap generous. `language` is one of the supported
 * codes (hi/mr/or/yi/eu/…) — a Bearer client always sends it explicitly.
 */
@Serializable
data class CreateTextRequest(
    val language: String,
    val title: String,
    val body: String,
    val sourceType: String = "paste",
)

/** 201 response from POST /api/v1/texts (text metadata only, no chapters). */
@Serializable
data class CreateTextResponseDto(
    val text: CreatedTextDto,
    val chapterCount: Int = 0,
)

@Serializable
data class CreatedTextDto(
    val id: String,
    val ownerId: String? = null,
    val language: String,
    val title: String,
    val sourceType: String? = null,
    val status: String,
    val visibility: String? = null,
    val createdAt: String? = null,
)

/**
 * 201 response from POST /api/v1/texts/epub. A multi-chapter book comes back as
 * `kind: 'collection'`; a single-chapter EPUB as `kind: 'text'`. Both id fields
 * are nullable so one DTO covers both shapes (clients branch on [kind]).
 */
@Serializable
data class EpubUploadResponseDto(
    val kind: String,
    val text: CreatedTextDto? = null,
    val chapterCount: Int? = null,
    val collection: CreatedCollectionDto? = null,
    val textCount: Int? = null,
    /** First chapter's text id (collection case) so the client can open the
     *  reader on chapter 1 rather than the chapter-list page. */
    val firstTextId: String? = null,
)

@Serializable
data class CreatedCollectionDto(
    val id: String,
    val ownerId: String? = null,
    val language: String,
    val title: String,
    val kind: String? = null,
    val visibility: String? = null,
    val createdAt: String? = null,
)

// --- PDF import: POST /api/v1/texts/pdf/begin then per-page uploads ---

/** Opens a PDF import: creates the text + N empty page chapters. */
@Serializable
data class PdfBeginRequest(
    val language: String,
    val title: String,
    val pageCount: Int,
)

/** 201 from /pdf/begin — the new text id to stream page images into. */
@Serializable
data class PdfBeginResponseDto(
    val id: String,
    val pageCount: Int = 0,
)

/** 201 from POST /texts/:id/pages/:idx — `complete` flips true on the last page. */
@Serializable
data class PageUploadResponseDto(
    val chapterId: String? = null,
    val tokenCount: Int = 0,
    val complete: Boolean = false,
)
