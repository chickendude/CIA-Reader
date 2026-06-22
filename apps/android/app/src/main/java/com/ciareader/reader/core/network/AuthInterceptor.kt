package com.ciareader.reader.core.network

import com.ciareader.reader.core.auth.TokenStore
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject

/**
 * Attaches `Authorization: Bearer <accessToken>` to outgoing requests when a
 * token is stored and the caller hasn't already set the header. A 401 from an
 * expired access token is handled by [TokenAuthenticator].
 */
class AuthInterceptor @Inject constructor(
    private val tokenStore: TokenStore,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        if (request.header("Authorization") != null) return chain.proceed(request)

        val accessToken = runBlocking { tokenStore.current()?.accessToken }
            ?: return chain.proceed(request)

        val authed = request.newBuilder()
            .header("Authorization", "Bearer $accessToken")
            .build()
        return chain.proceed(authed)
    }
}
