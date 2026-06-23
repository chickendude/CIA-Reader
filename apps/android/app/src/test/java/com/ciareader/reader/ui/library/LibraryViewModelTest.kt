package com.ciareader.reader.ui.library

import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.core.settings.SettingsStore
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
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
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

    private fun vm(
        langRepo: LanguageRepository,
        libRepo: LibraryRepository = FakeLibraryRepository(),
        collRepo: CollectionRepository = FakeCollectionRepository(),
        settings: SettingsStore = FakeSettingsStore(),
    ) = LibraryViewModel(langRepo, libRepo, collRepo, settings)

    @Test
    fun showsOnlyAddedLanguagesAndDefaultsToTheFirstAdded() = runTest(mainRule.dispatcher) {
        // The endpoint returns every supported language; the not-added ones come
        // back isDefault=true. The user added hi + eu. Before the fix the VM
        // selected the first isDefault language (mr) — a language they don't have.
        val langRepo = FakeLanguageRepository(
            listOf(
                lang("hi"),
                lang("mr", isDefault = true),
                lang("or", isDefault = true),
                lang("yi", isDefault = true),
                lang("eu"),
            ),
        )
        val libRepo = FakeLibraryRepository(byLanguage = mapOf("hi" to listOf(card("t1"))))
        val collRepo = FakeCollectionRepository(all = listOf(collection("c1", "hi")))

        val vm = vm(langRepo, libRepo, collRepo)
        advanceUntilIdle()

        val s = vm.state.value
        assertEquals(listOf("hi", "eu"), s.languages.map { it.code }) // mr/or/yi filtered out
        assertEquals("hi", s.currentLanguage) // first added, NOT mr
        assertEquals(listOf("t1"), s.texts.map { it.id })
        assertEquals(listOf("c1"), s.collections.map { it.id })
        assertFalse(s.isLoading)
        assertNull(s.errorMessage)
    }

    @Test
    fun restoresThePersistedLanguage() = runTest(mainRule.dispatcher) {
        val langRepo = FakeLanguageRepository(listOf(lang("hi"), lang("eu")))
        val libRepo = FakeLibraryRepository(byLanguage = mapOf("eu" to listOf(card("b1"))))

        val vm = vm(langRepo, libRepo, settings = FakeSettingsStore("eu"))
        advanceUntilIdle()

        assertEquals("eu", vm.state.value.currentLanguage) // restored, not first-added "hi"
        assertEquals(listOf("b1"), vm.state.value.texts.map { it.id })
    }

    @Test
    fun ignoresAPersistedLanguageNoLongerAdded() = runTest(mainRule.dispatcher) {
        val langRepo = FakeLanguageRepository(listOf(lang("hi"), lang("eu")))
        // "or" was removed from the account since it was last selected.
        val vm = vm(langRepo, settings = FakeSettingsStore("or"))
        advanceUntilIdle()

        assertEquals("hi", vm.state.value.currentLanguage)
    }

    @Test
    fun fallsBackToAllWhenNoLanguagesAreAdded() = runTest(mainRule.dispatcher) {
        // Fresh account: nothing added, so every language is isDefault=true.
        val langRepo = FakeLanguageRepository(listOf(lang("hi", isDefault = true), lang("mr", isDefault = true)))
        val vm = vm(langRepo)
        advanceUntilIdle()

        assertEquals(listOf("hi", "mr"), vm.state.value.languages.map { it.code })
        assertEquals("hi", vm.state.value.currentLanguage)
    }

    @Test
    fun languageFailureSurfacesError() = runTest(mainRule.dispatcher) {
        val vm = vm(FakeLanguageRepository(error = "boom"))
        advanceUntilIdle()

        assertEquals("boom", vm.state.value.errorMessage)
        assertFalse(vm.state.value.isLoading)
    }

    @Test
    fun collectionsFailureIsNonFatal() = runTest(mainRule.dispatcher) {
        val vm = vm(
            FakeLanguageRepository(listOf(lang("hi"))),
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
    fun selectLanguageLoadsThatLanguageAndPersistsLocallyAndServer() = runTest(mainRule.dispatcher) {
        val langRepo = FakeLanguageRepository(listOf(lang("hi"), lang("eu")))
        val libRepo = FakeLibraryRepository(
            byLanguage = mapOf("hi" to listOf(card("h1")), "eu" to listOf(card("e1"), card("e2"))),
        )
        val collRepo = FakeCollectionRepository(all = listOf(collection("ch", "hi"), collection("ce", "eu")))
        val settings = FakeSettingsStore()
        val vm = vm(langRepo, libRepo, collRepo, settings)
        advanceUntilIdle()

        vm.selectLanguage("eu")
        advanceUntilIdle()

        assertEquals("eu", vm.state.value.currentLanguage)
        assertEquals(listOf("e1", "e2"), vm.state.value.texts.map { it.id })
        assertEquals(listOf("ce"), vm.state.value.collections.map { it.id })
        assertEquals("eu", langRepo.lastSetCode)
        assertEquals("eu", settings.currentLanguage()) // remembered for next launch
    }

    @Test
    fun refreshCurrentLanguageReloadsCollectionOpenTextId() = runTest(mainRule.dispatcher) {
        val langRepo = FakeLanguageRepository(listOf(lang("hi")))
        val collRepo = FakeCollectionRepository(
            all = listOf(collection("book", "hi", openTextId = "chapter-5")),
        )
        val vm = vm(
            langRepo,
            FakeLibraryRepository(byLanguage = mapOf("hi" to emptyList())),
            collRepo,
        )
        advanceUntilIdle()
        assertEquals("chapter-5", vm.state.value.collections.single().openTextId)

        collRepo.all = listOf(collection("book", "hi", openTextId = "chapter-4"))
        vm.refreshCurrentLanguage()
        advanceUntilIdle()

        assertEquals("chapter-4", vm.state.value.collections.single().openTextId)
    }

    @Test
    fun showsCachedLibraryAtLaunchWhenNetworkUnavailable() = runTest(mainRule.dispatcher) {
        // Cold/offline launch: the language fetch fails, but cache has content.
        val langRepo = FakeLanguageRepository(error = "offline", cached = listOf(lang("hi"), lang("eu")))
        val libRepo = FakeLibraryRepository(cachedByLanguage = mapOf("hi" to listOf(card("t1"))))
        val collRepo = FakeCollectionRepository(cached = listOf(collection("c1", "hi")))

        val vm = vm(langRepo, libRepo, collRepo)
        advanceUntilIdle()

        val s = vm.state.value
        assertEquals(listOf("hi", "eu"), s.languages.map { it.code })
        assertEquals("hi", s.currentLanguage)
        assertEquals(listOf("t1"), s.texts.map { it.id })
        assertEquals(listOf("c1"), s.collections.map { it.id })
        assertFalse(s.isLoading)
        assertNull(s.errorMessage) // cached view shown, so the failed refresh is silent
    }

    @Test
    fun networkRefreshReplacesCachedContent() = runTest(mainRule.dispatcher) {
        val langRepo = FakeLanguageRepository(languages = listOf(lang("hi")), cached = listOf(lang("hi")))
        val libRepo = FakeLibraryRepository(
            byLanguage = mapOf("hi" to listOf(card("fresh"))),
            cachedByLanguage = mapOf("hi" to listOf(card("stale"))),
        )

        val vm = vm(langRepo, libRepo)
        advanceUntilIdle()

        // After the background refresh, the fresh network listing wins.
        assertEquals(listOf("fresh"), vm.state.value.texts.map { it.id })
    }

    private fun lang(code: String, isDefault: Boolean = false) =
        Language(code = code, displayName = code.uppercase(), nativeName = code, script = "Deva", isDefault = isDefault)

    private fun card(id: String) = TextCard(id = id, title = "Title $id", language = "hi", status = "ready")

    private fun collection(id: String, language: String, openTextId: String? = null) =
        CollectionSummary(
            id = id,
            title = "Book $id",
            language = language,
            kind = "chapter_book",
            textCount = 1,
            openTextId = openTextId,
        )
}

private class FakeLanguageRepository(
    private val languages: List<Language> = emptyList(),
    private val error: String? = null,
    private val cached: List<Language> = emptyList(),
) : LanguageRepository {
    var lastSetCode: String? = null
    override suspend fun myLanguages(): Outcome<List<Language>> =
        error?.let { Outcome.Failure(it) } ?: Outcome.Success(languages)

    override suspend fun setCurrent(code: String): Outcome<String> {
        lastSetCode = code
        return Outcome.Success(code)
    }

    override suspend fun cachedLanguages(): List<Language> = cached
}

private class FakeLibraryRepository(
    private val byLanguage: Map<String, List<TextCard>> = emptyMap(),
    private val error: String? = null,
    private val cachedByLanguage: Map<String, List<TextCard>> = emptyMap(),
) : LibraryRepository {
    override suspend fun listTexts(scope: LibraryScope, language: String): Outcome<List<TextCard>> =
        error?.let { Outcome.Failure(it) } ?: Outcome.Success(byLanguage[language] ?: emptyList())

    override suspend fun cachedTexts(scope: LibraryScope, language: String): List<TextCard> =
        cachedByLanguage[language] ?: emptyList()
}

private class FakeCollectionRepository(
    var all: List<CollectionSummary> = emptyList(),
    private val error: String? = null,
    private val cached: List<CollectionSummary> = emptyList(),
) : CollectionRepository {
    override suspend fun myCollections(): Outcome<List<CollectionSummary>> =
        error?.let { Outcome.Failure(it) } ?: Outcome.Success(all)

    override suspend fun detail(collectionId: String): Outcome<CollectionDetail> =
        Outcome.Failure("not used in these tests")

    override suspend fun cachedCollections(): List<CollectionSummary> = cached
}

private class FakeSettingsStore(initial: String? = null) : SettingsStore {
    private val state = MutableStateFlow(initial)
    override val currentLanguage: Flow<String?> = state
    override suspend fun currentLanguage(): String? = state.value
    override suspend fun setCurrentLanguage(code: String) {
        state.value = code
    }

    private var romanize = false
    override suspend fun showRomanization(): Boolean = romanize
    override suspend fun setShowRomanization(value: Boolean) {
        romanize = value
    }

    private var pageMode = false
    override suspend fun pageMode(): Boolean = pageMode
    override suspend fun setPageMode(value: Boolean) {
        pageMode = value
    }

    private var fontSize = 18
    override suspend fun fontSizeSp(): Int = fontSize
    override suspend fun setFontSizeSp(value: Int) {
        fontSize = value
    }

    private var lineSpacing = 1.5f
    override suspend fun lineSpacing(): Float = lineSpacing
    override suspend fun setLineSpacing(value: Float) {
        lineSpacing = value
    }
}
