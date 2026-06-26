package com.ciareader.reader.data.reader

import org.junit.Assert.assertEquals
import org.junit.Test

class SentencesTest {

    private fun tok(idx: Int, surface: String) =
        ReaderToken(idx, surface, isWord = surface.any { it.isLetter() }, status = KnownStatus.UNKNOWN, lemmaId = null, romanization = null, glossDefault = null, isOov = false, isAmbiguous = false, hasDefinition = false)

    @Test
    fun splitsOnDevanagariDanda() {
        val tokens = listOf(
            tok(0, "पहला"), tok(1, " "), tok(2, "वाक्य"), tok(3, "।"),
            tok(4, " "), tok(5, "दूसरा"), tok(6, " "), tok(7, "वाक्य"), tok(8, "।"),
        )
        // A token in the second sentence yields only that sentence (with its danda).
        assertEquals("दूसरा वाक्य।", sentenceFromTokens(tokens, 5))
    }

    @Test
    fun splitsOnDoubleDanda() {
        val tokens = listOf(
            tok(0, "श्लोक"), tok(1, "॥"), tok(2, " "), tok(3, "अगला"), tok(4, "।"),
        )
        assertEquals("श्लोक॥", sentenceFromTokens(tokens, 0))
    }

    @Test
    fun splitsOnWesternPunctuation() {
        val tokens = listOf(
            tok(0, "Hello"), tok(1, " "), tok(2, "world"), tok(3, "!"),
            tok(4, " "), tok(5, "Bye"), tok(6, "."),
        )
        assertEquals("Hello world!", sentenceFromTokens(tokens, 0))
        assertEquals("Bye.", sentenceFromTokens(tokens, 5))
    }

    @Test
    fun firstSentenceHasNoLeadingTrim() {
        val tokens = listOf(tok(0, "Solo"), tok(1, "?"))
        assertEquals("Solo?", sentenceFromTokens(tokens, 0))
    }

    @Test
    fun unterminatedSentenceRunsToEnd() {
        val tokens = listOf(tok(0, "no"), tok(1, " "), tok(2, "end"))
        assertEquals("no end", sentenceFromTokens(tokens, 2))
    }

    @Test
    fun missingTokenReturnsEmpty() {
        assertEquals("", sentenceFromTokens(listOf(tok(0, "a")), tokenIdx = 99))
    }

    @Test
    fun collapsesWhitespace() {
        val tokens = listOf(tok(0, "a"), tok(1, "   "), tok(2, "b"), tok(3, "."))
        assertEquals("a b.", sentenceFromTokens(tokens, 0))
    }
}
