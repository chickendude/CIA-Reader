package com.ciareader.reader.data.library

import kotlinx.serialization.Serializable

/** Mirrors the `ListPage` shape from GET /api/v1/texts. */
@Serializable
data class LibraryPageDto(
    val cards: List<TextCardDto> = emptyList(),
    val totalCount: Int = 0,
    val limit: Int = 0,
    val offset: Int = 0,
)

@Serializable
data class TextCardDto(
    val id: String,
    val title: String,
    val language: String,
    val sourceType: String,
    val status: String,
    val visibility: String,
    val createdAt: String,
)
