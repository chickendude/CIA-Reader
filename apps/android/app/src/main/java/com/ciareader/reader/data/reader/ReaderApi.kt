package com.ciareader.reader.data.reader

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path

/** Reader endpoints: text metadata, per-chapter tokens, and reading progress. */
interface ReaderApi {
    @GET("api/v1/texts/{id}")
    suspend fun textMeta(@Path("id") textId: String): TextMetaDto

    @GET("api/v1/texts/{id}/chapters/{idx}/tokens")
    suspend fun chapterTokens(
        @Path("id") textId: String,
        @Path("idx") chapterIdx: Int,
    ): ChapterTokensDto

    @GET("api/v1/texts/{textId}/lemmas/{lemmaId}/frequency")
    suspend fun lemmaFrequency(
        @Path("textId") textId: String,
        @Path("lemmaId") lemmaId: String,
    ): LemmaFrequencyDto

    @GET("api/v1/me/text-progress/{textId}")
    suspend fun progress(@Path("textId") textId: String): TextProgressEnvelopeDto

    @PATCH("api/v1/me/text-progress/{textId}")
    suspend fun saveProgress(
        @Path("textId") textId: String,
        @Body body: SaveProgressRequest,
    ): TextProgressEnvelopeDto

    @POST("api/v1/translate-sentence")
    suspend fun translateSentence(
        @Body body: TranslateSentenceRequest,
    ): TranslateSentenceResponseDto
}
