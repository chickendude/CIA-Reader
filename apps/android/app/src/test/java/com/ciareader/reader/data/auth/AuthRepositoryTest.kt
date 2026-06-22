package com.ciareader.reader.data.auth

import com.ciareader.reader.core.auth.AuthTokens
import com.ciareader.reader.core.auth.TokenStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class AuthRepositoryTest {

    private val tokenStore = FakeTokenStore()
    private fun repo(api: AuthApi) = AuthRepositoryImpl(api, tokenStore)

    @Test
    fun loginSuccessPersistsTokensAndReportsAuthenticated() = runTest {
        val repo = repo(FakeAuthApi(response = authResponse()))

        val result = repo.login("crush@test.local", "password123")

        assertTrue(result is AuthResult.Success)
        assertEquals(AuthTokens("access-1", "refresh-1"), tokenStore.current())
        assertTrue(repo.isAuthenticated.first())
    }

    @Test
    fun loginFailureSurfacesMessageAndStoresNothing() = runTest {
        val repo = repo(FakeAuthApi(error = http(401)))

        val result = repo.login("crush@test.local", "wrong")

        assertTrue(result is AuthResult.Error)
        assertEquals("Invalid email or password.", (result as AuthResult.Error).message)
        assertNull(tokenStore.current())
        assertFalse(repo.isAuthenticated.first())
    }

    @Test
    fun registerConflictMapsTo409Message() = runTest {
        val repo = repo(FakeAuthApi(error = http(409)))

        val result = repo.register("taken@test.local", "password123", null)

        assertEquals(
            "An account with that email already exists.",
            (result as AuthResult.Error).message,
        )
    }

    @Test
    fun magicLinkRequestSucceedsWithoutPersistingTokens() = runTest {
        val repo = repo(FakeAuthApi(ack = MagicLinkAckDto(ok = true)))

        val result = repo.requestMagicLink("crush@test.local")

        assertTrue(result is AuthResult.Success)
        assertNull(tokenStore.current())
    }

    @Test
    fun logoutClearsTokens() = runTest {
        tokenStore.save(AuthTokens("a", "r"))
        val repo = repo(FakeAuthApi(response = authResponse()))

        repo.logout()

        assertNull(tokenStore.current())
        assertFalse(repo.isAuthenticated.first())
    }

    // --- fakes / helpers ---

    private fun authResponse() = AuthResponseDto(
        user = UserDto(
            id = "u1",
            email = "crush@test.local",
            role = "user",
            createdAt = "2026-06-21T00:00:00Z",
        ),
        accessToken = "access-1",
        refreshToken = "refresh-1",
        expiresIn = 900,
    )

    private fun http(code: Int) = HttpException(
        Response.error<Any>(code, "err".toResponseBody("text/plain".toMediaType())),
    )
}

private class FakeAuthApi(
    private val response: AuthResponseDto? = null,
    private val ack: MagicLinkAckDto? = null,
    private val error: Throwable? = null,
) : AuthApi {
    override suspend fun login(body: LoginRequest): AuthResponseDto = error?.let { throw it } ?: response!!
    override suspend fun register(body: RegisterRequest): AuthResponseDto = error?.let { throw it } ?: response!!
    override suspend fun me(): MeResponseDto = MeResponseDto(response!!.user)
    override suspend fun requestMagicLink(body: MagicLinkRequest): MagicLinkAckDto = error?.let { throw it } ?: ack!!
    override suspend fun consumeMagicLink(body: MagicLinkConsumeRequest): AuthResponseDto =
        error?.let { throw it } ?: response!!
}

private class FakeTokenStore : TokenStore {
    private val state = MutableStateFlow<AuthTokens?>(null)
    override val tokens: Flow<AuthTokens?> = state
    override suspend fun current(): AuthTokens? = state.value
    override suspend fun save(tokens: AuthTokens) { state.value = tokens }
    override suspend fun clear() { state.value = null }
}
