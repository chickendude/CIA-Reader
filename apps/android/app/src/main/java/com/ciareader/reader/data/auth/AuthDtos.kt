package com.ciareader.reader.data.auth

import kotlinx.serialization.Serializable

/** Mirrors `publicUser()` in apps/web .../api/v1/auth/_helpers.ts. */
@Serializable
data class UserDto(
    val id: String,
    val email: String,
    val displayName: String? = null,
    val role: String,
    val themePreference: String? = null,
    val emailVerifiedAt: String? = null,
    val createdAt: String,
)

/** Shared response of login / register / refresh / magic-link consume. */
@Serializable
data class AuthResponseDto(
    val user: UserDto,
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Int,
)

@Serializable
data class MeResponseDto(val user: UserDto)

@Serializable
data class MagicLinkAckDto(val ok: Boolean)

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class RegisterRequest(
    val email: String,
    val password: String,
    val displayName: String? = null,
)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class MagicLinkRequest(val email: String)

@Serializable
data class MagicLinkConsumeRequest(val token: String)
