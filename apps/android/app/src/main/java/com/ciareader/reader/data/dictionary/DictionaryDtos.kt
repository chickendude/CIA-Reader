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

/** POST /api/v1/translations — submit the viewer's own definition for a lemma.
 *  targetLanguage is optional; omitted lets the server use the account default.
 *  parentTranslationId links the new personal definition to the official /
 *  community entry it was forked from (the "customize a dictionary entry" flow);
 *  null when written from scratch or seeded from a reference (non-DB) entry. */
@Serializable
data class CreateTranslationRequest(
    val lemmaId: String,
    val body: String,
    val targetLanguage: String? = null,
    val parentTranslationId: String? = null,
)

@Serializable
data class CreateTranslationResponseDto(val translation: TranslationDto? = null)

/** PATCH /api/v1/translations/:id — edit the viewer's own definition. */
@Serializable
data class UpdateTranslationRequest(val body: String)

/** GET /api/v1/admin/basque-dictionary?word= — admin-only reference dictionaries
 *  (Elhuyar / Euskaltzaindia). 403s for non-admins. */
@Serializable
data class BasqueReferenceResponseDto(
    val word: String = "",
    val results: List<BasqueRefDto> = emptyList(),
)

@Serializable
data class BasqueRefDto(
    val source: String = "",
    val label: String = "",
    val headword: String = "",
    val pos: String = "",
    val definition: String = "",
    val examples: List<String> = emptyList(),
    val url: String = "",
)

/** PATCH /api/v1/me/known-lemmas/:lemmaId */
@Serializable
data class KnownLemmaRequest(val status: String)

@Serializable
data class KnownLemmaResponseDto(val knownLemma: KnownLemmaDto)

@Serializable
data class KnownLemmaDto(val lemmaId: String, val status: String)
