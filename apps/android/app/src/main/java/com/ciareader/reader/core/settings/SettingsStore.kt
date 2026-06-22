package com.ciareader.reader.core.settings

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * User-scoped UI preferences (plaintext DataStore — no secrets here).
 *
 * Currently just the last-selected reading language, so the library reopens on
 * the language the user was reading instead of resetting. Phase 5 settings
 * (romanization scheme, page mode) extend this store.
 */
interface SettingsStore {
    val currentLanguage: Flow<String?>
    suspend fun currentLanguage(): String?
    suspend fun setCurrentLanguage(code: String)

    /** Whether the reader shows romanization in place of the native script. */
    suspend fun showRomanization(): Boolean
    suspend fun setShowRomanization(value: Boolean)

    /** Whether the reader paginates into pages (page mode) vs. continuous scroll. */
    suspend fun pageMode(): Boolean
    suspend fun setPageMode(value: Boolean)
}

private val Context.settingsDataStore by preferencesDataStore(name = "settings")

@Singleton
class DataStoreSettingsStore @Inject constructor(
    @ApplicationContext private val context: Context,
) : SettingsStore {

    override val currentLanguage: Flow<String?> =
        context.settingsDataStore.data.map { it[CURRENT_LANGUAGE] }

    override suspend fun currentLanguage(): String? = currentLanguage.first()

    override suspend fun setCurrentLanguage(code: String) {
        context.settingsDataStore.edit { it[CURRENT_LANGUAGE] = code }
    }

    override suspend fun showRomanization(): Boolean =
        context.settingsDataStore.data.map { it[SHOW_ROMANIZATION] ?: false }.first()

    override suspend fun setShowRomanization(value: Boolean) {
        context.settingsDataStore.edit { it[SHOW_ROMANIZATION] = value }
    }

    override suspend fun pageMode(): Boolean =
        context.settingsDataStore.data.map { it[PAGE_MODE] ?: false }.first()

    override suspend fun setPageMode(value: Boolean) {
        context.settingsDataStore.edit { it[PAGE_MODE] = value }
    }

    private companion object {
        val CURRENT_LANGUAGE = stringPreferencesKey("current_language")
        val SHOW_ROMANIZATION = booleanPreferencesKey("show_romanization")
        val PAGE_MODE = booleanPreferencesKey("page_mode")
    }
}
