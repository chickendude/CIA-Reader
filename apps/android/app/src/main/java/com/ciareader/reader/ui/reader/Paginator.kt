package com.ciareader.reader.ui.reader

/**
 * Pagination engine for page mode.
 *
 * Groups a measured chapter's lines into pages no taller than [pageHeightPx],
 * returning the character range each page covers. Kept pure (line geometry in,
 * ranges out) so it's unit-testable without a graphics environment — the reader
 * adapts a measured `TextLayoutResult` to these line accessors. This is the
 * cheap measure-once-then-group approach: one layout pass per chapter, no
 * native code.
 */
internal fun paginateLines(
    lineCount: Int,
    lineTop: (Int) -> Float,
    lineBottom: (Int) -> Float,
    lineStart: (Int) -> Int,
    lineEnd: (Int) -> Int,
    pageHeightPx: Float,
): List<IntRange> {
    if (lineCount <= 0) return listOf(IntRange.EMPTY)
    // Not measured yet (zero height): one page with everything; the UI re-runs
    // once it has real constraints.
    if (pageHeightPx <= 0f) return listOf(lineStart(0) until lineEnd(lineCount - 1))

    val pages = mutableListOf<IntRange>()
    var start = 0
    while (start < lineCount) {
        val top = lineTop(start)
        var end = start
        // Extend while the next line still fits; always keep at least one line so
        // a single over-tall line can't loop forever.
        while (end + 1 < lineCount && lineBottom(end + 1) - top <= pageHeightPx) {
            end++
        }
        pages.add(lineStart(start) until lineEnd(end))
        start = end + 1
    }
    return pages
}

/**
 * The token to persist as the reading anchor for [page]: the token whose
 * character range contains the page's first character. Inverse of
 * [pageForToken] — keep the two in sync or restored positions drift.
 */
internal fun pageAnchorToken(pages: List<IntRange>, ranges: List<IntRange>, page: Int): Int {
    val start = pages.getOrNull(page)?.first ?: 0
    return ranges.indexOfFirst { start in it }.coerceAtLeast(0)
}

/**
 * The page a saved anchor token restores to. Matches on the token's LAST
 * character so a token straddling a page boundary resolves to the page that
 * starts inside it (the page [pageAnchorToken] recorded it for), not the page
 * it started on. Matches by "last page starting at or before" because page
 * ranges exclude invisible trailing whitespace — an anchor landing in the gap
 * between two pages belongs to the page owning that gap, not to no page.
 */
internal fun pageForToken(pages: List<IntRange>, ranges: List<IntRange>, tokenIdx: Int): Int {
    val range = ranges.getOrNull(tokenIdx) ?: return 0
    val anchor = maxOf(range.first, range.last) // an empty range anchors at its start
    return pages.indexOfLast { it.first <= anchor }.coerceAtLeast(0)
}
