package com.ciareader.reader.data.language

import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.core.network.apiCall
import javax.inject.Inject
import javax.inject.Singleton

/** UI-facing language descriptor. */
data class Language(
    val code: String,
    val displayName: String,
    val nativeName: String,
    val script: String,
    val isDefault: Boolean,
) {
    /** Hebrew script (Yiddish) reads right-to-left. */
    val isRtl: Boolean get() = script.equals("Hebr", ignoreCase = true)
}

interface LanguageRepository {
    suspend fun myLanguages(): Outcome<List<Language>>
    suspend fun setCurrent(code: String): Outcome<String>
}

@Singleton
class LanguageRepositoryImpl @Inject constructor(
    private val api: LanguagesApi,
    private val cache: LanguageCache,
) : LanguageRepository {
    // Network-first with offline fallback: the library gates its whole launch
    // on this list, so serving the last-cached languages keeps a cold/offline
    // start from blanking out (no language selected, no books).
    override suspend fun myLanguages(): Outcome<List<Language>> =
        when (val net = apiCall { api.myLanguages().languages.map { it.toDomain() } }) {
            is Outcome.Success -> {
                cache.putLanguages(net.data)
                net
            }
            is Outcome.Failure -> cache.languages().takeIf { it.isNotEmpty() }
                ?.let { Outcome.Success(it) } ?: net
        }

    override suspend fun setCurrent(code: String): Outcome<String> =
        apiCall { api.setLanguage(SetLanguageRequest(code)).code }
}

private fun LanguageDto.toDomain() = Language(
    code = code,
    displayName = displayName,
    nativeName = nativeName,
    script = script,
    isDefault = isDefault,
)
