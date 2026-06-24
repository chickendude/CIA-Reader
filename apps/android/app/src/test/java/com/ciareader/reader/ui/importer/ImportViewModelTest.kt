package com.ciareader.reader.ui.importer

import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.data.upload.DocumentReader
import com.ciareader.reader.data.upload.ImportResult
import com.ciareader.reader.data.upload.PickedDocument
import com.ciareader.reader.data.upload.PickedDocumentText
import com.ciareader.reader.data.upload.TextSourceType
import com.ciareader.reader.data.upload.UploadRepository
import com.ciareader.reader.util.MainDispatcherRule
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class ImportViewModelTest {

    @get:Rule
    val mainRule = MainDispatcherRule()

    private fun vm(
        repo: UploadRepository = FakeUploadRepository(),
        reader: DocumentReader = FakeDocumentReader(),
    ) = ImportViewModel(repo, reader)

    @Test
    fun submitPasteTrimsAndCreatesText() = runTest(mainRule.dispatcher) {
        val repo = FakeUploadRepository(
            textResult = ImportResult.Text("t1", "Hello"),
        )
        val vm = vm(repo)

        vm.submitPaste(language = "hi", title = "  Hello  ", body = "  body text  ")
        advanceUntilIdle()

        assertEquals("hi", repo.lastCreate?.language)
        assertEquals("Hello", repo.lastCreate?.title) // trimmed
        assertEquals("body text", repo.lastCreate?.body) // trimmed
        assertEquals(TextSourceType.PASTE, repo.lastCreate?.sourceType)
        assertEquals(ImportResult.Text("t1", "Hello"), vm.state.value.result)
        assertFalse(vm.state.value.isSubmitting)
        assertNull(vm.state.value.errorMessage)
    }

    @Test
    fun submitPasteRejectsBlankTitleOrBodyWithoutCallingRepo() = runTest(mainRule.dispatcher) {
        val repo = FakeUploadRepository()
        val vm = vm(repo)

        vm.submitPaste(language = "hi", title = "   ", body = "text")
        advanceUntilIdle()

        assertNull(repo.lastCreate)
        assertEquals("Enter a title and some text.", vm.state.value.errorMessage)
        assertNull(vm.state.value.result)
    }

    @Test
    fun importTxtReadsFileDerivesTitleAndCreatesText() = runTest(mainRule.dispatcher) {
        val repo = FakeUploadRepository(textResult = ImportResult.Text("t2", "story"))
        val reader = FakeDocumentReader(
            text = PickedDocumentText(fileName = "story.txt", text = "  once upon a time  "),
        )
        val vm = vm(repo, reader)

        vm.importTxt(language = "mr", uriString = "content://docs/1")
        advanceUntilIdle()

        assertEquals("mr", repo.lastCreate?.language)
        assertEquals("story", repo.lastCreate?.title) // .txt stripped from filename
        assertEquals("once upon a time", repo.lastCreate?.body) // trimmed
        assertEquals(TextSourceType.TXT, repo.lastCreate?.sourceType)
        assertEquals(ImportResult.Text("t2", "story"), vm.state.value.result)
    }

    @Test
    fun importTxtFailsOnEmptyFileWithoutCallingRepo() = runTest(mainRule.dispatcher) {
        val repo = FakeUploadRepository()
        val reader = FakeDocumentReader(
            text = PickedDocumentText(fileName = "empty.txt", text = "   "),
        )
        val vm = vm(repo, reader)

        vm.importTxt("hi", "content://docs/2")
        advanceUntilIdle()

        assertNull(repo.lastCreate)
        assertEquals("That file is empty.", vm.state.value.errorMessage)
    }

    @Test
    fun importTxtMapsReadFailureToError() = runTest(mainRule.dispatcher) {
        val reader = FakeDocumentReader(throwOnRead = true)
        val vm = vm(reader = reader)

        vm.importTxt("hi", "content://docs/3")
        advanceUntilIdle()

        assertEquals("Could not read the selected file.", vm.state.value.errorMessage)
        assertFalse(vm.state.value.isSubmitting)
    }

    @Test
    fun importEpubReadsBytesDerivesTitleAndUploads() = runTest(mainRule.dispatcher) {
        val repo = FakeUploadRepository(
            epubResult = ImportResult.Collection("c1", "Big Book", 10),
        )
        val bytes = byteArrayOf(1, 2, 3)
        val reader = FakeDocumentReader(
            doc = PickedDocument(fileName = "big book.epub", bytes = bytes),
        )
        val vm = vm(repo, reader)

        vm.importEpub(language = "eu", uriString = "content://docs/4")
        advanceUntilIdle()

        assertEquals("eu", repo.lastEpub?.language)
        assertEquals("big book", repo.lastEpub?.title) // .epub stripped
        assertEquals("big book.epub", repo.lastEpub?.fileName) // original name kept
        assertTrue(bytes.contentEquals(repo.lastEpub?.bytes))
        assertEquals(ImportResult.Collection("c1", "Big Book", 10), vm.state.value.result)
    }

    @Test
    fun repoFailureSurfacesErrorAndKeepsNoResult() = runTest(mainRule.dispatcher) {
        val repo = FakeUploadRepository(failure = "Daily text upload limit reached. Try again tomorrow.")
        val vm = vm(repo)

        vm.submitPaste("hi", "T", "B")
        advanceUntilIdle()

        assertEquals("Daily text upload limit reached. Try again tomorrow.", vm.state.value.errorMessage)
        assertNull(vm.state.value.result)
        assertFalse(vm.state.value.isSubmitting)
    }

    @Test
    fun consumeResultClearsTheResult() = runTest(mainRule.dispatcher) {
        val vm = vm(FakeUploadRepository(textResult = ImportResult.Text("t1", "x")))
        vm.submitPaste("hi", "x", "y")
        advanceUntilIdle()
        assertEquals(ImportResult.Text("t1", "x"), vm.state.value.result)

        vm.consumeResult()
        assertNull(vm.state.value.result)
    }

    @Test
    fun clearErrorClearsTheError() = runTest(mainRule.dispatcher) {
        val vm = vm(FakeUploadRepository(failure = "boom"))
        vm.submitPaste("hi", "x", "y")
        advanceUntilIdle()
        assertEquals("boom", vm.state.value.errorMessage)

        vm.clearError()
        assertNull(vm.state.value.errorMessage)
    }
}

