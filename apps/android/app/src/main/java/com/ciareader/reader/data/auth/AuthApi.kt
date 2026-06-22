package com.ciareader.reader.data.auth

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

/** Auth endpoints under the SvelteKit `/api/v1/auth` routes. */
interface AuthApi {
    @POST("api/v1/auth/login")
    suspend fun login(@Body body: LoginRequest): AuthResponseDto

    @POST("api/v1/auth/register")
    suspend fun register(@Body body: RegisterRequest): AuthResponseDto

    @GET("api/v1/auth/me")
    suspend fun me(): MeResponseDto

    @POST("api/v1/auth/magic-link/request")
    suspend fun requestMagicLink(@Body body: MagicLinkRequest): MagicLinkAckDto

    @POST("api/v1/auth/magic-link/consume")
    suspend fun consumeMagicLink(@Body body: MagicLinkConsumeRequest): AuthResponseDto
}
