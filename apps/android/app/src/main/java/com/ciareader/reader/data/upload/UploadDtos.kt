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
