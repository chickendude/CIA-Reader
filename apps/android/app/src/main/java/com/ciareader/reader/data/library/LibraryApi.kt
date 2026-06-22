package com.ciareader.reader.data.library

import retrofit2.http.GET
import retrofit2.http.Query

/** Library listing under GET /api/v1/texts. */
interface LibraryApi {
    @GET("api/v1/texts")
    suspend fun listTexts(
        @Query("scope") scope: String,
        // Explicit — a Bearer client sends no current-language cookie.
        @Query("language") language: String,
        @Query("limit") limit: Int? = null,
        @Query("offset") offset: Int? = null,
    ): LibraryPageDto
}
