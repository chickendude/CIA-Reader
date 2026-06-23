package com.ciareader.reader.data.reader

import com.ciareader.reader.data.local.CachedChapterEntity
import com.ciareader.reader.data.local.CachedChapterRefEntity
import com.ciareader.reader.data.local.CachedTextEntity
import com.ciareader.reader.data.local.ReaderCacheDao
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Maps reader content between the domain types and the Room cache, including
 * (de)serializing a chapter's tokens to/from the JSON blob column. The
 * repository owns the network-vs-cache decision; this just stores and reads.
 */
@Singleton
class ReaderCache @Inject constructor(
    private val dao: ReaderCacheDao,
    private val json: Json,
) {

    suspend fun textMeta(textId: String): TextMeta? {
        val text = dao.text(textId) ?: return null
        val refs = dao.chapterRefs(textId)
        return TextMeta(
            id = text.textId,
            title = text.title,
            language = text.language,
            status = text.status,
            chapterCount = text.chapterCount,
            chapters = refs.map { ChapterRef(it.idx, it.title, it.tokenCount) },
        )
    }

    suspend fun putTextMeta(meta: TextMeta, now: Long) {
        dao.upsertText(
            CachedTextEntity(
                textId = meta.id,
                title = meta.title,
                language = meta.language,
                status = meta.status,
                chapterCount = meta.chapterCount,
                cachedAt = now,
            ),
        )
        dao.upsertChapterRefs(
            meta.chapters.map { CachedChapterRefEntity(meta.id, it.idx, it.title, it.tokenCount) },
        )
    }

    suspend fun chapter(textId: String, chapterIdx: Int): Chapter? {
        val row = dao.chapter(textId, chapterIdx) ?: return null
        val tokens = json.decodeFromString<List<ReaderToken>>(row.tokensJson)
        return Chapter(chapterIdx, tokens)
    }

    suspend fun putChapter(textId: String, chapter: Chapter, now: Long) {
        dao.upsertChapter(
            CachedChapterEntity(
                textId = textId,
                chapterIdx = chapter.chapterIdx,
                tokensJson = json.encodeToString(chapter.tokens),
                cachedAt = now,
            ),
        )
    }
}
