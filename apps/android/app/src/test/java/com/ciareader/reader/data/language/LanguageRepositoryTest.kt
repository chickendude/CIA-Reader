package com.ciareader.reader.data.language

import com.ciareader.reader.core.network.Outcome
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LanguageRepositoryTest {

    @Test
    fun mapsLanguagesAndDetectsRtl() = runTest {
        val api = FakeLanguagesApi(
            languages = listOf(
                lang("hi", "Hindi", "हिन्दी", "Deva", isDefault = true),
                lang("yi", "Yiddish", "ייִדיש", "Hebr"),
            ),
        )
        val repo = LanguageRepositoryImpl(api)

        val result = repo.myLanguages()

        assertTrue(result is Outcome.Success)
        val langs = (result as Outcome.Success).data
        assertEquals(listOf("hi", "yi"), langs.map { it.code })
        assertFalse(langs[0].isRtl)   // Devanagari
        assertTrue(langs[1].isRtl)    // Hebrew
        assertTrue(langs[0].isDefault)
    }

    @Test
    fun setCurrentReturnsConfirmedCode() = runTest {
        val api = FakeLanguagesApi(languages = emptyList())
        val repo = LanguageRepositoryImpl(api)

        val result = repo.setCurrent("mr")

        assertTrue(result is Outcome.Success)
        assertEquals("mr", (result as Outcome.Success).data)
        assertEquals("mr", api.lastSetCode)
    }

    private fun lang(
        code: String,
        displayName: String,
        nativeName: String,
        script: String,
        isDefault: Boolean = false,
    ) = LanguageDto(
        code = code,
        displayName = displayName,
        nativeName = nativeName,
        script = script,
        isDefault = isDefault,
    )
}

private class FakeLanguagesApi(
    private val languages: List<LanguageDto>,
) : LanguagesApi {
    var lastSetCode: String? = null
    override suspend fun myLanguages() = LanguagesResponseDto(languages)
    override suspend fun setLanguage(body: SetLanguageRequest): SetLanguageResponseDto {
        lastSetCode = body.code
        return SetLanguageResponseDto(body.code)
    }
}
