// RaTeXView.kt — Android custom View that renders a LaTeX formula.

package io.ratex

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.util.AttributeSet
import android.view.View
import androidx.annotation.ColorInt
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * A custom [View] that renders a LaTeX math formula using the RaTeX engine.
 *
 * XML usage:
 * ```xml
 * <io.ratex.RaTeXView
 *     android:id="@+id/mathView"
 *     android:layout_width="wrap_content"
 *     android:layout_height="wrap_content"
 *     app:latex="\frac{1}{2}"
 *     app:fontSize="24" />
 * ```
 *
 * Kotlin usage:
 * ```kotlin
 * binding.mathView.latex    = """\frac{-b \pm \sqrt{b^2-4ac}}{2a}"""
 * binding.mathView.fontSize = 28f   // dp — converted to px internally
 * ```
 */
class RaTeXView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyle: Int = 0,
) : View(context, attrs, defStyle) {

    // MARK: - Public properties

    /** LaTeX math-mode string to render. Setting this triggers a re-render. */
    var latex: String = ""
        set(value) {
            if (field == value) return
            field = value
            rerender()
        }

    /**
     * Font size in density-independent units (dp), matching React Native / iOS points.
     * Setting this triggers a re-render.
     */
    var fontSize: Float = 24f
        set(value) {
            if (field == value) return
            field = value
            rerender()
        }

    /**
     * Rendering mode. `true` (default) for display/block style (`$$...$$`);
     * `false` for inline/text style (`$...$`). Setting this triggers a re-render.
     */
    var displayMode: Boolean = true
        set(value) {
            if (field == value) return
            field = value
            rerender()
        }

    /** Default formula color. Explicit LaTeX colors still take precedence. */
    @ColorInt
    var color: Int = Color.BLACK
        set(value) {
            if (field == value) return
            field = value
            rerender()
        }

    /**
     * Vertical alignment against a host text line that pins the view bottom to the
     * text baseline (React Native's `<Text>`): "baseline" | "center" | "start" |
     * "end" | "none". RN sets it from `style.alignSelf`, only under a <Text>
     * ancestor. Applied via [setTranslationY] — an RN `transform` style would
     * conflict; don't combine the two on an inline formula.
     */
    var inlineAlign: String = "none"
        set(value) {
            if (field == value) return
            field = value
            applyInlineShift()
        }

    /** Called on the main thread when a render error occurs. */
    var onError: ((RaTeXException) -> Unit)? = null

    /** Called on the main thread when content size is known (width/height in dp). */
    var onContentSizeChange: ((width: Double, height: Double) -> Unit)? = null

    /**
     * When true, an external layout system owns this view's frame (React Native's
     * Fabric, which sizes the view from the shadow node's measure and assigns the
     * frame directly). Content changes then skip [requestLayout]: the classic
     * Android traversal it triggers would re-run [onMeasure] and could override the
     * externally assigned frame (e.g. escape a Yoga size clamp). When false
     * (standalone XML / programmatic use), [requestLayout] is the only way the view
     * can resize to new content, so it must run.
     */
    var sizingManagedExternally: Boolean = false

    // MARK: - Private state

    private var renderer: RaTeXRenderer? = null
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var renderJob: Job? = null

    // MARK: - Measure

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        if (sizingManagedExternally) {
            // The frame is assigned by RN (Fabric updateLayoutMetrics). A classic
            // Android traversal — triggered by ANY sibling's requestLayout — must
            // not resize this view away from that frame: reporting the desired
            // content size here would let the view grow past a Yoga clamp and then
            // snap back on the next Fabric layout, a visible scale flip. Report the
            // current frame instead (resolveSize still honors EXACTLY specs).
            setMeasuredDimension(
                resolveSize(width, widthMeasureSpec),
                resolveSize(height, heightMeasureSpec),
            )
            return
        }

        val r = renderer
        val desiredWidth = max(
            (r?.widthPx?.let { ceil(it).toInt() } ?: 0) + paddingLeft + paddingRight,
            suggestedMinimumWidth,
        )
        val desiredHeight = max(
            (r?.totalHeightPx?.let { ceil(it).toInt() } ?: 0) + paddingTop + paddingBottom,
            suggestedMinimumHeight,
        )

        // Respect parent / RN layout constraints (e.g. style={{width,height}}).
        val measuredWidth = resolveSize(desiredWidth, widthMeasureSpec)
        val measuredHeight = resolveSize(desiredHeight, heightMeasureSpec)
        setMeasuredDimension(measuredWidth, measuredHeight)
    }

    // MARK: - Draw

    override fun onDraw(canvas: Canvas) {
        val r = renderer ?: return

        val availW = (width - paddingLeft - paddingRight).toFloat().coerceAtLeast(0f)
        val availH = (height - paddingTop - paddingBottom).toFloat().coerceAtLeast(0f)
        val contentW = r.widthPx
        val contentH = r.totalHeightPx

        if (inlineAlign == "baseline") {
            // The frame is the ASCENT-ONLY box (measure reported height − depth):
            // draw natural-size ink with its baseline on the view bottom, the
            // descender overflowing below — no clip, height doesn't constrain.
            val k = if (contentW > 0f) min(1f, availW / contentW) else 1f
            canvas.save()
            canvas.translate(
                paddingLeft.toFloat(),
                paddingTop + availH - r.heightPx * k,
            )
            canvas.scale(k, k)
            r.draw(canvas)
            canvas.restore()
            return
        }

        // Clip to the view bounds so explicit style sizes behave predictably.
        canvas.save()
        canvas.clipRect(0, 0, width, height)

        // Scale down to fit within the explicit layout size (never scale up).
        val sx = if (contentW > 0f) availW / contentW else 1f
        val sy = if (contentH > 0f) availH / contentH else 1f
        val scale = min(1f, min(sx, sy))

        val scaledW = contentW * scale
        val scaledH = contentH * scale

        val dx = paddingLeft + ((availW - scaledW) / 2f).coerceAtLeast(0f)
        val dy = paddingTop + ((availH - scaledH) / 2f).coerceAtLeast(0f)

        canvas.translate(dx, dy)
        canvas.scale(scale, scale)
        r.draw(canvas)
        canvas.restore()
    }

    /**
     * The drawn formula's alphabetic baseline, for baseline-aligning native layouts
     * (LinearLayout etc.). Mirrors [onDraw]'s fit-scale/centering math so the
     * reported baseline always matches the ink actually painted.
     */
    override fun getBaseline(): Int {
        val r = renderer ?: return -1
        val availW = (width - paddingLeft - paddingRight).toFloat().coerceAtLeast(0f)
        val availH = (height - paddingTop - paddingBottom).toFloat().coerceAtLeast(0f)
        val contentW = r.widthPx
        val contentH = r.totalHeightPx
        if (contentW <= 0f || contentH <= 0f) return -1
        if (inlineAlign == "baseline") {
            // Ascent-only frame: the drawn ink baseline sits on the view bottom.
            return (paddingTop + availH).roundToInt()
        }
        val scale = min(1f, min(availW / contentW, availH / contentH))
        val dy = paddingTop + ((availH - contentH * scale) / 2f).coerceAtLeast(0f)
        return (dy + r.heightPx * scale).roundToInt()
    }

    // MARK: - Lifecycle

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        renderJob?.cancel()
        renderJob = null
    }

    /**
     * A view can be transiently detached and re-attached while its window is being built
     * (React Native's Fabric does this when mounting large trees). The detach cancels a
     * pending [renderJob], and since no prop changes afterwards, nothing would ever restart
     * it — the view would keep its laid-out size but stay blank forever. Re-kick the render
     * on attach when there is nothing rendered and no job in flight.
     */
    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (renderer == null && latex.isNotBlank() && renderJob?.isActive != true) rerender()
    }

    /**
     * See [inlineAlign]: downward translation (px) of the view against the host
     * text's bottom-on-baseline placement. Mirrors [onDraw]'s fit-scale (`k`) +
     * centering gap (`g`) so a clamped/scaled box still anchors correctly.
     */
    private fun applyInlineShift() {
        translationY = computeInlineShiftPx()
    }

    private fun computeInlineShiftPx(): Float {
        if (inlineAlign == "none") return 0f
        val r = renderer ?: return 0f
        val contentW = r.widthPx
        val contentH = r.totalHeightPx
        if (contentW <= 0f || contentH <= 0f) return 0f
        val density = context.resources.displayMetrics.density
        val availW = (width - paddingLeft - paddingRight).toFloat().coerceAtLeast(0f)
        val availH = (height - paddingTop - paddingBottom).toFloat().coerceAtLeast(0f)
        var k = 1f
        var g = 0f
        if (availW > 0f && availH > 0f) {
            k = min(1f, min(availW / contentW, availH / contentH))
            g = ((availH - contentH * k) / 2f).coerceAtLeast(0f)
        }
        val inkHeightPx = contentH * k
        val shiftPx = when (inlineAlign) {
            // "baseline" needs no translate: measure reports the ascent-only box
            // and onDraw bottom-anchors the ink — only the optical raise remains.
            // center/start/end use em fractions assuming host text at [fontSize]
            // (math axis 0.25em, line box 0.75/0.25em).
            "baseline" -> 0f
            "center" -> g + inkHeightPx / 2f - 0.25f * fontSize * density
            "start" -> g + inkHeightPx - 0.75f * fontSize * density
            "end" -> g + 0.25f * fontSize * density
            else -> return 0f
        }
        // Pixel-snap, then the same 1px optical raise as the shadow baseline().
        return shiftPx.roundToInt() - 1f
    }

    /** The inline shift depends on the laid-out size (fit-scale, centering gap). */
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        applyInlineShift()
    }

    // MARK: - Private

    private fun rerender() {
        renderJob?.cancel()
        renderJob = null
        if (latex.isBlank()) {
            renderer = null
            applyInlineShift()
            requestSelfLayout()
            invalidate()
            return
        }

        // Fast path: swap the renderer synchronously so the content changes in the
        // same frame as the Fabric-assigned size. On the new architecture the shadow
        // node's measure pass has already parsed this exact (latex, displayMode,
        // color) during the commit — before setLatex reaches this view — so the
        // lookup is a guaranteed hit and the main thread never parses. Without this,
        // the box grows one frame before the content does and onDraw re-centers the
        // stale (shorter) content inside the taller box: on streaming updates every
        // already-rendered line visibly nudges down, then snaps back.
        //
        // Fonts are only used at draw time, but a formula rendered before they load
        // would draw blank glyphs with nothing to trigger a redraw — so the fast
        // path requires fonts to be loaded; otherwise fall through to the async
        // path, which loads them first (only ever the case on app cold start).
        if (RaTeXFontLoader.isLoaded) {
            val dl = RaTeXEngine.lookupCached(latex, displayMode, color)
            if (dl != null) {
                applyRenderer(dl)
                return
            }
        }

        renderJob = scope.launch {
            try {
                withContext(Dispatchers.IO) { RaTeXFontLoader.ensureLoaded(context) }
                val dl = RaTeXEngine.parse(latex, displayMode, color)
                applyRenderer(dl)
            } catch (e: CancellationException) {
                // Not a render error: the job was cancelled (detach). Rethrow so the coroutine
                // machinery completes cancellation; onAttachedToWindow restarts the render.
                throw e
            } catch (e: RaTeXException) {
                renderer = null
                requestSelfLayout(); invalidate()
                onError?.invoke(e)
            } catch (e: Throwable) {
                renderer = null
                requestSelfLayout(); invalidate()
                onError?.invoke(RaTeXException(e.message ?: "unknown error"))
            }
        }
    }

    /**
     * Request a layout pass to adopt the new content size — unless the frame is
     * owned by an external layout system (see [sizingManagedExternally]).
     */
    private fun requestSelfLayout() {
        if (!sizingManagedExternally) requestLayout()
    }

    /** Install a renderer for [dl] and publish layout + content size. Main thread only. */
    private fun applyRenderer(dl: DisplayList) {
        // RN passes logical size (dp); convert to px so physical size matches iOS points.
        val density = context.resources.displayMetrics.density
        val r = RaTeXRenderer(dl, fontSize * density) { RaTeXFontLoader.getTypeface(it) }
        renderer = r
        applyInlineShift()
        requestSelfLayout()
        invalidate()
        val widthDp = r.widthPx / density
        val heightDp = r.totalHeightPx / density
        onContentSizeChange?.invoke(widthDp.toDouble(), heightDp.toDouble())
    }
}
