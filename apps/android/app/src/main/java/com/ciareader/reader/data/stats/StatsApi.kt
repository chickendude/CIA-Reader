package com.ciareader.reader.data.stats

import retrofit2.http.GET
import retrofit2.http.Query

interface StatsApi {
    /** Per-language learning stats (known/learning counts + comprehension). */
    @GET("api/v1/me/stats")
    suspend fun languageStats(@Query("language") language: String): LanguageStatsDto
}
