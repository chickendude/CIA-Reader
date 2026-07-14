package com.ciareader.reader.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

/**
 * The app's local cache database. It holds only mirrors of server data, so a
 * schema change can drop and rebuild it (destructive migration) instead of
 * shipping migrations — nothing here is user-authored.
 */
@Database(
    entities = [
        CachedTextEntity::class,
        CachedChapterRefEntity::class,
        CachedChapterEntity::class,
        CachedLanguageEntity::class,
        CachedLibraryCardEntity::class,
        CachedCollectionEntity::class,
        CachedCollectionDetailEntity::class,
        CachedCollectionChapterEntity::class,
        CachedLemmaEntity::class,
        CachedBasqueReferenceEntity::class,
        PendingProgressEntity::class,
    ],
    // v8: adds cached_basque_reference (persistent fetch-once external
    // reference lookups).
    version = 8,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun readerCacheDao(): ReaderCacheDao
    abstract fun libraryCacheDao(): LibraryCacheDao
}
