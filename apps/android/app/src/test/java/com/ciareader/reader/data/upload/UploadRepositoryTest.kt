package com.ciareader.reader.data.upload

import com.ciareader.reader.core.network.Outcome
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

class UploadRepositoryTest {

    private fun repo(api: FakeUploadApi, rasterizer: PdfRasterizer = FakePdfRasterizer()) =
        UploadRepositoryImpl(api, rasterizer)

    @Test
    fun createTextSendsLanguageTitleBodyAndSourceTypeAndReturnsTextId() = runTest {
        val api = FakeUploadApi(
            textResponse = CreateTextResponseDto(
                text = createdText(id = "t1", title = "My Story"),
                chapterCount = 1,
            ),
        )

        val result = repo(api).createText(
            language = "hi",
            title = "My Story",
            body = "नमस्ते दुनिया",
            sourceType = TextSourceType.PASTE,
        )

        assertTrue(result is Outcome.Success)
        val import = (result as Outcome.Success).data
        assertTrue(import is ImportResult.Text)
        assertEquals("t1", (import as ImportResult.Text).textId)
        assertEquals("My Story", import.title)
        // The request carried the discriminator + fields the server expects.
        val sent = api.lastCreateRequest!!
        assertEquals("hi", sent.language)
        assertEquals("My Story", sent.title)
        assertEquals("नमस्ते दुनिया", sent.body)
        assertEquals("paste", sent.sourceType)
    }

    @Test
    fun createTextUsesTxtSourceTypeWire() = runTest {
        val api = FakeUploadApi(
            textResponse = CreateTextResponseDto(text = createdText("t2", "From File")),
        )
        repo(api).createText("mr", "From File", "मजकूर", TextSourceType.TXT)
        assertEquals("txt", api.lastCreateRequest!!.sourceType)
    }

    @Test
    fun createTextMapsHttpErrorToFailure() = runTest {
        val result = repo(FakeUploadApi(error = http(403)))
            .createText("hi", "t", "b", TextSourceType.PASTE)
        assertTrue(result is Outcome.Failure)
        assertEquals("You don't have access to that.", (result as Outcome.Failure).message)
    }

    @Test
    fun uploadEpubSendsMultipartPartsAndReturnsTextForSingleChapter() = runTest {
        val api = FakeUploadApi(
            epubResponse = EpubUploadResponseDto(
                kind = "text",
                text = createdText("e1", "Short Book"),
                chapterCount = 1,
            ),
        )

        val bytes = byteArrayOf(0x50, 0x4B, 0x03, 0x04) // ZIP/EPUB magic
        val result = repo(api).uploadEpub(
            language = "yi",
            title = "Short Book",
            fileName = "short.epub",
            bytes = bytes,
        )

        assertTrue(result is Outcome.Success)
        val import = (result as Outcome.Success).data
        assertTrue(import is ImportResult.Text)
        assertEquals("e1", (import as ImportResult.Text).textId)

        // Plain parts decode back to the language/title we passed.
        assertEquals("yi", api.lastLanguagePart.readPlainText())
        assertEquals("Short Book", api.lastTitlePart.readPlainText())
        // The file part carries the filename + the exact bytes.
        val filePart = api.lastFilePart!!
        assertEquals("short.epub", filePart.headers!!.value(0).filenameFromContentDisposition())
        assertTrue(bytes.contentEquals(filePart.body.readBytes()))
    }

    @Test
    fun uploadEpubReturnsCollectionForMultiChapterBook() = runTest {
        val api = FakeUploadApi(
            epubResponse = EpubUploadResponseDto(
                kind = "collection",
                collection = CreatedCollectionDto(id = "c9", language = "eu", title = "Big Book"),
                textCount = 12,
            ),
        )

        val result = repo(api).uploadEpub("eu", "Big Book", "big.epub", byteArrayOf(1, 2, 3))

        assertTrue(result is Outcome.Success)
        val import = (result as Outcome.Success).data
        assertTrue(import is ImportResult.Collection)
        import as ImportResult.Collection
        assertEquals("c9", import.collectionId)
        assertEquals(12, import.textCount)
        assertEquals("Big Book", import.title)
    }

    @Test
    fun uploadEpubCarriesFirstTextIdForACollection() = runTest {
        val api = FakeUploadApi(
            epubResponse = EpubUploadResponseDto(
                kind = "collection",
                collection = CreatedCollectionDto(id = "c9", language = "eu", title = "Big Book"),
                textCount = 12,
                firstTextId = "ch1",
            ),
        )
        val result = repo(api).uploadEpub("eu", "Big Book", "big.epub", byteArrayOf(1))
        val import = (result as Outcome.Success).data as ImportResult.Collection
        assertEquals("ch1", import.firstTextId)
    }

