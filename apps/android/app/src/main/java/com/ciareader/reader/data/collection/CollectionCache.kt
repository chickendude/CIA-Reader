package com.ciareader.reader.data.collection

import com.ciareader.reader.data.local.CachedCollectionChapterEntity
import com.ciareader.reader.data.local.CachedCollectionDetailEntity
import com.ciareader.reader.data.local.CachedCollectionEntity
import com.ciareader.reader.data.local.LibraryCacheDao
import javax.inject.Inject
import javax.inject.Singleton

/** Caches the user's collection list + per-collection chapter lists offline. */
@Singleton
class CollectionCache @Inject constructor(
    private val dao: LibraryCacheDao,
) {

    suspend fun collections(): List<CollectionSummary> =
        dao.collections().map {
            CollectionSummary(it.id, it.title, it.language, it.kind, it.textCount, it.openTextId)
        }

    suspend fun putCollections(collections: List<CollectionSummary>) {
        dao.clearCollections()
        dao.upsertCollections(
            collections.mapIndexed { i, c ->
                CachedCollectionEntity(c.id, c.language, c.title, c.kind, c.textCount, c.openTextId, position = i)
            },
        )
    }

    suspend fun detail(collectionId: String): CollectionDetail? {
        val head = dao.collectionDetail(collectionId) ?: return null
        val chapters = dao.collectionChapters(collectionId).map {
            CollectionChapter(it.textId, it.title, it.position, it.status, it.wordCount)
        }
        return CollectionDetail(head.collectionId, head.title, chapters)
    }

    suspend fun putDetail(detail: CollectionDetail) {
        dao.upsertCollectionDetail(CachedCollectionDetailEntity(detail.id, detail.title))
        dao.clearCollectionChapters(detail.id)
        dao.upsertCollectionChapters(
            detail.chapters.map {
                CachedCollectionChapterEntity(detail.id, it.textId, it.title, it.position, it.status, it.wordCount)
            },
        )
    }
}
