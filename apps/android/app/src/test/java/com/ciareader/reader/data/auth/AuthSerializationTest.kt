package com.ciareader.reader.data.auth

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Guards the DTOs against drift from the server's auth response shape. */
class AuthSerializationTest {

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    @Test
    fun decodesAuthResponseMatchingServerShape() {
        val payload = """
            {
              "user": {
                "id": "u_123",
                "email": "crush@test.local",
                "displayName": null,
                "role": "user",
                "themePreference": null,
                "emailVerifiedAt": null,
                "createdAt": "2026-06-21T00:00:00.000Z"
              },
              "accessToken": "jwt.access.token",
              "refreshToken": "refresh-token",
              "expiresIn": 900
            }
        """.trimIndent()

        val dto = json.decodeFromString<AuthResponseDto>(payload)

        assertEquals("u_123", dto.user.id)
        assertEquals("crush@test.local", dto.user.email)
        assertNull(dto.user.displayName)
        assertEquals("user", dto.user.role)
        assertEquals("refresh-token", dto.refreshToken)
        assertEquals(900, dto.expiresIn)
    }

    @Test
    fun toleratesUnknownAndAbsentOptionalFields() {
        // Server may add fields; optionals may be omitted. Neither should break decoding.
        val payload = """
            {
              "user": {
                "id": "u1",
                "email": "a@b.co",
                "role": "admin",
                "createdAt": "2026-01-01T00:00:00Z",
                "futureField": 42
              },
              "accessToken": "a",
              "refreshToken": "r",
              "expiresIn": 900
            }
        """.trimIndent()

        val dto = json.decodeFromString<AuthResponseDto>(payload)

        assertEquals("admin", dto.user.role)
        assertNull(dto.user.themePreference)
        assertNull(dto.user.displayName)
    }
}
