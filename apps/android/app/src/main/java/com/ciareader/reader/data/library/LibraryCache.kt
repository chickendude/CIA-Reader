package com.ciareader.reader.data.library

import com.ciareader.reader.data.local.CachedLibraryCardEntity
import com.ciareader.reader.data.local.LibraryCacheDao
import javax.inject.Inject
import javax.inject.Singleton

/** Caches the per-(scope, language) library listing for offline display. */
@Singleton
class LibraryCache @Inject constructor(
    private val dao: LibraryCacheDao,
) {

    suspend fun cards(scope: LibraryScope, language: String): List<TextCard> =
        dao.cards(scope.wire, language).map { TextCard(it.id, it.title, it.language, it.status, it.progress) }

    suspend fun putCards(scope: LibraryScope, language: String, cards: List<TextCard>) {
        // Replace wholesale so texts removed server-side don't linger offline.
        dao.clearCards(scope.wire, language)
        dao.upsertCards(
            cards.mapIndexed { i, c ->
                CachedLibraryCardEntity(scope.wire, language, c.id, c.title, c.status, position = i, progress = c.progress)
            },
        )
    }
}
