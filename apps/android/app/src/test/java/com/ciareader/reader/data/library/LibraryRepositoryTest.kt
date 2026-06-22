package com.ciareader.reader.data.library

import com.ciareader.reader.core.network.Outcome
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class LibraryRepositoryTest {

    @Test
    fun mapsCardsToDomainAndFlagsReadiness() = runTest {
        val api = FakeLibraryApi(
            page = LibraryPageDto(
                cards = listOf(
                    card("t1", status = "ready"),
                    card("t2", status = "processing"),
                ),
                totalCount = 2,
            ),
        )
        val repo = LibraryRepositoryImpl(api)

        val result = repo.listTexts(LibraryScope.OWNED, "hi")

        assertTrue(result is Outcome.Success)
        val cards = (result as Outcome.Success).data
        assertEquals(listOf("t1", "t2"), cards.map { it.id })
        assertTrue(cards[0].isReady)
        assertFalse(cards[1].isReady)
        assertEquals("owned" to "hi", api.lastScope to api.lastLanguage)
    }

    @Test
    fun mapsHttpErrorToFailure() = runTest {
        val repo = LibraryRepositoryImpl(FakeLibraryApi(error = http(403)))
        val result = repo.listTexts(LibraryScope.OFFICIAL, "yi")
        assertTrue(result is Outcome.Failure)
        assertEquals("You don't have access to that.", (result as Outcome.Failure).message)
    }

    private fun card(id: String, status: String) = TextCardDto(
        id = id,
        title = "Title $id",
        language = "hi",
        sourceType = "paste",
        status = status,
        visibility = "private",
        createdAt = "2026-06-21T00:00:00Z",
    )

    private fun http(code: Int) =
        HttpException(Response.error<Any>(code, "e".toResponseBody("text/plain".toMediaType())))
}

private class FakeLibraryApi(
    private val page: LibraryPageDto? = null,
    private val error: Throwable? = null,
) : LibraryApi {
    var lastScope: String? = null
    var lastLanguage: String? = null
    override suspend fun listTexts(
        scope: String,
        language: String,
        limit: Int?,
        offset: Int?,
    ): LibraryPageDto {
        lastScope = scope
        lastLanguage = language
        error?.let { throw it }
        return page!!
    }
}
