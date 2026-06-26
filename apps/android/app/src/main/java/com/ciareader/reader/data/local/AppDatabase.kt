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
        PendingProgressEntity::class,
    ],
    // v7: merges main's v6 (progress + cached_lemma) with
    // estimatedComprehensionPct on cached_library_card / cached_collection.
    version = 7,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun readerCacheDao(): ReaderCacheDao
    abstract fun libraryCacheDao(): LibraryCacheDao
}
