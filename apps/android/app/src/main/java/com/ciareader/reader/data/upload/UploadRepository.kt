package com.ciareader.reader.data.upload

import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.core.network.apiCall
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Outcome of a successful import: where the library should send the user. A
 * single `.txt`/paste or single-chapter EPUB resolves to a text id; a
 * multi-chapter EPUB resolves to a collection id.
 */
sealed interface ImportResult {
    val title: String

    data class Text(val textId: String, override val title: String) : ImportResult
    data class Collection(
        val collectionId: String,
        override val title: String,
        val textCount: Int,
    ) : ImportResult
}

interface UploadRepository {
    /** Create a text from pasted or `.txt` content. */
    suspend fun createText(
        language: String,
        title: String,
        body: String,
        sourceType: TextSourceType,
    ): Outcome<ImportResult>

    /** Upload an `.epub` file's raw bytes as a multipart request. */
    suspend fun uploadEpub(
        language: String,
        title: String,
        fileName: String,
        bytes: ByteArray,
    ): Outcome<ImportResult>
}

/** Discriminates the create-text path; maps to the server's `sourceType`. */
enum class TextSourceType(val wire: String) {
    PASTE("paste"),
    TXT("txt"),
}

@Singleton
class UploadRepositoryImpl @Inject constructor(
    private val api: UploadApi,
) : UploadRepository {

    override suspend fun createText(
        language: String,
        title: String,
        body: String,
        sourceType: TextSourceType,
    ): Outcome<ImportResult> = apiCall {
        val res = api.createText(
            CreateTextRequest(
                language = language,
                title = title,
                body = body,
                sourceType = sourceType.wire,
            ),
        )
        ImportResult.Text(textId = res.text.id, title = res.text.title)
    }

    override suspend fun uploadEpub(
        language: String,
        title: String,
        fileName: String,
        bytes: ByteArray,
    ): Outcome<ImportResult> = apiCall {
        val filePart = MultipartBody.Part.createFormData(
            name = "file",
            filename = fileName,
            body = bytes.toRequestBody(EPUB_MEDIA_TYPE),
        )
        val res = api.uploadEpub(
            language = language.toPlainPart(),
            title = title.toPlainPart(),
            file = filePart,
        )
        if (res.kind == "collection" && res.collection != null) {
            ImportResult.Collection(
                collectionId = res.collection.id,
                title = res.collection.title,
                textCount = res.textCount ?: 0,
            )
        } else {
            // Single-chapter EPUB (or any shape carrying a text) → open the text.
            val text = res.text
                ?: error("EPUB upload returned no text or collection")
            ImportResult.Text(textId = text.id, title = text.title)
        }
    }

    private fun String.toPlainPart(): RequestBody = toRequestBody(TEXT_MEDIA_TYPE)

    private companion object {
        val EPUB_MEDIA_TYPE = "application/epub+zip".toMediaType()
        val TEXT_MEDIA_TYPE = "text/plain".toMediaType()
    }
}
