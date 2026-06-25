package com.ciareader.reader.data.library

import com.ciareader.reader.data.reader.TextMetaDto
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.Path
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

    /** Text metadata + chapter list + viewer comprehension — reused for the
     *  library's per-text Stats sheet (same payload the reader fetches). */
    @GET("api/v1/texts/{id}")
    suspend fun textDetail(@Path("id") textId: String): TextMetaDto

    /** Rename a text (title only — texts have no description). */
    @PATCH("api/v1/texts/{id}")
    suspend fun updateText(
        @Path("id") textId: String,
        @Body body: UpdateTextRequest,
    ): UpdateTextResponseDto

    @DELETE("api/v1/texts/{id}")
    suspend fun deleteText(@Path("id") textId: String): DeleteTextResponseDto
}
