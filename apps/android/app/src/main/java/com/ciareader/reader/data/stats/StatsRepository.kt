package com.ciareader.reader.data.stats

import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.core.network.apiCall
import javax.inject.Inject
import javax.inject.Singleton

/** UI-facing per-language learning stats (server-derived). */
data class LanguageStats(
    val knownCount: Int,
    val learningCount: Int,
    val encounteredCount: Int,
    val knownPhrasesCount: Int,
    /** Null when no tokens are processed yet — the UI shows a dash. */
    val estimatedComprehensionPct: Int?,
)

interface StatsRepository {
    suspend fun languageStats(language: String): Outcome<LanguageStats>
}

@Singleton
class StatsRepositoryImpl @Inject constructor(
    private val api: StatsApi,
) : StatsRepository {
    override suspend fun languageStats(language: String): Outcome<LanguageStats> =
        apiCall { api.languageStats(language).toDomain() }
}

private fun LanguageStatsDto.toDomain() = LanguageStats(
    knownCount = knownCount,
    learningCount = learningCount,
    encounteredCount = encounteredCount,
    knownPhrasesCount = knownPhrasesCount,
    estimatedComprehensionPct = estimatedComprehensionPct,
)
