package com.ciareader.reader.data.dictionary

import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.core.network.apiCall
import com.ciareader.reader.data.local.CachedLemmaEntity
import com.ciareader.reader.data.local.ReaderCacheDao
import com.ciareader.reader.data.reader.KnownStatus
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

data class WordTranslation(val body: String, val attribution: String?, val id: String? = null)

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
    /** Cache-first: returns the persisted copy instantly if present, else fetches
     *  it, persists, and returns — so re-taps and offline reads are fast. */
    suspend fun translations(lemmaId: String): Outcome<LemmaTranslations>

    /** Force-fetches the latest definitions (e.g. new community suggestions),
     *  re-persisting on success; on failure falls back to the cached copy. */
    suspend fun refreshTranslations(lemmaId: String): Outcome<LemmaTranslations>

    /** Persists the viewer's status for a lemma; returns the confirmed status. */
    suspend fun setStatus(lemmaId: String, status: KnownStatus): Outcome<KnownStatus>

    /** Submit the viewer's own definition for a lemma. */
    suspend fun addDefinition(lemmaId: String, body: String): Outcome<Unit>

    /** Edit one of the viewer's own definitions (by its translation id). */
    suspend fun editDefinition(translationId: String, body: String): Outcome<Unit>

    /** Delete one of the viewer's own definitions (by its translation id). */
    suspend fun deleteDefinition(translationId: String): Outcome<Unit>

    /** Admin-only Basque reference dictionaries for a word (403 → Failure).
     *  [exact] preserves case for a precise search (an autocomplete pick); the
     *  default lowercases the word for the tapped-surface lemma lookup. */
    suspend fun basqueReference(word: String, exact: Boolean = false): Outcome<List<BasqueReference>>

    /** Admin-only Elhuyar headword suggestions for the reference search box. */
    suspend fun basqueReferenceAutocomplete(term: String): Outcome<List<String>>
}

@Singleton
class DictionaryRepositoryImpl @Inject constructor(
    private val api: DictionaryApi,
    private val cache: ReaderCacheDao,
    private val json: Json,
) : DictionaryRepository {

    override suspend fun translations(lemmaId: String): Outcome<LemmaTranslations> {
        cachedTranslations(lemmaId)?.let { return Outcome.Success(it.toDomain()) }
        return fetchAndPersist(lemmaId)
    }

    override suspend fun refreshTranslations(lemmaId: String): Outcome<LemmaTranslations> {
        val fresh = fetchAndPersist(lemmaId)
        if (fresh is Outcome.Failure) {
            cachedTranslations(lemmaId)?.let { return Outcome.Success(it.toDomain()) }
        }
        return fresh
    }

    /** Fetch from the network and, on success, persist the raw DTO json. */
    private suspend fun fetchAndPersist(lemmaId: String): Outcome<LemmaTranslations> =
        apiCall {
            val dto = api.translations(lemmaId)
            cache.upsertLemma(
                CachedLemmaEntity(lemmaId, json.encodeToString(dto), System.currentTimeMillis()),
            )
            dto.toDomain()
        }

    /** The cached DTO for a lemma, or null on a miss or undecodable blob. */
    private suspend fun cachedTranslations(lemmaId: String): LemmaTranslationsDto? {
        val row = cache.lemma(lemmaId) ?: return null
        return runCatching { json.decodeFromString<LemmaTranslationsDto>(row.json) }.getOrNull()
    }

    override suspend fun setStatus(lemmaId: String, status: KnownStatus): Outcome<KnownStatus> =
        apiCall {
            val response = api.setKnownStatus(lemmaId, KnownLemmaRequest(status.wire()))
            KnownStatus.fromWire(response.knownLemma.status)
        }

    override suspend fun addDefinition(lemmaId: String, body: String): Outcome<Unit> =
        apiCall { api.addTranslation(CreateTranslationRequest(lemmaId, body)); Unit }

    override suspend fun editDefinition(translationId: String, body: String): Outcome<Unit> =
        apiCall { api.editTranslation(translationId, UpdateTranslationRequest(body)); Unit }

    override suspend fun deleteDefinition(translationId: String): Outcome<Unit> =
        apiCall { api.deleteTranslation(translationId) }

    // Reference lookups are stable, so cache per word for the session — reopening
    // a word shows them instantly instead of re-hitting the network.
    private val basqueCache = mutableMapOf<String, List<BasqueReference>>()

    override suspend fun basqueReference(word: String, exact: Boolean): Outcome<List<BasqueReference>> {
        // Exact searches preserve case ("Afrika" ≠ "afrika"), so key on the raw
        // term; lemma lookups are case-folded and share a key across re-taps.
        val key = if (exact) "exact:$word" else word.lowercase()
        basqueCache[key]?.let { return Outcome.Success(it) }
        val net = apiCall {
            api.basqueReference(word, if (exact) "1" else null).results.map {
                BasqueReference(it.source, it.label, it.pos, it.definition, it.examples)
            }
        }
        if (net is Outcome.Success) basqueCache[key] = net.data
        return net
    }

    override suspend fun basqueReferenceAutocomplete(term: String): Outcome<List<String>> =
        apiCall { api.basqueAutocomplete(term).terms }
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
    personal = translations.personal.map { WordTranslation(it.body, it.sourceAttribution, it.id) },
    official = translations.official.map { WordTranslation(it.body, it.sourceAttribution, it.id) },
    community = translations.community.map { WordTranslation(it.body, it.sourceAttribution, it.id) },
)
