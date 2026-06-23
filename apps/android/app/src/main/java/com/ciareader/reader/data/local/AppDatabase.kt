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
    ],
    version = 1,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun readerCacheDao(): ReaderCacheDao
}
