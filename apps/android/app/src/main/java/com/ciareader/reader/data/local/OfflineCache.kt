package com.ciareader.reader.data.local

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/** Lets the user drop everything cached for offline reading. */
interface OfflineCache {
    suspend fun clear()
}

@Singleton
class RoomOfflineCache @Inject constructor(
    private val db: AppDatabase,
) : OfflineCache {
    // clearAllTables() does its own DB I/O off the calling thread's hot path,
    // but keep it off the main thread regardless.
    override suspend fun clear() = withContext(Dispatchers.IO) { db.clearAllTables() }
}
