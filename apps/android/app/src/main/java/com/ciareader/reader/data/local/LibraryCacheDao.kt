package com.ciareader.reader.data.local

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert

/**
 * Library/collection listing cache. Listings are replaced wholesale on a
 * successful fetch (clear + upsert in the cache layer) so server-side removals
 * don't linger; reads return ordered rows, or empty when nothing is cached.
 */
@Dao
interface LibraryCacheDao {

    @Upsert
    suspend fun upsertLanguages(rows: List<CachedLanguageEntity>)

    @Query("SELECT * FROM cached_language ORDER BY position")
    suspend fun languages(): List<CachedLanguageEntity>

    @Query("DELETE FROM cached_language")
    suspend fun clearLanguages()

    @Upsert
    suspend fun upsertCards(cards: List<CachedLibraryCardEntity>)

    @Query("SELECT * FROM cached_library_card WHERE scope = :scope AND language = :language ORDER BY position")
    suspend fun cards(scope: String, language: String): List<CachedLibraryCardEntity>

    @Query("DELETE FROM cached_library_card WHERE scope = :scope AND language = :language")
    suspend fun clearCards(scope: String, language: String)

    @Upsert
    suspend fun upsertCollections(rows: List<CachedCollectionEntity>)

    @Query("SELECT * FROM cached_collection ORDER BY position")
    suspend fun collections(): List<CachedCollectionEntity>

    @Query("DELETE FROM cached_collection")
    suspend fun clearCollections()

    @Upsert
    suspend fun upsertCollectionDetail(detail: CachedCollectionDetailEntity)

    @Query("SELECT * FROM cached_collection_detail WHERE collectionId = :collectionId")
    suspend fun collectionDetail(collectionId: String): CachedCollectionDetailEntity?

    @Upsert
    suspend fun upsertCollectionChapters(rows: List<CachedCollectionChapterEntity>)

    @Query("SELECT * FROM cached_collection_chapter WHERE collectionId = :collectionId ORDER BY position")
    suspend fun collectionChapters(collectionId: String): List<CachedCollectionChapterEntity>

    @Query("DELETE FROM cached_collection_chapter WHERE collectionId = :collectionId")
    suspend fun clearCollectionChapters(collectionId: String)
}
