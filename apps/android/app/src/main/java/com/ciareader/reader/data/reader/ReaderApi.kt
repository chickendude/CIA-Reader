package com.ciareader.reader.data.reader

import retrofit2.http.GET
import retrofit2.http.Path

/** Reader endpoints: text metadata and per-chapter tokens. */
interface ReaderApi {
    @GET("api/v1/texts/{id}")
    suspend fun textMeta(@Path("id") textId: String): TextMetaDto

    @GET("api/v1/texts/{id}/chapters/{idx}/tokens")
    suspend fun chapterTokens(
        @Path("id") textId: String,
        @Path("idx") chapterIdx: Int,
    ): ChapterTokensDto
}
