package com.ciareader.reader.data.dictionary

import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface DictionaryApi {
    @GET("api/v1/lemmas/{id}/translations")
    suspend fun translations(@Path("id") lemmaId: String): LemmaTranslationsDto

    @POST("api/v1/translations")
    suspend fun addTranslation(@Body body: CreateTranslationRequest): CreateTranslationResponseDto

    @PATCH("api/v1/translations/{id}")
    suspend fun editTranslation(
        @Path("id") id: String,
        @Body body: UpdateTranslationRequest,
    ): CreateTranslationResponseDto

    @DELETE("api/v1/translations/{id}")
    suspend fun deleteTranslation(@Path("id") id: String)

    /** Admin-only Basque reference dictionaries; 403 for non-admins. */
    @GET("api/v1/admin/basque-dictionary")
    suspend fun basqueReference(@Query("word") word: String): BasqueReferenceResponseDto

    @PATCH("api/v1/me/known-lemmas/{lemmaId}")
    suspend fun setKnownStatus(
        @Path("lemmaId") lemmaId: String,
        @Body body: KnownLemmaRequest,
    ): KnownLemmaResponseDto
}
