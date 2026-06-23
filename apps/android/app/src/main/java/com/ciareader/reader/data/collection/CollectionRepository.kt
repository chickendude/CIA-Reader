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
)

interface CollectionRepository {
    suspend fun myCollections(): Outcome<List<CollectionSummary>>
    suspend fun detail(collectionId: String): Outcome<CollectionDetail>
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
                )
            }
        ) {
            is Outcome.Success -> {
                cache.putDetail(net.data)
                net
            }
            is Outcome.Failure -> cache.detail(collectionId)?.let { Outcome.Success(it) } ?: net
        }
}
