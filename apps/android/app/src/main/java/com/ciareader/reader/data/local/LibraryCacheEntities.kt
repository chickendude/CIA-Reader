package com.ciareader.reader.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Cached library/collection listings so the library screen has something to
 * show offline. Like the reader cache, these are disposable mirrors of the
 * server; [position] preserves the server's ordering on read-back.
 */
@Entity(tableName = "cached_library_card", primaryKeys = ["scope", "language", "id"])
data class CachedLibraryCardEntity(
    val scope: String,
    val language: String,
    val id: String,
    val title: String,
    val status: String,
    val position: Int,
    /** Cached estimated comprehension (0–100), null when unknown. */
    val estimatedComprehensionPct: Int? = null,
)

/**
 * The user's language list, cached so the library can pick a current language
 * and render the switcher offline (the launch flow gates on this list).
 */
@Entity(tableName = "cached_language")
data class CachedLanguageEntity(
    @PrimaryKey val code: String,
    val displayName: String,
    val nativeName: String,
    val script: String,
    val isDefault: Boolean,
    val position: Int,
)

@Entity(tableName = "cached_collection")
data class CachedCollectionEntity(
    @PrimaryKey val id: String,
    val language: String,
    val title: String,
    val kind: String,
    val textCount: Int,
    val openTextId: String?,
    val position: Int,
    /** Cached estimated comprehension (0–100), null when unknown. */
    val estimatedComprehensionPct: Int? = null,
)

/** A collection's title, kept so [detail] can be served offline on its own. */
@Entity(tableName = "cached_collection_detail")
data class CachedCollectionDetailEntity(
    @PrimaryKey val collectionId: String,
    val title: String,
)

@Entity(tableName = "cached_collection_chapter", primaryKeys = ["collectionId", "textId"])
data class CachedCollectionChapterEntity(
    val collectionId: String,
    val textId: String,
    val title: String,
    val position: Int,
    val status: String,
    val wordCount: Int,
)
