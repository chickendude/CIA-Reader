package com.ciareader.reader.core.auth

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** The pair of opaque credentials returned by the auth endpoints. */
data class AuthTokens(
    val accessToken: String,
    val refreshToken: String,
)

/**
 * Persistent store for the bearer access token + rotating refresh token.
 *
 * NOTE (security, Phase 6): DataStore is plaintext at rest. Before release,
 * wrap the refresh token in Android Keystore-backed encryption (the access
 * token is short-lived — 15 min — so it matters less). The interface is kept
 * storage-agnostic so that swap doesn't touch callers.
 */
interface TokenStore {
    val tokens: Flow<AuthTokens?>
    suspend fun current(): AuthTokens?
    suspend fun save(tokens: AuthTokens)
    suspend fun clear()
}

private val Context.authDataStore by preferencesDataStore(name = "auth_tokens")

@Singleton
class DataStoreTokenStore @Inject constructor(
    @ApplicationContext private val context: Context,
) : TokenStore {

    override val tokens: Flow<AuthTokens?> = context.authDataStore.data.map { prefs ->
        val access = prefs[ACCESS]
        val refresh = prefs[REFRESH]
        if (access != null && refresh != null) AuthTokens(access, refresh) else null
    }

    override suspend fun current(): AuthTokens? = tokens.first()

    override suspend fun save(tokens: AuthTokens) {
        context.authDataStore.edit { prefs ->
            prefs[ACCESS] = tokens.accessToken
            prefs[REFRESH] = tokens.refreshToken
        }
    }

    override suspend fun clear() {
        context.authDataStore.edit { prefs ->
            prefs.remove(ACCESS)
            prefs.remove(REFRESH)
        }
    }

    private companion object {
        val ACCESS = stringPreferencesKey("access_token")
        val REFRESH = stringPreferencesKey("refresh_token")
    }
}
