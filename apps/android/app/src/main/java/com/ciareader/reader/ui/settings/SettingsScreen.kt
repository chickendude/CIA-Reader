package com.ciareader.reader.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.hilt.navigation.compose.hiltViewModel
import com.ciareader.reader.R
import java.util.Locale

@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onLogout: () -> Unit,
    onOpenDownloads: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    SettingsScreenContent(
        state = state,
        onBack = onBack,
        onSetRomanization = viewModel::setRomanization,
        onSetPageMode = viewModel::setPageMode,
        onSetFontSize = viewModel::setFontSize,
        onSetLineSpacing = viewModel::setLineSpacing,
        onClearCache = viewModel::clearOfflineCache,
        onCacheClearedShown = viewModel::onCacheClearedShown,
        onOpenDownloads = onOpenDownloads,
        onLogout = onLogout,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreenContent(
    state: SettingsUiState,
    onBack: () -> Unit,
    onSetRomanization: (Boolean) -> Unit,
    onSetPageMode: (Boolean) -> Unit,
    onSetFontSize: (Int) -> Unit,
    onSetLineSpacing: (Float) -> Unit,
    onClearCache: () -> Unit,
    onCacheClearedShown: () -> Unit,
    onOpenDownloads: () -> Unit,
    onLogout: () -> Unit,
) {
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(state.cacheCleared) {
        if (state.cacheCleared) {
            snackbar.showSnackbar("Offline downloads cleared")
            onCacheClearedShown()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(painterResource(R.drawable.ic_chevron_left), contentDescription = "Back")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
        ) {
            // Reading prefs are per-language; show which one they apply to.
            SectionHeader(
                if (state.languageLabel.isNotEmpty()) "Reading · ${state.languageLabel}" else "Reading",
            )
            SwitchRow(
                label = "Romanization",
                description = "Show romanized text instead of the native script",
                checked = state.romanization,
                onCheckedChange = onSetRomanization,
            )
            SwitchRow(
                label = "Page mode",
                description = "Turn pages instead of scrolling",
                checked = state.pageMode,
                onCheckedChange = onSetPageMode,
            )
            StepperRow(
                label = "Font size",
                value = "${state.fontSize}pt",
                onDecrease = { onSetFontSize(state.fontSize - SettingsViewModel.FONT_SIZE_STEP) },
                onIncrease = { onSetFontSize(state.fontSize + SettingsViewModel.FONT_SIZE_STEP) },
            )
            StepperRow(
                label = "Line spacing",
                value = String.format(Locale.US, "%.1f", state.lineSpacing),
                onDecrease = { onSetLineSpacing(state.lineSpacing - SettingsViewModel.LINE_SPACING_STEP) },
                onIncrease = { onSetLineSpacing(state.lineSpacing + SettingsViewModel.LINE_SPACING_STEP) },
            )

            Spacer(Modifier.height(24.dp))
            SectionHeader("Storage")
            OutlinedButton(onClick = onOpenDownloads, modifier = Modifier.fillMaxWidth()) {
                Text("Manage downloads")
            }
            Spacer(Modifier.height(8.dp))
            OutlinedButton(onClick = onClearCache, modifier = Modifier.fillMaxWidth()) {
                Text("Clear offline downloads")
            }

            Spacer(Modifier.height(24.dp))
            SectionHeader("Account")
            Button(onClick = onLogout, modifier = Modifier.fillMaxWidth()) {
                Text("Log out")
            }
        }
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 16.dp, bottom = 4.dp),
    )
}

@Composable
private fun SwitchRow(
    label: String,
    description: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            // Whole row toggles, so the tap target isn't just the switch.
            .toggleable(value = checked, onValueChange = onCheckedChange, role = Role.Switch)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            Text(
                description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        // Controlled by the row's toggleable; null avoids a redundant click target.
        Switch(checked = checked, onCheckedChange = null)
    }
}

@Composable
private fun StepperRow(
    label: String,
    value: String,
    onDecrease: () -> Unit,
    onIncrease: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            IconButton(
                onClick = onDecrease,
                modifier = Modifier.semantics { contentDescription = "Decrease $label" },
            ) {
                Icon(painterResource(R.drawable.ic_chevron_left), contentDescription = null)
            }
            Text(value, style = MaterialTheme.typography.bodyLarge)
            IconButton(
                onClick = onIncrease,
                modifier = Modifier.semantics { contentDescription = "Increase $label" },
            ) {
                Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null)
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}
