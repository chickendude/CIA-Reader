package com.ciareader.reader.core.settings

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
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

    // Reading prefs are per-language: romanization is script-specific, and a
    // reader may want a different size/spacing/mode per language. Each is keyed
    // by language [code].

    /** Whether the reader shows romanization in place of the native script. */
    suspend fun showRomanization(language: String): Boolean
    suspend fun setShowRomanization(language: String, value: Boolean)

    /** Whether the reader paginates into pages (page mode) vs. continuous scroll. */
    suspend fun pageMode(language: String): Boolean
    suspend fun setPageMode(language: String, value: Boolean)

    /** Reader body font size in sp (defaults to [DEFAULT_FONT_SIZE_SP]). */
    suspend fun fontSizeSp(language: String): Int
    suspend fun setFontSizeSp(language: String, value: Int)

    /** Reader line-height multiple (defaults to [DEFAULT_LINE_SPACING]). */
    suspend fun lineSpacing(language: String): Float
    suspend fun setLineSpacing(language: String, value: Float)

    companion object {
        const val DEFAULT_FONT_SIZE_SP = 18
        const val DEFAULT_LINE_SPACING = 1.5f
    }
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

    override suspend fun showRomanization(language: String): Boolean =
        context.settingsDataStore.data.map { it[romanizationKey(language)] ?: false }.first()

    override suspend fun setShowRomanization(language: String, value: Boolean) {
        context.settingsDataStore.edit { it[romanizationKey(language)] = value }
    }

    override suspend fun pageMode(language: String): Boolean =
        context.settingsDataStore.data.map { it[pageModeKey(language)] ?: false }.first()

    override suspend fun setPageMode(language: String, value: Boolean) {
        context.settingsDataStore.edit { it[pageModeKey(language)] = value }
    }

    override suspend fun fontSizeSp(language: String): Int =
        context.settingsDataStore.data.map { it[fontSizeKey(language)] ?: SettingsStore.DEFAULT_FONT_SIZE_SP }.first()

    override suspend fun setFontSizeSp(language: String, value: Int) {
        context.settingsDataStore.edit { it[fontSizeKey(language)] = value }
    }

    override suspend fun lineSpacing(language: String): Float =
        context.settingsDataStore.data.map { it[lineSpacingKey(language)] ?: SettingsStore.DEFAULT_LINE_SPACING }.first()

    override suspend fun setLineSpacing(language: String, value: Float) {
        context.settingsDataStore.edit { it[lineSpacingKey(language)] = value }
    }

    private companion object {
        val CURRENT_LANGUAGE = stringPreferencesKey("current_language")

        // Per-language keys — the language code is part of the preference name.
        fun romanizationKey(lang: String) = booleanPreferencesKey("show_romanization_$lang")
        fun pageModeKey(lang: String) = booleanPreferencesKey("page_mode_$lang")
        fun fontSizeKey(lang: String) = intPreferencesKey("font_size_sp_$lang")
        fun lineSpacingKey(lang: String) = floatPreferencesKey("line_spacing_$lang")
    }
}
