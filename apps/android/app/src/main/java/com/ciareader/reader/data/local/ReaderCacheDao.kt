package com.ciareader.reader.data.local

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert

/**
 * Reader-content cache access. Writes are upserts so re-downloading a text
 * refreshes it in place; reads return null/empty when a text hasn't been
 * cached, which the repository treats as "go to the network".
 */
/** A cached text's chapter count + total token-blob size in bytes. */
data class CachedTextSize(
    val textId: String,
    val chapters: Int,
    val bytes: Long,
)

@Dao
interface ReaderCacheDao {

    @Upsert
    suspend fun upsertText(text: CachedTextEntity)

    @Query("SELECT * FROM cached_text WHERE textId = :textId")
    suspend fun text(textId: String): CachedTextEntity?

    @Query("SELECT * FROM cached_text ORDER BY title")
    suspend fun allTexts(): List<CachedTextEntity>

    /** Per-text cached chapter count + byte size of the token blobs. */
    @Query(
        "SELECT textId, COUNT(*) AS chapters, " +
            "COALESCE(SUM(LENGTH(CAST(tokensJson AS BLOB))), 0) AS bytes " +
            "FROM cached_chapter GROUP BY textId",
    )
    suspend fun chapterSizes(): List<CachedTextSize>

    @Upsert
    suspend fun upsertChapterRefs(refs: List<CachedChapterRefEntity>)

    @Query("SELECT * FROM cached_chapter_ref WHERE textId = :textId ORDER BY idx")
    suspend fun chapterRefs(textId: String): List<CachedChapterRefEntity>

    @Upsert
    suspend fun upsertChapter(chapter: CachedChapterEntity)

    @Query("SELECT * FROM cached_chapter WHERE textId = :textId AND chapterIdx = :chapterIdx")
    suspend fun chapter(textId: String, chapterIdx: Int): CachedChapterEntity?

    // Reading positions saved offline, awaiting upload.
    @Upsert
    suspend fun upsertPending(pending: PendingProgressEntity)

    @Query("SELECT * FROM pending_progress WHERE textId = :textId")
    suspend fun pending(textId: String): PendingProgressEntity?

    @Query("SELECT * FROM pending_progress")
    suspend fun allPending(): List<PendingProgressEntity>

    @Query("DELETE FROM pending_progress WHERE textId = :textId")
    suspend fun deletePending(textId: String)

    /** Drop everything cached for a text (the three tables share textId). */
    @Query("DELETE FROM cached_text WHERE textId = :textId")
    suspend fun deleteText(textId: String)

    @Query("DELETE FROM cached_chapter_ref WHERE textId = :textId")
    suspend fun deleteChapterRefs(textId: String)

    @Query("DELETE FROM cached_chapter WHERE textId = :textId")
    suspend fun deleteChapters(textId: String)
}
