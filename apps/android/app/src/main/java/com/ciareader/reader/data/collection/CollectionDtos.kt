package com.ciareader.reader.data.collection

import kotlinx.serialization.Serializable

// --- GET /api/v1/me/collections ---

@Serializable
data class MyCollectionsDto(val collections: List<CollectionListItemDto> = emptyList())

@Serializable
data class CollectionListItemDto(
    val collection: CollectionDto,
    val textCount: Int = 0,
)

@Serializable
data class CollectionDto(
    val id: String,
    val title: String,
    val language: String,
    val kind: String,
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
)
