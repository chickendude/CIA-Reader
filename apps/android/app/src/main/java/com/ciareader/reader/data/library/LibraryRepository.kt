package com.ciareader.reader.data.library

import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.core.network.apiCall
import javax.inject.Inject
import javax.inject.Singleton

/** Which library tab to list. Maps to the endpoint's `scope` param. */
enum class LibraryScope(val wire: String) {
    OWNED("owned"),
    SHARED("shared"),
    OFFICIAL("official"),
}

/** UI-facing library entry (the wire DTO trimmed to what a card needs). */
data class TextCard(
    val id: String,
    val title: String,
    val language: String,
    val status: String,
    /** Estimated comprehension (0–100), or null when not yet computed; the
     *  library card renders a small "%"" badge when present. */
    val estimatedComprehensionPct: Int? = null,
    /** Reading progress 0f–1f for the card's progress track. */
    val progress: Float = 0f,
) {
    val isReady: Boolean get() = status == "ready"
}

/** Per-text figures for the Stats sheet, derived from GET /texts/:id. */
data class TextStats(
    val chapterCount: Int,
    val totalWords: Int,
    /** Real comprehension 0–100, or null before the text is tokenized. */
    val comprehensionPct: Int?,
)

interface LibraryRepository {
    suspend fun listTexts(scope: LibraryScope, language: String): Outcome<List<TextCard>>

    /** Per-text Stats: chapter count, summed word count, viewer comprehension. */
    suspend fun textStats(textId: String): Outcome<TextStats>

    /** Rename a text (PATCH, title only). Returns the new title; caller re-lists. */
    suspend fun updateText(textId: String, title: String): Outcome<String>

    /** Delete a standalone text (DELETE). The caller re-lists on success. */
    suspend fun deleteText(textId: String): Outcome<Unit>

    /** Last-cached listing, without touching the network — for instant launch. */
    suspend fun cachedTexts(scope: LibraryScope, language: String): List<TextCard>
}

@Singleton
class LibraryRepositoryImpl @Inject constructor(
    private val api: LibraryApi,
    private val cache: LibraryCache,
) : LibraryRepository {
    // Network-first with offline fallback to the last-cached listing.
    override suspend fun listTexts(scope: LibraryScope, language: String): Outcome<List<TextCard>> =
        when (
            val net = apiCall {
                api.listTexts(scope = scope.wire, language = language).cards.map { it.toDomain() }
            }
        ) {
            is Outcome.Success -> {
                cache.putCards(scope, language, net.data)
                net
            }
            is Outcome.Failure -> cache.cards(scope, language).takeIf { it.isNotEmpty() }
                ?.let { Outcome.Success(it) } ?: net
        }

    // Stats reuse the reader's text-detail payload (chapters + comprehension);
    // not cached — the figures are live (comprehension shifts as words are learned).
    override suspend fun textStats(textId: String): Outcome<TextStats> = apiCall {
        val dto = api.textDetail(textId)
        TextStats(
            chapterCount = dto.chapterCount,
            totalWords = dto.chapters.sumOf { it.tokenCount },
            comprehensionPct = dto.comprehensionPct,
        )
    }

    // Rename goes straight to the network; the caller re-lists on success so the
    // new title shows in both the live list and the (wholesale-replaced) cache.
    override suspend fun updateText(textId: String, title: String): Outcome<String> = apiCall {
        api.updateText(textId, UpdateTextRequest(title = title)).text.title
    }

    // Network delete; the caller re-lists on success, and listTexts replaces the
    // cached listing wholesale, so the removed text drops from the offline cache too.
    override suspend fun deleteText(textId: String): Outcome<Unit> = apiCall {
        api.deleteText(textId)
        Unit
    }

    override suspend fun cachedTexts(scope: LibraryScope, language: String): List<TextCard> =
        cache.cards(scope, language)
}

private fun TextCardDto.toDomain() = TextCard(
    id = id,
    title = title,
    language = language,
    status = status,
    estimatedComprehensionPct = estimatedComprehensionPct,
    progress = (progressPct / 100.0).toFloat().coerceIn(0f, 1f),
)
