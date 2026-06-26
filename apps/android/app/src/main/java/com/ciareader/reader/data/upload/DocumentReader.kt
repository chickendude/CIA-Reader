package com.ciareader.reader.data.upload

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** A document picked via the Storage Access Framework, resolved to its bytes. */
data class PickedDocument(
    val fileName: String,
    val bytes: ByteArray,
) {
    // ByteArray needs structural equality for value-class semantics in tests.
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is PickedDocument) return false
        return fileName == other.fileName && bytes.contentEquals(other.bytes)
    }

    override fun hashCode(): Int = 31 * fileName.hashCode() + bytes.contentHashCode()
}

/**
 * Resolves a SAF `content://` URI to its display name + bytes. Abstracted behind
 * an interface so the import ViewModel stays pure-JVM testable — the Android
 * impl reads through [ContentResolver]; tests inject a fake.
 */
interface DocumentReader {
    /** Read the document at [uriString]; throws [IOException] if unreadable. */
    suspend fun read(uriString: String): PickedDocument

    /** Read just the document's text content (UTF-8), for `.txt` import. */
    suspend fun readText(uriString: String): PickedDocumentText
}

/** A picked text document: its display name + decoded UTF-8 content. */
data class PickedDocumentText(
    val fileName: String,
    val text: String,
)

@Singleton
class ContentResolverDocumentReader @Inject constructor(
    @ApplicationContext private val context: android.content.Context,
) : DocumentReader {

    override suspend fun read(uriString: String): PickedDocument = withContext(Dispatchers.IO) {
        val uri = Uri.parse(uriString)
        val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            ?: throw IOException("Could not open the selected file.")
        PickedDocument(fileName = displayName(uri), bytes = bytes)
    }

    override suspend fun readText(uriString: String): PickedDocumentText = withContext(Dispatchers.IO) {
        val uri = Uri.parse(uriString)
        val text = context.contentResolver.openInputStream(uri)?.use {
            it.readBytes().toString(Charsets.UTF_8)
        } ?: throw IOException("Could not open the selected file.")
        PickedDocumentText(fileName = displayName(uri), text = text)
    }

    /** The user-facing file name from the provider, falling back to the URI tail. */
    private fun displayName(uri: Uri): String {
        context.contentResolver
            .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) {
                        cursor.getString(idx)?.takeIf { it.isNotBlank() }?.let { return it }
                    }
                }
            }
        return uri.lastPathSegment?.substringAfterLast('/') ?: "document"
    }
}
