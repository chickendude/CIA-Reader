package com.ciareader.reader.data.dictionary

import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.core.network.apiCall
import com.ciareader.reader.data.reader.KnownStatus
import javax.inject.Inject
import javax.inject.Singleton

data class WordTranslation(val body: String, val attribution: String?)

/** A lemma's definitions, grouped by source (for the reader's word sheet). */
data class LemmaTranslations(
    val headword: String,
    val pos: String?,
    val gloss: String?,
    val personal: List<WordTranslation>,
    val official: List<WordTranslation>,
    val community: List<WordTranslation>,
) {
    val isEmpty: Boolean
        get() = personal.isEmpty() && official.isEmpty() && community.isEmpty()
}

/** A reference-dictionary entry (admin-only, Basque) for the word sheet. */
data class BasqueReference(
    val label: String,
    val pos: String,
    val definition: String,
    val examples: List<String>,
)

interface DictionaryRepository {
    suspend fun translations(lemmaId: String): Outcome<LemmaTranslations>

    /** Persists the viewer's status for a lemma; returns the confirmed status. */
    suspend fun setStatus(lemmaId: String, status: KnownStatus): Outcome<KnownStatus>

    /** Submit the viewer's own definition for a lemma. */
    suspend fun addDefinition(lemmaId: String, body: String): Outcome<Unit>

    /** Admin-only Basque reference dictionaries for a surface word (403 → Failure). */
    suspend fun basqueReference(word: String): Outcome<List<BasqueReference>>
}

@Singleton
class DictionaryRepositoryImpl @Inject constructor(
    private val api: DictionaryApi,
) : DictionaryRepository {

    override suspend fun translations(lemmaId: String): Outcome<LemmaTranslations> =
        apiCall { api.translations(lemmaId).toDomain() }

    override suspend fun setStatus(lemmaId: String, status: KnownStatus): Outcome<KnownStatus> =
        apiCall {
            val response = api.setKnownStatus(lemmaId, KnownLemmaRequest(status.wire()))
            KnownStatus.fromWire(response.knownLemma.status)
        }

    override suspend fun addDefinition(lemmaId: String, body: String): Outcome<Unit> =
        apiCall { api.addTranslation(CreateTranslationRequest(lemmaId, body)); Unit }

    override suspend fun basqueReference(word: String): Outcome<List<BasqueReference>> =
        apiCall {
            api.basqueReference(word).results.map {
                BasqueReference(label = it.label, pos = it.pos, definition = it.definition, examples = it.examples)
            }
        }
}

private fun KnownStatus.wire(): String = when (this) {
    KnownStatus.UNKNOWN -> "unknown"
    KnownStatus.LEARNING -> "learning"
    KnownStatus.KNOWN -> "known"
    KnownStatus.IGNORED -> "ignored"
}

private fun LemmaTranslationsDto.toDomain() = LemmaTranslations(
    headword = lemma.headword,
    pos = lemma.pos,
    gloss = lemma.glossDefault,
    personal = translations.personal.map { WordTranslation(it.body, it.sourceAttribution) },
    official = translations.official.map { WordTranslation(it.body, it.sourceAttribution) },
    community = translations.community.map { WordTranslation(it.body, it.sourceAttribution) },
)
