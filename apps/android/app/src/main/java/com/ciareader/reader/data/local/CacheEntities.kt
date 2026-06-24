package com.ciareader.reader.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * On-device cache of reader content so a downloaded text stays readable
 * offline. Each row carries a [cachedAt] epoch-millis stamp so a later
 * eviction/refresh policy can reason about staleness; nothing here is the
 * source of truth — it mirrors the server and can be dropped at any time.
 */
@Entity(tableName = "cached_text")
data class CachedTextEntity(
    @PrimaryKey val textId: String,
    val title: String,
    val language: String,
    val status: String,
    val chapterCount: Int,
    val cachedAt: Long,
)

/** A chapter's table-of-contents entry within a cached text. */
@Entity(tableName = "cached_chapter_ref", primaryKeys = ["textId", "idx"])
data class CachedChapterRefEntity(
    val textId: String,
    val idx: Int,
    val title: String,
    val tokenCount: Int,
)

/**
 * A cached chapter's rendered tokens, stored as a JSON blob in [tokensJson]
 * rather than one row per token — a chapter is read and written whole, so a
 * blob avoids thousands of tiny rows and a join on every page turn.
 */
@Entity(tableName = "cached_chapter", primaryKeys = ["textId", "chapterIdx"])
data class CachedChapterEntity(
    val textId: String,
    val chapterIdx: Int,
    val tokensJson: String,
    val cachedAt: Long,
)

/**
 * A looked-up lemma's definitions, stored as the raw server JSON in [json] so a
 * tapped word stays fast on re-tap and readable offline. Keyed by lemmaId; like
 * the other content tables it's a disposable server mirror carrying a [cachedAt]
 * stamp for a future staleness/refresh policy.
 */
@Entity(tableName = "cached_lemma")
data class CachedLemmaEntity(
    @PrimaryKey val lemmaId: String,
    val json: String,
    val cachedAt: Long,
)

/**
 * A reading position saved while offline, awaiting upload to the server. One
 * row per text (latest position); cleared once flushed. Unlike the content
 * tables this is genuine user state, not a server mirror — but it lives in the
 * same disposable DB, so an unsynced position can be lost on a schema rebuild.
 */
@Entity(tableName = "pending_progress")
data class PendingProgressEntity(
    @PrimaryKey val textId: String,
    val chapterIdx: Int,
    val tokenIdx: Int,
    val pctRead: Double,
    val updatedAt: Long,
)
