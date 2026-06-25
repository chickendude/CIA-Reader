package com.ciareader.reader.ui.importer

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ciareader.reader.core.network.Outcome
import com.ciareader.reader.data.upload.DocumentReader
import com.ciareader.reader.data.upload.ImportResult
import com.ciareader.reader.data.upload.TextSourceType
import com.ciareader.reader.data.upload.UploadRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.IOException
import javax.inject.Inject

data class ImportUiState(
    /** A submit is in flight (network or file read) — disables the form. */
    val isSubmitting: Boolean = false,
    val errorMessage: String? = null,
    /** Set once an import succeeds; the library consumes it to navigate + refresh. */
    val result: ImportResult? = null,
)

/**
 * Drives the "import a text" flow: paste plain text, pick a `.txt`/`.epub`, or
 * pick a `.pdf`. The screen owns the SAF launchers and hands us the picked
 * `content://` URI; we read its bytes via [DocumentReader] (or rasterize pages
 * via the repository's [PdfRasterizer]) and POST via [UploadRepository].
 */
@HiltViewModel
class ImportViewModel @Inject constructor(
    private val uploadRepository: UploadRepository,
    private val documentReader: DocumentReader,
) : ViewModel() {

    private val _state = MutableStateFlow(ImportUiState())
    val state: StateFlow<ImportUiState> = _state.asStateFlow()

    /** Paste flow: a user-typed title + body for the current [language]. */
    fun submitPaste(language: String, title: String, body: String) {
        val trimmedTitle = title.trim()
        val trimmedBody = body.trim()
        if (trimmedTitle.isEmpty() || trimmedBody.isEmpty()) {
            _state.update { it.copy(errorMessage = "Enter a title and some text.") }
            return
        }
        runImport {
            uploadRepository.createText(
                language = language,
                title = trimmedTitle,
                body = trimmedBody,
                sourceType = TextSourceType.PASTE,
            )
        }
    }

    /** `.txt` flow: read the picked document's text, then create the text. */
    fun importTxt(language: String, uriString: String) {
        runImport {
            val doc = documentReader.readText(uriString)
            val title = doc.fileName.removeSuffix(".txt").ifBlank { "Untitled" }
            val body = doc.text.trim()
            if (body.isEmpty()) {
                return@runImport Outcome.Failure("That file is empty.")
            }
            uploadRepository.createText(
                language = language,
                title = title,
                body = body,
                sourceType = TextSourceType.TXT,
            )
        }
    }

    /** `.epub` flow: read the picked document's bytes, then multipart-upload. */
    fun importEpub(language: String, uriString: String) {
        runImport {
            val doc = documentReader.read(uriString)
            val title = doc.fileName.removeSuffix(".epub").ifBlank { "Untitled" }
            uploadRepository.uploadEpub(
                language = language,
                title = title,
                fileName = doc.fileName,
                bytes = doc.bytes,
            )
        }
    }

    /** `.pdf` flow: the repository rasterizes pages on-device and streams them. */
    fun importPdf(language: String, uriString: String) {
        runImport {
            uploadRepository.importPdf(language, uriString)
        }
    }

    /** Clears a surfaced error so the form can be retried. */
    fun clearError() = _state.update { it.copy(errorMessage = null) }

    /** Consumes the success result after the library has acted on it. */
    fun consumeResult() = _state.update { it.copy(result = null) }

    /** Shared runner: flips the submitting flag, runs [block], records outcome. */
    private fun runImport(block: suspend () -> Outcome<ImportResult>) {
        if (_state.value.isSubmitting) return
        _state.update { it.copy(isSubmitting = true, errorMessage = null) }
        viewModelScope.launch {
            val outcome = try {
                block()
            } catch (_: IOException) {
                Outcome.Failure("Could not read the selected file.")
            }
            when (outcome) {
                is Outcome.Success ->
                    _state.update { it.copy(isSubmitting = false, result = outcome.data) }

                is Outcome.Failure ->
                    _state.update { it.copy(isSubmitting = false, errorMessage = outcome.message) }
            }
        }
    }
}
