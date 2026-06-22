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
