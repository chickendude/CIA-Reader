package com.ciareader.reader.data.local

import android.app.Application
import androidx.room.Room
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class)
class ReaderCacheDaoTest {

    private lateinit var db: AppDatabase
    private lateinit var dao: ReaderCacheDao

    @Before
    fun setUp() {
        val context = RuntimeEnvironment.getApplication()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = db.readerCacheDao()
    }

    @After
    fun tearDown() = db.close()

    @Test
    fun textRoundTrips() = runTest {
        val text = CachedTextEntity("t1", "My Book", "hi", "ready", chapterCount = 3, cachedAt = 1000)
        dao.upsertText(text)
        assertEquals(text, dao.text("t1"))
    }

    @Test
    fun missingTextIsNull() = runTest {
        assertNull(dao.text("nope"))
    }

    @Test
    fun upsertReplacesExistingText() = runTest {
        dao.upsertText(CachedTextEntity("t1", "Old", "hi", "ready", 1, cachedAt = 1000))
        dao.upsertText(CachedTextEntity("t1", "New", "hi", "ready", 4, cachedAt = 2000))
        val row = dao.text("t1")
        assertEquals("New", row?.title)
        assertEquals(4, row?.chapterCount)
        assertEquals(2000L, row?.cachedAt)
    }

    @Test
    fun chapterRefsComeBackOrderedByIdx() = runTest {
        dao.upsertChapterRefs(
            listOf(
                CachedChapterRefEntity("t1", idx = 2, title = "Three", tokenCount = 30),
                CachedChapterRefEntity("t1", idx = 0, title = "One", tokenCount = 10),
                CachedChapterRefEntity("t1", idx = 1, title = "Two", tokenCount = 20),
            ),
        )
        val refs = dao.chapterRefs("t1")
        assertEquals(listOf(0, 1, 2), refs.map { it.idx })
        assertEquals("One", refs.first().title)
    }

    @Test
    fun chapterTokensRoundTripAndMissingIsNull() = runTest {
        val chapter = CachedChapterEntity("t1", chapterIdx = 0, tokensJson = "[{\"idx\":0}]", cachedAt = 1000)
        dao.upsertChapter(chapter)
        assertEquals(chapter, dao.chapter("t1", 0))
        assertNull(dao.chapter("t1", 9))
    }

    @Test
    fun lemmaRoundTripsAndMissingIsNull() = runTest {
        val lemma = CachedLemmaEntity("l1", json = "{\"lemma\":{}}", cachedAt = 1000)
        dao.upsertLemma(lemma)
        assertEquals(lemma, dao.lemma("l1"))
        assertNull(dao.lemma("nope"))
    }

    @Test
    fun upsertReplacesExistingLemma() = runTest {
        dao.upsertLemma(CachedLemmaEntity("l1", json = "{\"old\":1}", cachedAt = 1000))
        dao.upsertLemma(CachedLemmaEntity("l1", json = "{\"new\":2}", cachedAt = 2000))
        val row = dao.lemma("l1")
        assertEquals("{\"new\":2}", row?.json)
        assertEquals(2000L, row?.cachedAt)
    }

    @Test
    fun basqueReferenceRoundTripsAndMissingIsNull() = runTest {
        val ref = CachedBasqueReferenceEntity("etxe", json = "{\"results\":[]}", cachedAt = 1000)
        dao.upsertBasqueReference(ref)
        assertEquals(ref, dao.basqueReference("etxe"))
        // Exact-search keys are distinct rows from the case-folded lemma key.
        assertNull(dao.basqueReference("exact:etxe"))
    }

    @Test
    fun deleteRemovesAllRowsForAText() = runTest {
        dao.upsertText(CachedTextEntity("t1", "B", "hi", "ready", 1, cachedAt = 1000))
        dao.upsertChapterRefs(listOf(CachedChapterRefEntity("t1", 0, "One", 10)))
        dao.upsertChapter(CachedChapterEntity("t1", 0, "[]", cachedAt = 1000))

        dao.deleteText("t1")
        dao.deleteChapterRefs("t1")
        dao.deleteChapters("t1")

        assertNull(dao.text("t1"))
        assertEquals(emptyList<CachedChapterRefEntity>(), dao.chapterRefs("t1"))
        assertNull(dao.chapter("t1", 0))
    }
}
