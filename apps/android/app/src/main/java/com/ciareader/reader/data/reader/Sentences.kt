package com.ciareader.reader.data.reader

/**
 * Client-side sentence reconstruction from a chapter's rendered tokens.
 *
 * Mirrors the web's `sentenceFromTokens` (apps/web/src/lib/server/texts/
 * sentences.ts): scan out from the tapped token to the nearest sentence-ending
 * punctuation on either side, then concatenate the surfaces. The server is the
 * source of truth for the *translated* sentence, but the reader derives the
 * source sentence locally so it can show context immediately (and so the danda
 * split is testable without a round-trip).
 */

/** Sentence-ending punctuation across the supported scripts: Devanagari
 *  danda/double-danda plus Western stops, ellipsis, and the danda's ASCII
 *  fallback isn't included (the reader stores the native glyphs). */
private val SENTENCE_END_CHARS = setOf('।', '॥', '.', '!', '?', '…')

private fun endsSentence(surface: String): Boolean =
    surface.any { it in SENTENCE_END_CHARS }

/**
 * The sentence containing the token at [tokenIdx]: the run from just after the
 * previous sentence-ender through the next one (inclusive), with surfaces
 * joined and whitespace collapsed. Returns "" when the token isn't present.
 */
fun sentenceFromTokens(tokens: List<ReaderToken>, tokenIdx: Int): String {
    val ordered = tokens.sortedBy { it.idx }
    val pos = ordered.indexOfFirst { it.idx == tokenIdx }
    if (pos == -1) return ""

    var start = pos
    while (start > 0 && !endsSentence(ordered[start - 1].surface)) start -= 1

    var end = pos
    while (end < ordered.lastIndex && !endsSentence(ordered[end].surface)) end += 1

    return ordered
        .subList(start, end + 1)
        .joinToString("") { it.surface }
        .replace(Regex("\\s+"), " ")
        .trim()
}
