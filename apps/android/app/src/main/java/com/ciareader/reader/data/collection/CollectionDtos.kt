package com.ciareader.reader.data.collection

import kotlinx.serialization.Serializable

// --- GET /api/v1/me/collections ---

@Serializable
data class MyCollectionsDto(val collections: List<CollectionListItemDto> = emptyList())

@Serializable
data class CollectionListItemDto(
    val collection: CollectionDto,
    val textCount: Int = 0,
    val openTextId: String? = null,
    /** Aggregate reading progress across the book's chapters, 0–100. Double so a
     *  raw float decodes even if unrounded. */
    val progressPct: Double = 0.0,
)

@Serializable
data class CollectionDto(
    val id: String,
    val title: String,
    val language: String,
    val kind: String,
    /** Viewer's reading comprehension 0–100 (known word-tokens ÷ total). Only the
     *  collection-detail endpoint populates it; null on the list/PATCH responses. */
    val comprehensionPct: Int? = null,
)

// --- GET /api/v1/collections/:id ---

@Serializable
data class CollectionDetailDto(
    val collection: CollectionDto,
    val items: List<CollectionItemDto> = emptyList(),
)

@Serializable
data class CollectionItemDto(
    val position: Int,
    val sectionTitle: String? = null,
    val text: CollectionItemTextDto,
)

@Serializable
data class CollectionItemTextDto(
    val id: String,
    val title: String,
    val status: String,
    val wordCount: Int = 0,
)

// --- PATCH /api/v1/collections/:id ---

/** Partial edit body; only non-null fields are sent (the endpoint is `.partial()`). */
@Serializable
data class UpdateCollectionRequest(
    val title: String? = null,
    val description: String? = null,
)

@Serializable
data class UpdateCollectionResponseDto(val collection: CollectionDto)

// --- DELETE /api/v1/collections/:id and /api/v1/texts/:id ---

@Serializable
data class OkResponseDto(val ok: Boolean = false)
