package com.ciareader.reader.data.language

import com.ciareader.reader.data.local.CachedLanguageEntity
import com.ciareader.reader.data.local.LibraryCacheDao
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Caches the user's language list so the library can choose a current language
 * and show the switcher offline — the launch flow gates content loading on this
 * list, so without it a cold/offline start shows nothing.
 */
@Singleton
class LanguageCache @Inject constructor(
    private val dao: LibraryCacheDao,
) {

    suspend fun languages(): List<Language> =
        dao.languages().map {
            Language(it.code, it.displayName, it.nativeName, it.script, it.isDefault, it.knownLemmaCount)
        }

    suspend fun putLanguages(languages: List<Language>) {
        dao.clearLanguages()
        dao.upsertLanguages(
            languages.mapIndexed { i, l ->
                CachedLanguageEntity(
                    l.code,
                    l.displayName,
                    l.nativeName,
                    l.script,
                    l.isDefault,
                    position = i,
                    knownLemmaCount = l.knownLemmaCount,
                )
            },
        )
    }
}
