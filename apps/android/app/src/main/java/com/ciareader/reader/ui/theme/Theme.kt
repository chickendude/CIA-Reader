package com.ciareader.reader.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

// Mapped to match the web app: warm paper surfaces, ink text, saffron accent.
private val LightColors = lightColorScheme(
    primary = SaffronLight,
    onPrimary = Color.White,
    primaryContainer = SaffronContainerLight,
    onPrimaryContainer = SaffronInkLight,
    secondary = InkLight2,
    onSecondary = PaperLight,
    secondaryContainer = PaperLight2,
    onSecondaryContainer = InkLight,
    tertiary = SaffronInkLight,
    onTertiary = PaperLight,
    background = PaperLight,
    onBackground = InkLight,
    surface = PaperLight,
    onSurface = InkLight,
    surfaceVariant = PaperLight2,
    onSurfaceVariant = InkLight2,
    surfaceContainerLowest = CardLight,
    surfaceContainerLow = PaperLight,
    surfaceContainer = PaperLight2,
    surfaceContainerHigh = PaperLight3,
    surfaceContainerHighest = PaperLight3,
    outline = InkLight3,
    outlineVariant = RuleLight,
    surfaceTint = SaffronLight,
    error = DangerLight,
    onError = Color.White,
)

private val DarkColors = darkColorScheme(
    primary = SaffronDark,
    onPrimary = SaffronInkDark,
    primaryContainer = SaffronContainerDark,
    onPrimaryContainer = InkDark,
    secondary = InkDark2,
    onSecondary = PaperDark,
    secondaryContainer = PaperDark2,
    onSecondaryContainer = InkDark,
    tertiary = SaffronDark,
    onTertiary = SaffronInkDark,
    background = PaperDark,
    onBackground = InkDark,
    surface = PaperDark,
    onSurface = InkDark,
    surfaceVariant = PaperDark2,
    onSurfaceVariant = InkDark2,
    surfaceContainerLowest = PaperDark,
    surfaceContainerLow = PaperDark2,
    surfaceContainer = PaperDark2,
    surfaceContainerHigh = PaperDark3,
    surfaceContainerHighest = PaperDark3,
    outline = InkDark3,
    outlineVariant = RuleDark,
    surfaceTint = SaffronDark,
    error = DangerDark,
    onError = PaperDark,
)

@Composable
fun CiaReaderTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    // Off by default so the app wears the saffron brand consistently (and matches
    // the web), instead of Material You recoloring it from the device wallpaper.
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColors
        else -> LightColors
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = CiaReaderTypography,
        content = content,
    )
}
