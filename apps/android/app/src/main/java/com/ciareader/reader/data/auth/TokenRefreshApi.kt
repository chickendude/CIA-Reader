package com.ciareader.reader.data.auth

import retrofit2.Call
import retrofit2.http.Body
import retrofit2.http.POST

/**
 * Refresh endpoint, isolated on its own interface so the OkHttp
 * [com.ciareader.reader.core.network.TokenAuthenticator] can call it
 * **synchronously** (`.execute()`) without recursing through the
 * authenticated client. Backed by a separate, authenticator-free OkHttp
 * instance — see the network DI module.
 */
interface TokenRefreshApi {
    @POST("api/v1/auth/refresh")
    fun refresh(@Body body: RefreshRequest): Call<AuthResponseDto>
}
