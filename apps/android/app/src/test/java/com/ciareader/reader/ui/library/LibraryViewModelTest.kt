package com.ciareader.reader.ui.library

import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.data.collection.CollectionDetail
import com.ciareader.reader.data.collection.CollectionRepository
import com.ciareader.reader.data.collection.CollectionSummary
import com.ciareader.reader.data.language.Language
import com.ciareader.reader.data.language.LanguageRepository
import com.ciareader.reader.data.library.LibraryRepository
import com.ciareader.reader.data.library.LibraryScope
import com.ciareader.reader.data.library.TextCard
import com.ciareader.reader.util.MainDispatcherRule
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LibraryViewModelTest {

    @get:Rule
    val mainRule = MainDispatcherRule()

    @Test
    fun loadsTextsAndCollectionsForDefaultLanguage() = runTest(mainRule.dispatcher) {
        val langRepo = FakeLanguageRepository(listOf(lang("hi", isDefault = true), lang("yi")))
        val libRepo = FakeLibraryRepository(byLanguage = mapOf("hi" to listOf(card("t1"))))
        val collRepo = FakeCollectionRepository(all = listOf(collection("c1", "hi"), collection("c2", "yi")))

        val vm = LibraryViewModel(langRepo, libRepo, collRepo)
        advanceUntilIdle()

        val s = vm.state.value
        assertEquals(listOf("hi", "yi"), s.languages.map { it.code })
        assertEquals("hi", s.currentLanguage)
        assertEquals(listOf("t1"), s.texts.map { it.id })
        // Collections filtered to the current language.
        assertEquals(listOf("c1"), s.collections.map { it.id })
        assertFalse(s.isLoading)
        assertNull(s.errorMessage)
    }

    @Test
    fun languageFailureSurfacesError() = runTest(mainRule.dispatcher) {
        val vm = LibraryViewModel(
            FakeLanguageRepository(error = "boom"),
            FakeLibraryRepository(),
            FakeCollectionRepository(),
        )
        advanceUntilIdle()

        assertEquals("boom", vm.state.value.errorMessage)
        assertFalse(vm.state.value.isLoading)
    }

    @Test
    fun collectionsFailureIsNonFatal() = runTest(mainRule.dispatcher) {
        val vm = LibraryViewModel(
            FakeLanguageRepository(listOf(lang("hi", isDefault = true))),
            FakeLibraryRepository(byLanguage = mapOf("hi" to listOf(card("t1")))),
            FakeCollectionRepository(error = "collections down"),
        )
        advanceUntilIdle()

        val s = vm.state.value
        assertEquals(listOf("t1"), s.texts.map { it.id })
        assertEquals(emptyList<String>(), s.collections.map { it.id })
        assertNull(s.errorMessage) // texts still load
    }

    @Test
    fun selectLanguageLoadsThatLanguageAndPersists() = runTest(mainRule.dispatcher) {
        val langRepo = FakeLanguageRepository(listOf(lang("hi", isDefault = true), lang("mr")))
        val libRepo = FakeLibraryRepository(
            byLanguage = mapOf("hi" to listOf(card("h1")), "mr" to listOf(card("m1"), card("m2"))),
        )
        val collRepo = FakeCollectionRepository(all = listOf(collection("ch", "hi"), collection("cm", "mr")))
        val vm = LibraryViewModel(langRepo, libRepo, collRepo)
        advanceUntilIdle()

        vm.selectLanguage("mr")
        advanceUntilIdle()

        assertEquals("mr", vm.state.value.currentLanguage)
        assertEquals(listOf("m1", "m2"), vm.state.value.texts.map { it.id })
        assertEquals(listOf("cm"), vm.state.value.collections.map { it.id })
        assertEquals("mr", langRepo.lastSetCode)
    }

    private fun lang(code: String, isDefault: Boolean = false) =
        Language(code = code, displayName = code.uppercase(), nativeName = code, script = "Deva", isDefault = isDefault)

    private fun card(id: String) = TextCard(id = id, title = "Title $id", language = "hi", status = "ready")

    private fun collection(id: String, language: String) =
        CollectionSummary(id = id, title = "Book $id", language = language, kind = "chapter_book", textCount = 1)
}

private class FakeLanguageRepository(
    private val languages: List<Language> = emptyList(),
    private val error: String? = null,
) : LanguageRepository {
    var lastSetCode: String? = null
    override suspend fun myLanguages(): Outcome<List<Language>> =
        error?.let { Outcome.Failure(it) } ?: Outcome.Success(languages)

    override suspend fun setCurrent(code: String): Outcome<String> {
        lastSetCode = code
        return Outcome.Success(code)
    }
}

private class FakeLibraryRepository(
    private val byLanguage: Map<String, List<TextCard>> = emptyMap(),
    private val error: String? = null,
) : LibraryRepository {
    override suspend fun listTexts(scope: LibraryScope, language: String): Outcome<List<TextCard>> =
        error?.let { Outcome.Failure(it) } ?: Outcome.Success(byLanguage[language] ?: emptyList())
}

private class FakeCollectionRepository(
    private val all: List<CollectionSummary> = emptyList(),
    private val error: String? = null,
) : CollectionRepository {
    override suspend fun myCollections(): Outcome<List<CollectionSummary>> =
        error?.let { Outcome.Failure(it) } ?: Outcome.Success(all)

    override suspend fun detail(collectionId: String): Outcome<CollectionDetail> =
        Outcome.Failure("not used in these tests")
}
