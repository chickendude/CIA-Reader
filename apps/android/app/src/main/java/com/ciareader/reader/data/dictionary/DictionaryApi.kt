package com.ciareader.reader.data.dictionary

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.Path

interface DictionaryApi {
    @GET("api/v1/lemmas/{id}/translations")
    suspend fun translations(@Path("id") lemmaId: String): LemmaTranslationsDto

    @PATCH("api/v1/me/known-lemmas/{lemmaId}")
    suspend fun setKnownStatus(
        @Path("lemmaId") lemmaId: String,
        @Body body: KnownLemmaRequest,
    ): KnownLemmaResponseDto
}
