// RaTeXMetrics.kt — synchronous TeX metrics for native callers (Fabric baseline, TurboModule).

package io.ratex

import android.graphics.Color
import androidx.annotation.ColorInt

/**
 * Natural (unscaled) formula metrics, backed by the same parse cache the Fabric
 * measure pass and [RaTeXView]'s synchronous render use — so a call for a formula
 * that is already laid out never parses.
 *
 * Values are density-independent (dp) and mirror the measure path exactly,
 * including [RaTeXRenderer.glyphVerticalBleedPx]: the renderer pads the ink box by
 * one physical pixel top and bottom, so the drawn alphabetic baseline sits at
 * `heightDp - depthDp` from the view's top ("height" being the total ink height).
 */
object RaTeXMetrics {

    /**
     * Returns `[widthDp, totalHeightDp, depthDp]` for the formula, or null when the
     * input is empty or fails to parse.
     *
     * @param fontSize font size in dp (the RN prop value).
     * @param density device scale factor — Fabric's `pointScaleFactor` on the C++
     *   side, `displayMetrics.density` elsewhere. Needed because the renderer's
     *   anti-alias bleed is one *physical* pixel.
     * @param colorArgb the view's resolved color: parsing with the same color the
     *   view renders with shares one parse-cache entry across measure, baseline,
     *   and the synchronous render.
     */
    @JvmStatic
    fun metrics(
        latex: String,
        fontSize: Float,
        displayMode: Boolean,
        density: Float,
        @ColorInt colorArgb: Int = Color.BLACK,
    ): FloatArray? {
        if (latex.isBlank() || fontSize <= 0f || density <= 0f) return null
        return try {
            val displayList = RaTeXEngine.parseCached(latex, displayMode, colorArgb)
            val renderer = RaTeXRenderer(displayList, fontSize * density)
            floatArrayOf(
                renderer.widthPx / density,
                renderer.totalHeightPx / density,
                renderer.depthPx / density,
            )
        } catch (_: Throwable) {
            null
        }
    }
}
