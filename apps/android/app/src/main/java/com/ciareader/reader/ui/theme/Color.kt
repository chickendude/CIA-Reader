package com.ciareader.reader.ui.theme

import androidx.compose.ui.graphics.Color

/*
 * "Paper / ink / saffron" palette, matched to the web app's design tokens
 * (apps/web/src/lib/styles/tokens.css — the canonical CIAR palette). Hex values
 * are the web tokens verbatim; the saffron accents are the web's oklch accents
 * converted to sRGB (oklch(0.58 0.13 60) → #B16512 light, oklch(0.78 0.13 70)
 * → #ECA851 dark).
 */

// --- Light (web :root / [data-theme='light']) ---
val PaperLight = Color(0xFFFDFAF3)        // --paper
val PaperLight2 = Color(0xFFF7F1E2)       // --paper-2
val PaperLight3 = Color(0xFFEFE7D0)       // --paper-3
val CardLight = Color(0xFFFFFFFF)         // --card
val InkLight = Color(0xFF1F1A14)          // --ink
val InkLight2 = Color(0xFF524A3D)         // --ink-2
val InkLight3 = Color(0xFF877E6C)         // --ink-3
val RuleLight = Color(0xFFECE2C9)         // --rule
val SaffronLight = Color(0xFFB16512)      // --accent
val SaffronInkLight = Color(0xFF5B2700)   // --accent-ink
val SaffronContainerLight = Color(0xFFF7E6C8)
val DangerLight = Color(0xFFDC2626)       // --color-danger

// --- Dark (web [data-theme='dark']) ---
val PaperDark = Color(0xFF161310)
val PaperDark2 = Color(0xFF1D1916)
val PaperDark3 = Color(0xFF25201B)
val CardDark = Color(0xFF1A1714)
val InkDark = Color(0xFFF0E7D3)
val InkDark2 = Color(0xFFC9BFA9)
val InkDark3 = Color(0xFF897E6A)
val RuleDark = Color(0xFF2E2822)
val SaffronDark = Color(0xFFECA851)
val SaffronInkDark = Color(0xFF211201)
val SaffronContainerDark = Color(0xFF5C3A00)
val DangerDark = Color(0xFFF87171)
