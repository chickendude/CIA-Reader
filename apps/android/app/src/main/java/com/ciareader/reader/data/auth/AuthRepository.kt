package com.ciareader.reader.data.auth

import com.ciareader.reader.core.auth.AuthTokens
import com.ciareader.reader.core.auth.TokenStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import retrofit2.HttpException
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** Outcome of an auth action, surfaced to the UI. */
sealed interface AuthResult {
    data object Success : AuthResult
    data class Error(val message: String) : AuthResult
}

interface AuthRepository {
    /** Emits whether stored credentials exist (drives auth-gated nav). */
    val isAuthenticated: Flow<Boolean>

    suspend fun login(email: String, password: String): AuthResult
    suspend fun register(email: String, password: String, displayName: String?): AuthResult
    suspend fun requestMagicLink(email: String): AuthResult
    suspend fun consumeMagicLink(token: String): AuthResult
    suspend fun logout()
}

@Singleton
class AuthRepositoryImpl @Inject constructor(
    private val authApi: AuthApi,
    private val tokenStore: TokenStore,
) : AuthRepository {

    override val isAuthenticated: Flow<Boolean> = tokenStore.tokens.map { it != null }

    override suspend fun login(email: String, password: String): AuthResult =
        runAuth { authApi.login(LoginRequest(email = email, password = password)) }

    override suspend fun register(email: String, password: String, displayName: String?): AuthResult =
        runAuth {
            authApi.register(
                RegisterRequest(email = email, password = password, displayName = displayName),
            )
        }

    override suspend fun consumeMagicLink(token: String): AuthResult =
        runAuth { authApi.consumeMagicLink(MagicLinkConsumeRequest(token = token)) }

    override suspend fun requestMagicLink(email: String): AuthResult = try {
        authApi.requestMagicLink(MagicLinkRequest(email = email))
        AuthResult.Success
    } catch (e: HttpException) {
        AuthResult.Error(httpMessage(e))
    } catch (_: IOException) {
        AuthResult.Error(NETWORK_ERROR)
    }

    override suspend fun logout() {
        // v1: drop local credentials. (Server-side session revocation via
        // POST /api/v1/auth/logout is a later enhancement; the bearer/refresh
        // tokens simply expire.)
        tokenStore.clear()
    }

    /** Runs an auth call that returns tokens, persisting them on success. */
    private suspend fun runAuth(block: suspend () -> AuthResponseDto): AuthResult = try {
        val response = block()
        tokenStore.save(AuthTokens(response.accessToken, response.refreshToken))
        AuthResult.Success
    } catch (e: HttpException) {
        AuthResult.Error(httpMessage(e))
    } catch (_: IOException) {
        AuthResult.Error(NETWORK_ERROR)
    }

    private fun httpMessage(e: HttpException): String = when (e.code()) {
        401 -> "Invalid email or password."
        409 -> "An account with that email already exists."
        in 500..599 -> "The server had a problem. Please try again."
        else -> "Something went wrong (${e.code()})."
    }

    private companion object {
        const val NETWORK_ERROR = "Network error — check your connection and try again."
    }
}
