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

/** A reference-dictionary entry (admin-only, Basque) for the word sheet.
 *  [source] is the upstream id (elhuyar_es / elhuyar_en / euskaltzaindia), which
 *  the UI groups into ES/EN/EU tabs. */
data class BasqueReference(
    val source: String,
    val label: String,
    val pos: String,
    val definition: String,
    val examples: List<String>,
)

interface DictionaryRepository {
    /** Definitions for a lemma — served from cache when available (instant). */
    suspend fun translations(lemmaId: String): Outcome<LemmaTranslations>

    /** Force a re-fetch (bypassing cache) to pull the latest community suggestions. */
    suspend fun refreshTranslations(lemmaId: String): Outcome<LemmaTranslations>

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

    // Cache definitions per lemma for the session, so re-tapping a word (or any
    // word sharing the lemma) shows instantly instead of re-fetching.
    private val translationsCache = mutableMapOf<String, LemmaTranslations>()

    override suspend fun translations(lemmaId: String): Outcome<LemmaTranslations> {
        translationsCache[lemmaId]?.let { return Outcome.Success(it) }
        return fetchTranslations(lemmaId)
    }

    override suspend fun refreshTranslations(lemmaId: String): Outcome<LemmaTranslations> =
        when (val net = fetchTranslations(lemmaId)) {
            is Outcome.Success -> net
            // Keep the cached copy visible if the refresh fails (offline, etc.).
            is Outcome.Failure -> translationsCache[lemmaId]?.let { Outcome.Success(it) } ?: net
        }

    private suspend fun fetchTranslations(lemmaId: String): Outcome<LemmaTranslations> {
        val net = apiCall { api.translations(lemmaId).toDomain() }
        if (net is Outcome.Success) translationsCache[lemmaId] = net.data
        return net
    }

    override suspend fun setStatus(lemmaId: String, status: KnownStatus): Outcome<KnownStatus> =
        apiCall {
            val response = api.setKnownStatus(lemmaId, KnownLemmaRequest(status.wire()))
            KnownStatus.fromWire(response.knownLemma.status)
        }

    override suspend fun addDefinition(lemmaId: String, body: String): Outcome<Unit> =
        apiCall { api.addTranslation(CreateTranslationRequest(lemmaId, body)); Unit }

    // Reference lookups are stable, so cache per word for the session — reopening
    // a word shows them instantly instead of re-hitting the network.
    private val basqueCache = mutableMapOf<String, List<BasqueReference>>()

    override suspend fun basqueReference(word: String): Outcome<List<BasqueReference>> {
        val key = word.lowercase()
        basqueCache[key]?.let { return Outcome.Success(it) }
        val net = apiCall {
            api.basqueReference(word).results.map {
                BasqueReference(it.source, it.label, it.pos, it.definition, it.examples)
            }
        }
        if (net is Outcome.Success) basqueCache[key] = net.data
        return net
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
