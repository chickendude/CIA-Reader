package com.ciareader.reader.ui.importer

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ciareader.reader.data.upload.ImportResult

/**
 * The library's "+" import sheet. Offers paste / `.txt` / `.epub` and a disabled
 * PDF row. On success it calls [onImported] (so the library can navigate +
 * refresh) and dismisses. [language] is the library's current language — every
 * import is filed under it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportSheet(
    language: String,
    onDismiss: () -> Unit,
    onImported: (ImportResult) -> Unit,
    viewModel: ImportViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    // Hand a successful import back to the caller, then reset.
    state.result?.let { result ->
        viewModel.consumeResult()
        onImported(result)
    }

    ImportSheetContent(
        language = language,
        isSubmitting = state.isSubmitting,
        errorMessage = state.errorMessage,
        onDismiss = onDismiss,
        onSubmitPaste = viewModel::submitPaste,
        onImportTxt = viewModel::importTxt,
        onImportEpub = viewModel::importEpub,
    )
}

/**
 * Stateless sheet wrapper — the [ModalBottomSheet] chrome around [ImportSheetBody].
 * Split from the body so the body is testable standalone (ModalBottomSheet's
 * window/animation plumbing is awkward under Robolectric).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ImportSheetContent(
    language: String,
    isSubmitting: Boolean,
    errorMessage: String?,
    onDismiss: () -> Unit,
    onSubmitPaste: (language: String, title: String, body: String) -> Unit,
    onImportTxt: (language: String, uri: String) -> Unit,
    onImportEpub: (language: String, uri: String) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        ImportSheetBody(
            language = language,
            isSubmitting = isSubmitting,
            errorMessage = errorMessage,
            onSubmitPaste = onSubmitPaste,
            onImportTxt = onImportTxt,
            onImportEpub = onImportEpub,
        )
    }
}

/**
 * The import options column: paste / `.txt` / `.epub` rows + a disabled PDF row,
 * plus the paste dialog. The SAF pickers live here because they only need the
 * picked URI string.
 */
@Composable
internal fun ImportSheetBody(
    language: String,
    isSubmitting: Boolean,
    errorMessage: String?,
    onSubmitPaste: (language: String, title: String, body: String) -> Unit,
    onImportTxt: (language: String, uri: String) -> Unit,
    onImportEpub: (language: String, uri: String) -> Unit,
) {
    var showPasteDialog by remember { mutableStateOf(false) }

    // ACTION_OPEN_DOCUMENT needs no runtime permission; we read the bytes
    // immediately so a one-shot grant is enough.
    val txtPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri -> uri?.let { onImportTxt(language, it.toString()) } }
    val epubPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri -> uri?.let { onImportEpub(language, it.toString()) } }

    Column(Modifier.padding(bottom = 24.dp)) {
        Text(
            "Import a text",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
        )

        if (isSubmitting) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(Modifier.size(24.dp))
                Spacer(Modifier.width(16.dp))
                Text("Importing…")
            }
        } else {
            errorMessage?.let { msg ->
                Text(
                    msg,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp),
                )
            }

            ImportOption(
                title = "Paste text",
                subtitle = "Type or paste a title and text",
                onClick = { showPasteDialog = true },
            )
            ImportOption(
                title = "Plain text file (.txt)",
                subtitle = "Pick a .txt file from your device",
                onClick = { txtPicker.launch(arrayOf("text/plain")) },
            )
            ImportOption(
                title = "EPUB book (.epub)",
                subtitle = "Pick an .epub file from your device",
                onClick = {
                    epubPicker.launch(
                        arrayOf("application/epub+zip", "application/octet-stream"),
                    )
                },
            )
            ImportOption(
                title = "PDF (coming soon)",
                subtitle = "PDF import isn't available in the app yet",
                enabled = false,
                onClick = {},
            )
        }
    }

    if (showPasteDialog) {
        PasteDialog(
            isSubmitting = isSubmitting,
            onDismiss = { showPasteDialog = false },
            onSubmit = { title, body ->
                showPasteDialog = false
                onSubmitPaste(language, title, body)
            },
        )
    }
}

@Composable
private fun ImportOption(
    title: String,
    subtitle: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val contentColor =
        if (enabled) MaterialTheme.colorScheme.onSurface
        else MaterialTheme.colorScheme.onSurfaceVariant
    ListItem(
        headlineContent = { Text(title, color = contentColor) },
        supportingContent = {
            Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
        },
        modifier = Modifier
            .fillMaxWidth()
            .semantics { contentDescription = title }
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier),
    )
}

@Composable
private fun PasteDialog(
    isSubmitting: Boolean,
    onDismiss: () -> Unit,
    onSubmit: (title: String, body: String) -> Unit,
) {
    var title by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    val canSubmit = title.isNotBlank() && body.isNotBlank() && !isSubmitting
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Paste text") },
        text = {
            Column {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("Title") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = body,
                    onValueChange = { body = it },
                    label = { Text("Text") },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(180.dp),
                )
            }
        },
        confirmButton = {
            TextButton(enabled = canSubmit, onClick = { onSubmit(title, body) }) {
                Text("Import")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}
