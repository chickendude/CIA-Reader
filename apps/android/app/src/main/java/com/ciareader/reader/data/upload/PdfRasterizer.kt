package com.ciareader.reader.data.upload

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** One rasterized PDF page: encoded image bytes (+ mime) and pixel dimensions. */
data class RenderedPage(
    val bytes: ByteArray,
    val width: Int,
    val height: Int,
    val mime: String,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is RenderedPage) return false
        return width == other.width && height == other.height &&
            mime == other.mime && bytes.contentEquals(other.bytes)
    }

    override fun hashCode(): Int {
        var r = bytes.contentHashCode()
        r = 31 * r + width
        r = 31 * r + height
        r = 31 * r + mime.hashCode()
        return r
    }
}

/**
 * Opens a PDF and renders its pages to images on demand, so the importer can
 * stream page-by-page to the server without holding the whole document in
 * memory. Abstracted behind an interface so [UploadRepository] stays
 * unit-testable — the Android impl uses the framework [PdfRenderer]; tests
 * inject a fake.
 */
interface PdfRasterizer {
    /** Open the PDF at [uriString]. Throws [IOException] if it can't be read. */
    suspend fun open(uriString: String): PdfPages
}

/** A page-by-page rendering session over an open PDF. Close when done. */
interface PdfPages : Closeable {
    val fileName: String
    val pageCount: Int

    /** Render page [index] (0-based) to a compressed image. */
    suspend fun render(index: Int): RenderedPage
}

@Singleton
class PdfRendererRasterizer @Inject constructor(
    @ApplicationContext private val context: Context,
) : PdfRasterizer {

    override suspend fun open(uriString: String): PdfPages = withContext(Dispatchers.IO) {
        val uri = Uri.parse(uriString)
        val fd = context.contentResolver.openFileDescriptor(uri, "r")
            ?: throw IOException("Could not open the selected PDF.")
        val renderer = try {
            PdfRenderer(fd)
        } catch (e: Exception) {
            fd.close()
            throw IOException("That file isn't a readable PDF.", e)
        }
        RendererPages(renderer, fd, documentName(uri))
    }

    /** The user-facing file name from the provider, falling back to the URI tail. */
    private fun documentName(uri: Uri): String {
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

private class RendererPages(
    private val renderer: PdfRenderer,
    private val fd: ParcelFileDescriptor,
    override val fileName: String,
) : PdfPages {

    override val pageCount: Int get() = renderer.pageCount

    override suspend fun render(index: Int): RenderedPage = withContext(Dispatchers.IO) {
        renderer.openPage(index).use { page ->
            // PDF points are 1/72"; render at ~TARGET_DPI, capping the long edge so
            // a poster-sized page can't blow up memory or the per-page size limit.
            val scale = TARGET_DPI / 72f
            var w = (page.width * scale).toInt().coerceAtLeast(1)
            var h = (page.height * scale).toInt().coerceAtLeast(1)
            val longEdge = maxOf(w, h)
            if (longEdge > MAX_EDGE_PX) {
                val k = MAX_EDGE_PX.toFloat() / longEdge
                w = (w * k).toInt().coerceAtLeast(1)
                h = (h * k).toInt().coerceAtLeast(1)
            }
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            // PDFs are often transparent; OCR wants dark-on-paper, so fill white.
            bmp.eraseColor(Color.WHITE)
            page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            val out = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
            bmp.recycle()
            RenderedPage(bytes = out.toByteArray(), width = w, height = h, mime = "image/jpeg")
        }
    }

    override fun close() {
        renderer.close()
        fd.close()
    }

    private companion object {
        const val TARGET_DPI = 150f
        const val MAX_EDGE_PX = 2200
        const val JPEG_QUALITY = 85
    }
}
