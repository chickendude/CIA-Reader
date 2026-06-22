package com.ciareader.reader.data.language

import kotlinx.serialization.Serializable

/** Mirrors GET /api/v1/me/languages. */
@Serializable
data class LanguagesResponseDto(val languages: List<LanguageDto> = emptyList())

@Serializable
data class LanguageDto(
    val code: String,
    val displayName: String,
    val nativeName: String,
    val script: String,
    val isDefault: Boolean = false,
    val scriptPreference: String? = null,
    val romanizationScheme: String? = null,
    val supportedRomanizations: List<String> = emptyList(),
)

@Serializable
data class SetLanguageRequest(val code: String)

@Serializable
data class SetLanguageResponseDto(val code: String)
