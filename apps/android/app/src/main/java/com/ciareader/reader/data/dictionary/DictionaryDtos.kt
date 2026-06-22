package com.ciareader.reader.data.dictionary

import kotlinx.serialization.Serializable

/** Mirrors GET /api/v1/lemmas/:id/translations. */
@Serializable
data class LemmaTranslationsDto(
    val lemma: LemmaDto,
    val translations: TranslationGroupsDto = TranslationGroupsDto(),
    val definitionLanguages: List<String> = emptyList(),
)

@Serializable
data class LemmaDto(
    val id: String,
    val headword: String,
    val pos: String? = null,
    val glossDefault: String? = null,
)

@Serializable
data class TranslationGroupsDto(
    val personal: List<TranslationDto> = emptyList(),
    val official: List<TranslationDto> = emptyList(),
    val community: List<TranslationDto> = emptyList(),
)

@Serializable
data class TranslationDto(
    val id: String,
    val body: String,
    val targetLanguage: String? = null,
    val sourceAttribution: String? = null,
)

/** PATCH /api/v1/me/known-lemmas/:lemmaId */
@Serializable
data class KnownLemmaRequest(val status: String)

@Serializable
data class KnownLemmaResponseDto(val knownLemma: KnownLemmaDto)

@Serializable
data class KnownLemmaDto(val lemmaId: String, val status: String)
