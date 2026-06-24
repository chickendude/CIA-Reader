package com.ciareader.reader.data.stats

import kotlinx.serialization.Serializable

/** Mirrors GET /api/v1/me/stats?language=xx. */
@Serializable
data class LanguageStatsDto(
    val language: String,
    val knownCount: Int = 0,
    val learningCount: Int = 0,
    val encounteredCount: Int = 0,
    val knownPhrasesCount: Int = 0,
    val learningPhrasesCount: Int = 0,
    // Null when the user has no processed tokens yet — the UI shows a dash.
    val estimatedComprehensionPct: Int? = null,
)
