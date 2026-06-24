package com.ciareader.reader.core.settings

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Locally-tracked reading time (no server sync — see the stats PR).
 *
 * The reader accumulates active foreground reading duration and adds it
 * here per language; the stats screen reads the per-language and total
 * totals. This is deliberately its OWN DataStore — NOT the Room cache
 * DB, which is destructively rebuilt on schema bumps — because reading
 * time is user-authored data that must survive app upgrades.
 *
 * Per-language keys store accumulated milliseconds. The grand total is
 * derived by summing every language key so adding a language never
 * needs a migration.
 */
interface ReadingTimeStore {
    /** Add [deltaMs] of active reading to [language]'s running total. */
    suspend fun addReadingTime(language: String, deltaMs: Long)

    /** Accumulated reading time for [language], in milliseconds. */
    suspend fun readingTimeMs(language: String): Long

    /** Every language's accumulated reading time, keyed by language code. */
    suspend fun readingTimeByLanguage(): Map<String, Long>

    /** Sum of all languages' reading time, in milliseconds. */
    suspend fun totalReadingTimeMs(): Long
}

private val Context.readingTimeDataStore by preferencesDataStore(name = "reading_time")

@Singleton
class DataStoreReadingTimeStore @Inject constructor(
    @ApplicationContext private val context: Context,
) : ReadingTimeStore {

    override suspend fun addReadingTime(language: String, deltaMs: Long) {
        if (language.isBlank() || deltaMs <= 0L) return
        context.readingTimeDataStore.edit { prefs ->
            val key = readingTimeKey(language)
            prefs[key] = (prefs[key] ?: 0L) + deltaMs
        }
    }

    override suspend fun readingTimeMs(language: String): Long =
        context.readingTimeDataStore.data
            .map { it[readingTimeKey(language)] ?: 0L }
            .first()

    override suspend fun readingTimeByLanguage(): Map<String, Long> =
        context.readingTimeDataStore.data
            .map { prefs ->
                prefs.asMap()
                    .mapNotNull { (k, v) ->
                        val name = k.name
                        if (name.startsWith(PREFIX) && v is Long) {
                            name.removePrefix(PREFIX) to v
                        } else {
                            null
                        }
                    }
                    .toMap()
            }
            .first()

    override suspend fun totalReadingTimeMs(): Long =
        readingTimeByLanguage().values.sum()

    private companion object {
        const val PREFIX = "reading_time_ms_"
        fun readingTimeKey(lang: String) = longPreferencesKey("$PREFIX$lang")
    }
}