    @Test
    fun importPdfBeginsThenStreamsEachPageInOrderAndReturnsTheTextId() = runTest {
        val api = FakeUploadApi(pdfBeginResponse = PdfBeginResponseDto(id = "p1", pageCount = 3))
        val result = repo(api, FakePdfRasterizer(fileName = "scan.pdf", pages = 3))
            .importPdf("hi", "content://scan.pdf")

        assertTrue(result is Outcome.Success)
        val import = (result as Outcome.Success).data
        assertTrue(import is ImportResult.Text)
        assertEquals("p1", (import as ImportResult.Text).textId)
        assertEquals("scan", import.title) // file name sans .pdf
        assertEquals(3, api.lastPdfBegin!!.pageCount)
        assertEquals("hi", api.lastPdfBegin!!.language)
        assertEquals(listOf(0, 1, 2), api.uploadedPages)
    }

    @Test
    fun importPdfFailsClearlyForAnUnreadableFile() = runTest {
        val result = repo(FakeUploadApi(), ThrowingPdfRasterizer())
            .importPdf("hi", "content://broken.pdf")
        assertTrue(result is Outcome.Failure)
        assertEquals("Could not read that PDF.", (result as Outcome.Failure).message)
    }

    @Test
    fun uploadEpubMapsNetworkErrorToFailure() = runTest {
        val result = repo(FakeUploadApi(online = false))
            .uploadEpub("hi", "t", "f.epub", byteArrayOf(1))
        assertTrue(result is Outcome.Failure)
        assertEquals(
            "Network error — check your connection and try again.",
            (result as Outcome.Failure).message,
        )
    }

    private fun createdText(id: String, title: String) = CreatedTextDto(
        id = id,
        ownerId = "u1",
        language = "hi",
        title = title,
        sourceType = "paste",
        status = "ready",
        visibility = "private",
        createdAt = "2026-06-23T00:00:00Z",
    )

    private fun http(code: Int) =
        HttpException(Response.error<Any>(code, "e".toResponseBody("text/plain".toMediaType())))
}

/** Reads a plain RequestBody's UTF-8 content (for the language/title parts). */
private fun RequestBody.readPlainText(): String {
    val buffer = Buffer()
    writeTo(buffer)
    return buffer.readUtf8()
}

/** Reads a RequestBody's raw bytes (for the file part). */
private fun RequestBody.readBytes(): ByteArray {
    val buffer = Buffer()
    writeTo(buffer)
    return buffer.readByteArray()
}

/** Extracts the filename="…" value from a Content-Disposition header line. */
private fun String.filenameFromContentDisposition(): String =
    Regex("""filename="([^"]+)"""").find(this)?.groupValues?.get(1) ?: ""

private class FakeUploadApi(
    private val textResponse: CreateTextResponseDto? = null,
    private val epubResponse: EpubUploadResponseDto? = null,
    private val error: Throwable? = null,
    private val online: Boolean = true,
    private val pdfBeginResponse: PdfBeginResponseDto? = null,
) : UploadApi {
    var lastCreateRequest: CreateTextRequest? = null
    lateinit var lastLanguagePart: RequestBody
    lateinit var lastTitlePart: RequestBody
    var lastFilePart: MultipartBody.Part? = null
    var lastPdfBegin: PdfBeginRequest? = null
    val uploadedPages = mutableListOf<Int>()

    override suspend fun createText(body: CreateTextRequest): CreateTextResponseDto {
        lastCreateRequest = body
        if (!online) throw IOException("offline")
        error?.let { throw it }
        return textResponse!!
    }

    override suspend fun uploadEpub(
        language: RequestBody,
        title: RequestBody,
        file: MultipartBody.Part,
    ): EpubUploadResponseDto {
        lastLanguagePart = language
        lastTitlePart = title
        lastFilePart = file
        if (!online) throw IOException("offline")
        error?.let { throw it }
        return epubResponse!!
    }

    override suspend fun pdfBegin(body: PdfBeginRequest): PdfBeginResponseDto {
        lastPdfBegin = body
        if (!online) throw IOException("offline")
        error?.let { throw it }
        return pdfBeginResponse!!
    }

    override suspend fun uploadPage(
        textId: String,
        idx: Int,
        image: MultipartBody.Part,
        width: RequestBody,
        height: RequestBody,
    ): PageUploadResponseDto {
        uploadedPages += idx
        if (!online) throw IOException("offline")
        error?.let { throw it }
        return PageUploadResponseDto(complete = idx == (lastPdfBegin?.pageCount ?: 0) - 1)
    }
}

/** Renders [pages] dummy JPEG pages; the upload repo streams them via the API. */
private class FakePdfRasterizer(
    private val fileName: String = "doc.pdf",
    private val pages: Int = 2,
) : PdfRasterizer {
    override suspend fun open(uriString: String): PdfPages = object : PdfPages {
        override val fileName = this@FakePdfRasterizer.fileName
        override val pageCount = pages
        override suspend fun render(index: Int) = RenderedPage(
            bytes = byteArrayOf(index.toByte()),
            width = 100,
            height = 200,
            mime = "image/jpeg",
        )
        override fun close() {}
    }
}

/** A rasterizer that fails to open — stands in for a corrupt / non-PDF file. */
private class ThrowingPdfRasterizer : PdfRasterizer {
    override suspend fun open(uriString: String): PdfPages = throw IOException("nope")
}
