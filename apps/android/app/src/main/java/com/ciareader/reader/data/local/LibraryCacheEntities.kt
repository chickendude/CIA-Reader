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
    /** Distinct known lemmas in this language; mirrors the server count
     *  so the offline switcher can still show "N words". Defaults to 0
     *  for rows written before the column existed (destructive migration
     *  rebuilds the cache, so the default only matters in code paths). */
    val knownLemmaCount: Int = 0,
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
