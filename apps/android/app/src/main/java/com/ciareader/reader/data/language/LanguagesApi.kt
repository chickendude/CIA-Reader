package com.ciareader.reader.data.language

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

interface LanguagesApi {
    @GET("api/v1/me/languages")
    suspend fun myLanguages(): LanguagesResponseDto

    // POST (not the cookie-only PUT /me/current-language) so a Bearer client
    // persists the choice server-side and gets the cookie set as a side effect.
    @POST("api/v1/me/languages")
    suspend fun setLanguage(@Body body: SetLanguageRequest): SetLanguageResponseDto
}
