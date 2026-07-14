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

    // --- pageAnchorToken / pageForToken -------------------------------------
    // Three pages with 2-char invisible gaps between them (page ranges exclude
    // trailing whitespace, so chars 10–11 and 22–23 belong to no page range).
    private val pages = listOf(0 until 10, 12 until 22, 24 until 30)

    @Test
    fun anchorRoundTripsForTokenAlignedPageStarts() {
        // A token starts exactly where page 1 starts (char 12).
        val ranges = listOf(0 until 6, 6 until 12, 12 until 16, 16 until 30)
        val token = pageAnchorToken(pages, ranges, page = 1)
        assertEquals(2, token)
        assertEquals(1, pageForToken(pages, ranges, token))
    }

    @Test
    fun anchorRoundTripsWhenPageStartsMidToken() {
        // Page 1 starts (char 12) inside token 1 (6..13) — a word broken across
        // the page boundary. Restoring by the token's first char would land one
        // page back; the anchor must resolve to page 1.
        val ranges = listOf(0 until 6, 6 until 14, 14 until 30)
        val token = pageAnchorToken(pages, ranges, page = 1)
        assertEquals(1, token)
        assertEquals(1, pageForToken(pages, ranges, token))
    }

    @Test
    fun everyPageRoundTripsThroughItsAnchorToken() {
        // Contiguous tokenization crossing both gaps and both page starts.
        val ranges = listOf(0 until 4, 4 until 5, 5 until 11, 11 until 13, 13 until 20, 20 until 26, 26 until 30)
        for (page in pages.indices) {
            assertEquals(page, pageForToken(pages, ranges, pageAnchorToken(pages, ranges, page)))
        }
    }

    @Test
    fun tokenInTrailingWhitespaceGapRestoresThePageOwningTheGap() {
        // Whitespace token entirely inside the gap after page 1 (chars 22–23);
        // it must restore page 1, not fall back to the chapter start.
        val ranges = listOf(0 until 22, 22 until 24, 24 until 30)
        assertEquals(1, pageForToken(pages, ranges, 1))
    }

    @Test
    fun tokenPastTheLastPageStartRestoresTheLastPage() {
        val ranges = listOf(0 until 28, 28 until 30)
        assertEquals(2, pageForToken(pages, ranges, 1))
    }

    @Test
    fun outOfRangeOrEmptyTokensFallBackSafely() {
        val ranges = listOf(0 until 10, 12 until 12) // second range is empty (zero-width token)
        assertEquals(0, pageForToken(pages, ranges, 99)) // unknown token → chapter start
        assertEquals(1, pageForToken(pages, ranges, 1)) // empty range anchors at its start
    }
}
