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
    /** Viewer's reading progress, 0–100 (0 when unread/anonymous). Double so a
     *  raw float pct_read decodes even if the server doesn't round it. */
    val progressPct: Double = 0.0,
)

// --- DELETE /api/v1/texts/:id ---

@Serializable
data class DeleteTextResponseDto(val ok: Boolean = false)
