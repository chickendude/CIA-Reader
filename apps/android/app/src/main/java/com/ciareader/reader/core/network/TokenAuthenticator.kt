package com.ciareader.reader.core.network

import com.ciareader.reader.core.auth.AuthTokens
import com.ciareader.reader.core.auth.TokenStore
import com.ciareader.reader.data.auth.RefreshRequest
import com.ciareader.reader.data.auth.TokenRefreshApi
import kotlinx.coroutines.runBlocking
import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import javax.inject.Inject

/**
 * On a 401 from an authenticated request, rotates the refresh token and
 * retries once with the fresh access token. If refresh fails, clears the
 * stored tokens (the user is effectively logged out) and gives up.
 */
class TokenAuthenticator @Inject constructor(
    private val tokenStore: TokenStore,
    private val refreshApi: TokenRefreshApi,
) : Authenticator {

    override fun authenticate(route: Route?, response: Response): Request? {
        // Only authenticated calls (those that carried a bearer token) are
        // eligible — this skips login/register/magic-link, which carry none.
        val failedToken = response.request.header("Authorization")
            ?.removePrefix("Bearer ")
            ?.trim()
            ?: return null

        // Bail if we've already retried this request.
        if (priorResponseCount(response) >= 2) return null

        synchronized(lock) {
            val current = runBlocking { tokenStore.current() } ?: return null

            // Another thread may have refreshed while we waited on the lock.
            if (current.accessToken != failedToken) {
                return response.request.retryWith(current.accessToken)
            }

            val refreshed = try {
                refreshApi.refresh(RefreshRequest(current.refreshToken)).execute()
            } catch (_: Exception) {
                return null
            }

            val body = refreshed.body()
            if (!refreshed.isSuccessful || body == null) {
                runBlocking { tokenStore.clear() }
                return null
            }

            runBlocking { tokenStore.save(AuthTokens(body.accessToken, body.refreshToken)) }
            return response.request.retryWith(body.accessToken)
        }
    }

    private fun Request.retryWith(accessToken: String): Request =
        newBuilder().header("Authorization", "Bearer $accessToken").build()

    private fun priorResponseCount(response: Response): Int {
        var current: Response? = response
        var count = 1
        while (current?.priorResponse != null) {
            count++
            current = current.priorResponse
        }
        return count
    }

    private companion object {
        val lock = Any()
    }
}
