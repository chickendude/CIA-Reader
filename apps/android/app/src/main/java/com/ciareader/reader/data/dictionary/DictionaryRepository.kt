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

interface DictionaryRepository {
    suspend fun translations(lemmaId: String): Outcome<LemmaTranslations>

    /** Persists the viewer's status for a lemma; returns the confirmed status. */
    suspend fun setStatus(lemmaId: String, status: KnownStatus): Outcome<KnownStatus>
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
