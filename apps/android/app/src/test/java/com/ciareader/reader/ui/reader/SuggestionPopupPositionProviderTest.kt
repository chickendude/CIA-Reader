package com.ciareader.reader.ui.reader

import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The reference-search suggestion dropdown must sit *just above* the search field
 * (the keyboard is below it) and align to the field's left edge. These pin that
 * down on the pure position math, independent of the popup/window plumbing.
 */
class SuggestionPopupPositionProviderTest {

    private val window = IntSize(width = 1080, height = 2400)
    private val ltr = LayoutDirection.Ltr

    private fun positionFor(field: Rect, popup: IntSize, gapPx: Int = 12) =
        SuggestionPopupPositionProvider(field, gapPx)
            .calculatePosition(
                anchorBounds = IntRect(0, 0, 0, 0), // ignored — we anchor to the field
                windowSize = window,
                layoutDirection = ltr,
                popupContentSize = popup,
            )

    @Test
    fun opensJustAboveTheFieldLeftAligned() {
        val field = Rect(left = 120f, top = 1500f, right = 720f, bottom = 1620f)
        val popup = IntSize(width = 600, height = 400)

        val offset = positionFor(field, popup, gapPx = 12)

        // Left-aligned with the field.
        assertEquals(120, offset.x)
        // The popup's bottom edge sits one gap above the field's top.
        assertEquals(field.top.toInt() - 12, offset.y + popup.height)
        // Equivalently, the top is field.top - gap - height.
        assertEquals(1500 - 12 - 400, offset.y)
    }

    @Test
    fun fallsBelowTheFieldWhenThereIsNoRoomAbove() {
        // Field pinned near the very top: a 400px-tall popup can't fit above it.
        val field = Rect(left = 120f, top = 40f, right = 720f, bottom = 160f)
        val popup = IntSize(width = 600, height = 400)

        val offset = positionFor(field, popup, gapPx = 12)

        assertEquals(120, offset.x)
        // Opens just below the field instead.
        assertEquals(field.bottom.toInt() + 12, offset.y)
    }

    @Test
    fun staysAboveWhenItExactlyFits() {
        // top - gap - height == 0 → still "above" (>= 0).
        val field = Rect(left = 0f, top = 412f, right = 600f, bottom = 532f)
        val popup = IntSize(width = 600, height = 400)

        val offset = positionFor(field, popup, gapPx = 12)

        assertEquals(0, offset.y)
        assertEquals(0, offset.x)
    }
}
