package com.ciareader.reader.data.collection

import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.core.network.apiCall
import javax.inject.Inject
import javax.inject.Singleton

/** A book/course the user owns (a collection of texts). */
data class CollectionSummary(
    val id: String,
    val title: String,
    val language: String,
    val kind: String,
    val textCount: Int,
    /** Chapter-text to open when tapped: last-read, else the first chapter. */
    val openTextId: String? = null,
    /** Estimated comprehension across the book (0–100), or null when not yet
     *  computed; the library card renders a small "%" badge when present. */
    val estimatedComprehensionPct: Int? = null,
    /** Aggregate reading progress 0f–1f for the card's progress track. */
    val progress: Float = 0f,
)

data class CollectionChapter(
    val textId: String,
    val title: String,
    val position: Int,
    val status: String,
    val wordCount: Int = 0,
) {
    val isReady: Boolean get() = status == "ready"
}

data class CollectionDetail(
    val id: String,
    val title: String,
    val chapters: List<CollectionChapter>,
    /** Viewer's reading comprehension 0–100, or null before the texts are processed. */
    val comprehensionPct: Int? = null,
)

interface CollectionRepository {
    suspend fun myCollections(): Outcome<List<CollectionSummary>>
    suspend fun detail(collectionId: String): Outcome<CollectionDetail>

    /** Edit a book's title and/or description (PATCH). Returns the new title. */
    suspend fun update(
        collectionId: String,
        title: String? = null,
        description: String? = null,
    ): Outcome<String>

    /** Delete a book (DELETE). The caller re-lists on success. */
    suspend fun delete(collectionId: String): Outcome<Unit>

    /** Last-cached collections, without touching the network — for instant launch. */
    suspend fun cachedCollections(): List<CollectionSummary>
}

@Singleton
class CollectionRepositoryImpl @Inject constructor(
    private val api: CollectionsApi,
    private val cache: CollectionCache,
) : CollectionRepository {

    // Network-first with offline fallback, so the library still lists the
    // user's books and a book's chapter list stays available without a
    // connection (the in-reader chapter nav relies on detail()).
    override suspend fun myCollections(): Outcome<List<CollectionSummary>> =
        when (
            val net = apiCall {
                api.myCollections().collections.map {
                    CollectionSummary(
                        id = it.collection.id,
                        title = it.collection.title,
                        language = it.collection.language,
                        kind = it.collection.kind,
                        textCount = it.textCount,
                        openTextId = it.openTextId,
                        estimatedComprehensionPct = it.estimatedComprehensionPct,
                        progress = (it.progressPct / 100.0).toFloat().coerceIn(0f, 1f),
                    )
                }
            }
        ) {
            is Outcome.Success -> {
                cache.putCollections(net.data)
                net
            }
            is Outcome.Failure -> cache.collections().takeIf { it.isNotEmpty() }
                ?.let { Outcome.Success(it) } ?: net
        }

    override suspend fun detail(collectionId: String): Outcome<CollectionDetail> =
        when (
            val net = apiCall {
                val dto = api.detail(collectionId)
                CollectionDetail(
                    id = dto.collection.id,
                    title = dto.collection.title,
                    chapters = dto.items.map {
                        CollectionChapter(
                            textId = it.text.id,
                            title = it.text.title,
                            position = it.position,
                            status = it.text.status,
                            wordCount = it.text.wordCount,
                        )
                    },
                    comprehensionPct = dto.collection.comprehensionPct,
                )
            }
        ) {
            is Outcome.Success -> {
                cache.putDetail(net.data)
                net
            }
            is Outcome.Failure -> cache.detail(collectionId)?.let { Outcome.Success(it) } ?: net
        }

    // Edit/delete go straight to the network. The caller re-fetches the list on
    // success (myCollections clears + repopulates the cache wholesale), so a
    // renamed/removed book reflects in both the live list and the offline cache.
    override suspend fun update(
        collectionId: String,
        title: String?,
        description: String?,
    ): Outcome<String> = apiCall {
        api.update(
            collectionId,
            UpdateCollectionRequest(title = title, description = description),
        ).collection.title
    }

    override suspend fun delete(collectionId: String): Outcome<Unit> = apiCall {
        api.delete(collectionId)
        Unit
    }

    override suspend fun cachedCollections(): List<CollectionSummary> = cache.collections()
}
