package com.ciareader.reader.ui.reader

import org.junit.Assert.assertEquals
import org.junit.Test

class PaginatorTest {

    // 5 chars per line; line i spans [i*5, i*5+5) and is 10px tall.
    private fun lineStart(i: Int) = i * 5
    private fun lineEnd(i: Int) = i * 5 + 5
    private fun lineTop(i: Int) = i * 10f
    private fun lineBottom(i: Int) = (i + 1) * 10f

    private fun paginate(lineCount: Int, pageHeightPx: Float) =
        paginateLines(lineCount, ::lineTop, ::lineBottom, ::lineStart, ::lineEnd, pageHeightPx)

    @Test
    fun groupsLinesIntoPagesThatFit() {
        // 6 lines × 10px, page height 30px → 3 lines per page → 2 pages.
        val pages = paginate(lineCount = 6, pageHeightPx = 30f)
        assertEquals(listOf(0 until 15, 15 until 30), pages)
    }

    @Test
    fun lastPageTakesTheRemainder() {
        // 7 lines, 30px pages → 3 + 3 + 1.
        val pages = paginate(lineCount = 7, pageHeightPx = 30f)
        assertEquals(listOf(0 until 15, 15 until 30, 30 until 35), pages)
    }

    @Test
    fun keepsAtLeastOneLinePerPageWhenLineTallerThanPage() {
        // Page height smaller than a single line → one line per page, no infinite loop.
        val pages = paginate(lineCount = 3, pageHeightPx = 5f)
        assertEquals(listOf(0 until 5, 5 until 10, 10 until 15), pages)
    }

    @Test
    fun singlePageWhenEverythingFits() {
        assertEquals(listOf(0 until 15), paginate(lineCount = 3, pageHeightPx = 1000f))
    }

    @Test
    fun emptyChapterYieldsOneEmptyPage() {
        assertEquals(listOf(IntRange.EMPTY), paginate(lineCount = 0, pageHeightPx = 100f))
    }

    @Test
    fun unmeasuredHeightFallsBackToOnePage() {
        assertEquals(listOf(0 until 15), paginate(lineCount = 3, pageHeightPx = 0f))
    }
}
