package com.ciareader.reader.data.local

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/** A downloaded text the user can inspect or remove from the offline cache. */
data class Download(
    val textId: String,
    val title: String,
    val language: String,
    val chapters: Int,
    val sizeBytes: Long,
)

/** Inspect and manage what's cached for offline reading. */
interface OfflineCache {
    suspend fun clear()

    /** Cached texts with their chapter count + size, largest first. */
    suspend fun downloads(): List<Download>

    /** Remove one text (its meta, chapter list, and cached chapters). */
    suspend fun delete(textId: String)
}

@Singleton
class RoomOfflineCache @Inject constructor(
    private val db: AppDatabase,
    private val readerCache: ReaderCacheDao,
) : OfflineCache {
    // clearAllTables() does its own DB I/O off the calling thread's hot path,
    // but keep it off the main thread regardless.
    override suspend fun clear() = withContext(Dispatchers.IO) { db.clearAllTables() }

    override suspend fun downloads(): List<Download> = withContext(Dispatchers.IO) {
        val sizes = readerCache.chapterSizes().associateBy { it.textId }
        readerCache.allTexts()
            .map { t ->
                val s = sizes[t.textId]
                Download(t.textId, t.title, t.language, s?.chapters ?: 0, s?.bytes ?: 0L)
            }
            .sortedByDescending { it.sizeBytes }
    }

    override suspend fun delete(textId: String) = withContext(Dispatchers.IO) {
        readerCache.deleteText(textId)
        readerCache.deleteChapterRefs(textId)
        readerCache.deleteChapters(textId)
    }
}