private data class CreateArgs(
    val language: String,
    val title: String,
    val body: String,
    val sourceType: TextSourceType,
)

private data class EpubArgs(
    val language: String,
    val title: String,
    val fileName: String,
    val bytes: ByteArray,
)

private class FakeUploadRepository(
    private val textResult: ImportResult = ImportResult.Text("t", "Title"),
    private val epubResult: ImportResult = ImportResult.Text("e", "Title"),
    private val failure: String? = null,
) : UploadRepository {
    var lastCreate: CreateArgs? = null
    var lastEpub: EpubArgs? = null

    override suspend fun createText(
        language: String,
        title: String,
        body: String,
        sourceType: TextSourceType,
    ): Outcome<ImportResult> {
        lastCreate = CreateArgs(language, title, body, sourceType)
        return failure?.let { Outcome.Failure(it) } ?: Outcome.Success(textResult)
    }

    override suspend fun uploadEpub(
        language: String,
        title: String,
        fileName: String,
        bytes: ByteArray,
    ): Outcome<ImportResult> {
        lastEpub = EpubArgs(language, title, fileName, bytes)
        return failure?.let { Outcome.Failure(it) } ?: Outcome.Success(epubResult)
    }
}

private class FakeDocumentReader(
    private val doc: PickedDocument = PickedDocument("f.epub", ByteArray(0)),
    private val text: PickedDocumentText = PickedDocumentText("f.txt", ""),
    private val throwOnRead: Boolean = false,
) : DocumentReader {
    override suspend fun read(uriString: String): PickedDocument {
        if (throwOnRead) throw IOException("unreadable")
        return doc
    }

    override suspend fun readText(uriString: String): PickedDocumentText {
        if (throwOnRead) throw IOException("unreadable")
        return text
    }
}
