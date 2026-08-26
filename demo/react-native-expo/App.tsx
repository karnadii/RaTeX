/**
 * Minimal reproduction for https://github.com/erweixin/RaTeX/issues/42
 *
 * RaTeXView intermittently renders blank when mounted inside flex-1/minHeight:0
 * containers — especially inside FlatList items where layout is deferred.
 *
 * The bug: RaTeXView's native side sees 0 available space during the first
 * layout pass, returns early without rendering, and never recovers.
 *
 * Three test cases:
 *   A) flex:1 + minHeight:0 parent (the failing case)
 *   B) Inside a paging FlatList with flex:1 items (deferred layout)
 *   C) Explicit dimensions (always works — control)
 */

import { StatusBar } from "expo-status-bar";
import { useState, useCallback, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { ViewStyle } from "react-native";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  SafeAreaView,
  FlatList,
  useWindowDimensions,
  ScrollView,
} from "react-native";
import { InlineTeX, RaTeXView, getTexMetrics } from "ratex-react-native";
import type { RaTeXTexMetrics, RaTeXViewRef } from "ratex-react-native";

const EXPR = String.raw`x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`;
const EXPR2 = String.raw`\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}`;
const EXPR3 = String.raw`\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}`;
const INLINE_FONT_FAMILY = "cofosans-regular";
const INLINE_FONT_CONTENT =
  "For a right triangle, the sides satisfy $a^2 + b^2 = c^2$, where c is the hypotenuse.";

const PAGES = [
  { id: "1", latex: EXPR },
  { id: "2", latex: EXPR2 },
  { id: "3", latex: EXPR3 },
  { id: "4", latex: String.raw`E = mc^2` },
  { id: "5", latex: String.raw`\text{勾股定理：} a^2+b^2=c^2` },
  {
    id: "6",
    latex: String.raw`\ce{CO2 + C -> 2 CO} \quad \text{二氧化碳}`,
  },
  { id: "7", latex: String.raw`\text{😊} \quad E=mc^2` },
];

// ─── Streaming math: already-rendered lines jump on each appended line ──
//
// Simulates an LLM streaming a multi-line formula: one line is appended to a
// growing `\begin{aligned}` block on a timer. On Android (Fabric), the shadow
// node measures the NEW latex synchronously at commit (the box grows), but the
// view swaps its renderer asynchronously a frame later — so for one frame the
// old (shorter) content is re-centered inside the taller box and every
// already-rendered line visibly nudges down, then snaps back.
//
// Repro requirements (deliberate):
//   - The RaTeXView key is STABLE across appends — a per-append key would
//     remount the view and show a blank flash instead of the jump.
//   - The formula is TOP-ALIGNED in its card — a centering parent would move
//     the whole view on growth and mask the intra-view nudge.
const STREAM_LINES = [
  String.raw`f(x) &= (x + 1)^2`,
  String.raw`&= x^2 + 2x + 1`,
  String.raw`\int_0^\infty e^{-x^2}\,dx &= \frac{\sqrt{\pi}}{2}`,
  String.raw`\sum_{n=1}^{\infty} \frac{1}{n^2} &= \frac{\pi^2}{6}`,
  String.raw`e^{i\pi} + 1 &= 0`,
  String.raw`\frac{d}{dx}\left(\frac{u}{v}\right) &= \frac{u'v - uv'}{v^2}`,
  String.raw`x &= \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`,
  String.raw`\lim_{x \to 0} \frac{\sin x}{x} &= 1`,
];

function CaseStreamingMath() {
  const [lineCount, setLineCount] = useState(1);
  const [running, setRunning] = useState(true);
  const [autoGrow, setAutoGrow] = useState(false);

  useLayoutEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      // Wrap around so the jump can be observed continuously.
      setLineCount((n) => (n >= STREAM_LINES.length ? 1 : n + 1));
    }, 700);
    return () => clearInterval(id);
  }, [running]);

  const latex =
    String.raw`\begin{aligned}` +
    STREAM_LINES.slice(0, lineCount).join(String.raw` \\ `) +
    String.raw`\end{aligned}`;

  return (
    <View style={[styles.card, styles.streamCard]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>
          Streaming math — watch rendered lines jump (Android)
        </Text>
      </View>
      <Text style={styles.streamHint}>
        A line is appended every 700 ms ({lineCount}/{STREAM_LINES.length}).
        Broken: on each append the already-rendered lines nudge down for one
        frame, then snap back. Fixed / iOS: lines never move.
      </Text>
      <Pressable
        style={styles.button}
        onPress={() => setRunning((r) => !r)}
      >
        <Text style={styles.buttonText}>{running ? "Pause" : "Resume"}</Text>
      </Pressable>
      <Pressable
        style={styles.streamCheckbox}
        onPress={() => setAutoGrow((a) => !a)}
      >
        <Text style={styles.streamCheckboxText}>
          {autoGrow
            ? "☑ Auto-grow (no fixed height)"
            : "☐ Fixed height (will downscale)"}
        </Text>
      </Pressable>
      <View style={[styles.streamStage, autoGrow && styles.streamStageAuto]}>
        <RaTeXView latex={latex} fontSize={20} displayMode={true} />
      </View>
    </View>
  );
}

// ─── Case #120: useLayoutEffect measurement drives an absolute decoration ─────
// https://github.com/erweixin/RaTeX/issues/120
//
// The dashed frame and blue baseline are positioned absolutely from geometry
// computed *inside useLayoutEffect* via ref.measure(). React flushes layout
// effects (and the state they set) before paint, so:
//   - Fixed:   the view reports its real size on the first commit → the frame
//              hugs the formula the instant it appears (no flash).
//   - Broken:  the view reports 0×0 on the first commit → the frame starts
//              collapsed and only jumps into place a few frames later.
// The caption records what the FIRST useLayoutEffect pass measured, so the
// per-platform behavior is visible even if the jump is quick.
function MeasuredFormula({ latex }: { latex: string }) {
  const hostRef = useRef<View>(null);
  const [deco, setDeco] = useState<{ w: number; h: number } | null>(null);
  const [firstPass, setFirstPass] = useState<{ w: number; h: number } | null>(
    null
  );
  const measure = useCallback(() => {
    const node = hostRef.current;
    if (!node) return;
    node.measure((_x, _y, w, h) => {
      // Capture only the FIRST commit's measurement (the #120 signal).
      setFirstPass((prev) => prev ?? { w, h });
      // Guard object identity so an unchanged size doesn't re-trigger a render.
      setDeco((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    });
  }, []);

  // Runs once after the first commit; the component is keyed so remounts re-test.
  useLayoutEffect(() => {
    measure();
  }, [measure]);

  const ok = firstPass ? firstPass.w > 0 && firstPass.h > 0 : null;

  return (
    <View style={styles.measureBody}>
      <View style={styles.measureStage}>
        {/* collapsable={false} keeps the wrapper in the native tree on Android
            so measure() targets it instead of being flattened away. */}
        <View ref={hostRef} collapsable={false} style={styles.measureHost}>
          <RaTeXView
            latex={latex}
            fontSize={30}
            displayMode={true}
            onContentSizeChange={measure}
          />
          {deco && deco.w > 0 && deco.h > 0 ? (
            <>
              <View
                pointerEvents="none"
                style={[styles.decoFrame, { width: deco.w, height: deco.h }]}
              />
              <View
                pointerEvents="none"
                style={[styles.decoBaseline, { width: deco.w, top: deco.h }]}
              />
            </>
          ) : null}
        </View>
      </View>
      <Text style={styles.measureMeta}>
        {"useLayoutEffect measure(): "}
        {firstPass
          ? `${firstPass.w.toFixed(0)}×${firstPass.h.toFixed(0)}`
          : "—"}
        {ok === null
          ? ""
          : ok
          ? "  ✓ real size on first commit"
          : "  ✗ 0×0 on first commit (flash)"}
      </Text>
    </View>
  );
}

function CaseLayoutEffectMeasure() {
  const [remount, setRemount] = useState(0);
  const [idx, setIdx] = useState(0);
  const latex = idx === 0 ? EXPR : idx === 1 ? EXPR2 : EXPR3;

  return (
    <View style={[styles.card, styles.measureCard]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>
          #120: useLayoutEffect measure → absolute decoration
        </Text>
      </View>
      <Text style={styles.measureHint}>
        The dashed frame + blue baseline are sized from ref.measure() inside
        useLayoutEffect. Fixed → they hug the formula immediately. Broken → they
        start at 0 and jump. Press Remount to re-test the first commit.
      </Text>
      <MeasuredFormula key={`${remount}-${idx}`} latex={latex} />
      <View style={styles.smokeRow}>
        <Pressable style={styles.smokeBtn} onPress={() => setRemount((r) => r + 1)}>
          <Text style={styles.smokeBtnText}>Remount</Text>
        </Pressable>
        <Pressable style={styles.smokeBtn} onPress={() => setIdx((i) => (i + 1) % 3)}>
          <Text style={styles.smokeBtnText}>Next formula</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Detach-cancel repro: transient detach permanently blanks formulas ──
//
// RaTeXView launches its render as a coroutine and cancels it in
// onDetachedFromWindow. On Android a view can be detached *transiently* and
// come right back — most commonly when a Fabric commit changes an ancestor's
// VIEW-FLATTENING status: the ancestor is removed and its children re-parented
// (SurfaceMountingManager.removeViewAt + addView), firing detach/attach on
// every descendant. Nothing ever restarts the cancelled job — every trigger
// is a prop setter guarded by `if (field == value) return`, and the props
// never change — so the view keeps its laid-out size but stays blank forever,
// reporting the confusing onError "StandaloneCoroutine was cancelled".
//
// This case reproduces it the way a real markdown/math consumer hits it:
//   1. each formula mounts via the two-pass measure→swap pattern (invisible
//      probe → synchronous measure() in useLayoutEffect → pre-paint swap to
//      a fitted view), inside a wrapper styled `opacity: 0` — an overlay
//      hiding an extension until its frame is known;
//   2. one frame later the wrapper is revealed by DROPPING the opacity
//      style. Losing it makes the wrapper flattenable, Fabric restructures,
//      and every formula view is detached while its render job is still in
//      flight (the first job also blocks on the KaTeX font load on a fresh
//      process, keeping the rest pending).
//   Broken: formulas occupy space but stay blank — red dot, 0/32 rendered,
//           "StandaloneCoroutine was cancelled" listed below the strip.
//   Fixed:  onAttachedToWindow re-kicks the render — all 32 appear.
// Cold start (kill + relaunch) is the most reliable; "Run repro" re-tests
// warm.
const DETACH_COUNT = 32;
const DETACH_FORMULAS = Array.from({ length: DETACH_COUNT }, (_, i) =>
  String.raw`\begin{aligned} \sum_{k=${i}}^{\infty} \frac{${i + 1}}{k^{${(i % 3) + 2}}} &= \int_0^\infty \frac{x^{${i}}}{e^x - 1}\,dx \\ \frac{-b \pm \sqrt{b^2 - 4a_{${i}}c}}{2a_{${i}}} &= \prod_{k=1}^{${i + 2}} \left(1 + \frac{x_k}{k!}\right) \end{aligned}`
);

function TwoPassFormula({
  index,
  latex,
  onSized,
  onErrorMsg,
}: {
  index: number;
  latex: string;
  onSized: (index: number) => void;
  onErrorMsg: (message: string) => void;
}) {
  const probeRef = useRef<View>(null);
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);

  // Fabric's measure() is synchronous — the probe reports its real size in
  // the mounting commit, and the sync setState swaps in the fitted view
  // before paint.
  useLayoutEffect(() => {
    if (fit) return;
    probeRef.current?.measure((_x, _y, w, h) => {
      if (w > 0 && h > 0) setFit({ w, h });
    });
  }, [fit]);

  if (!fit) {
    return (
      <View>
        <View style={{ position: "absolute", width: 10000, height: 10000, opacity: 0 }}>
          <View ref={probeRef} collapsable={false} style={{ alignSelf: "flex-start" }}>
            <RaTeXView latex={latex} fontSize={13} displayMode={true} />
          </View>
        </View>
      </View>
    );
  }

  const scale = Math.min(1, 136 / fit.w, 52 / fit.h);
  return (
    <RaTeXView
      latex={latex}
      fontSize={13}
      displayMode={true}
      style={{ width: fit.w * scale, height: fit.h * scale }}
      onContentSizeChange={(e) => {
        const { width, height } = e.nativeEvent;
        console.log(`[detach-${index}] size: ${width}x${height}`);
        if (width > 0 && height > 0) onSized(index);
      }}
      onError={(e) => {
        console.error(`[detach-${index}] error:`, e.nativeEvent.error);
        onErrorMsg(`#${index}: ${e.nativeEvent.error}`);
      }}
    />
  );
}

function CaseDetachCancel() {
  const [gen, setGen] = useState(0);
  const [chunks, setChunks] = useState(0);
  const [sized, setSized] = useState<Record<number, true>>({});
  const [errors, setErrors] = useState<string[]>([]);

  const run = useCallback(() => {
    setSized({});
    setErrors([]);
    setChunks(0);
    setGen((g) => g + 1);
  }, []);

  // Overlay-style reveal churn: each formula mounts inside a wrapper View
  // styled `opacity: 0` (the way a markdown overlay hides an extension until
  // its frame is measured), and one frame later the wrapper is revealed by
  // DROPPING that style. Losing `opacity` makes the wrapper eligible for
  // Fabric view flattening, so the commit restructures the native tree by
  // REMOVING and re-inserting the wrapper — transiently detaching the
  // formula view while its render job is still in flight.
  const [revealed, setRevealed] = useState(false);
  useLayoutEffect(() => {
    setRevealed(false);
    let count = 0;
    let raf = requestAnimationFrame(function tick() {
      setChunks((c) => c + 1);
      count += 1;
      if (count === 1) setRevealed(true);
      if (count < 3) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [gen]);

  const onSized = useCallback((index: number) => {
    setSized((s) => (s[index] ? s : { ...s, [index]: true }));
  }, []);
  const onErrorMsg = useCallback((message: string) => {
    setErrors((errs) => [...errs, message]);
  }, []);

  const renderedCount = Object.keys(sized).length;
  const status: "pending" | "ok" | "error" =
    errors.length > 0
      ? "error"
      : renderedCount === DETACH_COUNT
      ? "ok"
      : "pending";

  return (
    <View style={[styles.card, styles.detachCard]}>
      <View style={styles.cardHeader}>
        <StatusDot status={status} />
        <Text style={styles.cardTitle}>
          Detach-cancel: clipped views stay blank (Android)
        </Text>
      </View>
      <Text style={styles.smokeHint}>
        {`Each formula mounts inside an opacity:0 wrapper that is revealed one frame later — the style drop flips the wrapper's view-flattening status, so Fabric re-parents it and transiently detaches every formula mid-render. Broken: they stay blank forever ("StandaloneCoroutine was cancelled" below). Fixed: all ${DETACH_COUNT} render. Kill + relaunch the app for the most reliable (cold-font) run.`}
      </Text>
      <View style={styles.smokeRow}>
        <Pressable style={styles.smokeBtn} onPress={run}>
          <Text style={styles.smokeBtnText}>Run repro</Text>
        </Pressable>
        <Text style={styles.detachMeta}>
          rendered {renderedCount}/{DETACH_COUNT} · errors {errors.length}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.detachStrip}>
        {Array.from({ length: chunks }, (_, c) => (
          <View key={`chunk-${gen}-${c}`} style={styles.detachChunk}>
            <Text style={styles.detachChunkText}>chunk {c}</Text>
          </View>
        ))}
        {DETACH_FORMULAS.map((latex, i) => (
          <View key={`${gen}-${i}`} style={styles.detachBox}>
            <View style={revealed ? undefined : { opacity: 0 }}>
              <TwoPassFormula index={i} latex={latex} onSized={onSized} onErrorMsg={onErrorMsg} />
            </View>
            <Text style={styles.detachIndex}>#{i}</Text>
          </View>
        ))}
      </ScrollView>
      {errors.length > 0 ? (
        <Text style={styles.detachErrors} numberOfLines={3}>
          {errors.join("  ·  ")}
        </Text>
      ) : null}
    </View>
  );
}

// ─── Status indicator ────────────────────────────────────────────────
function StatusDot({ status }: { status: "pending" | "ok" | "error" }) {
  const color =
    status === "ok" ? "#22c55e" : status === "error" ? "#ef4444" : "#d1d5db";
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

// ─── Case A: flex-1 + minHeight:0 parent (the bug trigger) ──────────
function CaseFlexMinHeight({ renderKey }: { renderKey: number }) {
  const [status, setStatus] = useState<"pending" | "ok" | "error">("pending");

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <StatusDot status={status} />
        <Text style={styles.cardTitle}>
          A: flex:1 + minHeight:0 parent
        </Text>
      </View>
      {/* This is the layout pattern that causes intermittent failures */}
      <View style={{ flex: 1, minHeight: 0 }}>
        <View style={{ flex: 1, minHeight: 0, alignItems: "center" }}>
          <RaTeXView
            // key={renderKey}
            latex={EXPR}
            fontSize={28}
            displayMode={true}
            onContentSizeChange={(e) => {
              const { width, height } = e.nativeEvent;
              console.log(`[A] size: ${width}x${height}`);
              if (width > 0 && height > 0) setStatus("ok");
            }}
            onError={(e) => {
              console.error(`[A] error:`, e.nativeEvent.error);
              setStatus("error");
            }}
          />
        </View>
      </View>
    </View>
  );
}

// ─── Case B: Inside paging FlatList (deferred layout) ───────────────
function CaseFlatList({ renderKey }: { renderKey: number }) {
  const { width } = useWindowDimensions();
  const [statuses, setStatuses] = useState<Record<string, "pending" | "ok" | "error">>({});

  const renderPage = useCallback(
    ({ item }: { item: (typeof PAGES)[0] }) => (
      <View style={[styles.flatListPage, { width }]}>
        {/* Mimics a card inside a FlatList page with flex constraints */}
        <View style={{ flex: 1, minHeight: 0, justifyContent: "center", alignItems: "center" }}>
          <RaTeXView
            // key={`${renderKey}-${item.id}`}
            latex={item.latex}
            fontSize={28}
            displayMode={true}
            onContentSizeChange={(e) => {
              const { width: w, height: h } = e.nativeEvent;
              console.log(`[B-${item.id}] size: ${w}x${h}`);
              if (w > 0 && h > 0)
                setStatuses((s) => ({ ...s, [item.id]: "ok" }));
            }}
            onError={(e) => {
              console.error(`[B-${item.id}] error:`, e.nativeEvent.error);
              setStatuses((s) => ({ ...s, [item.id]: "error" }));
            }}
          />
        </View>
      </View>
    ),
    [renderKey, width]
  );

  const allOk = PAGES.every((p) => statuses[p.id] === "ok");
  const anyError = PAGES.some((p) => statuses[p.id] === "error");

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <StatusDot status={anyError ? "error" : allOk ? "ok" : "pending"} />
        <Text style={styles.cardTitle}>B: Paging FlatList + flex:1</Text>
      </View>
      <FlatList
        // key={renderKey}
        data={PAGES}
        renderItem={renderPage}
        // keyExtractor={(item) => `${renderKey}-${item.id}`}
        horizontal
        pagingEnabled
        style={{ flex: 1, minHeight: 0 }}
        showsHorizontalScrollIndicator={false}
      />
    </View>
  );
}

// ─── PR #45 smoke: auto size, fixed box scale-down, prop churn, callback identity ─
function CasePR45Smoke() {
  const [latexIdx, setLatexIdx] = useState(0);
  const [displayMode, setDisplayMode] = useState(true);
  /** Bump to give `onContentSizeChange` a new function identity (Paper / emitter edge cases). */
  const [handlerGen, setHandlerGen] = useState(0);
  const [last, setLast] = useState<{ w: number; h: number } | null>(null);
  const [evtCount, setEvtCount] = useState(0);
  const [fixedOk, setFixedOk] = useState<"pending" | "ok" | "error">("pending");

  const onContentSizeChange = useCallback(
    (e: { nativeEvent: { width: number; height: number } }) => {
      setLast({ w: e.nativeEvent.width, h: e.nativeEvent.height });
      setEvtCount((c) => c + 1);
    },
    [handlerGen]
  );

  return (
    <View style={[styles.card, styles.smokeCard]}>
      <View style={styles.cardHeader}>
        <StatusDot status={last && last.w > 0 && last.h > 0 ? "ok" : "pending"} />
        <Text style={styles.cardTitle}>PR #45 smoke (auto + scale-down)</Text>
      </View>
      <Text style={styles.smokeMeta}>
        Events #{evtCount} · intrinsic size{" "}
        {last ? `${last.w.toFixed(0)}×${last.h.toFixed(0)}` : "—"} · displayMode=
        {displayMode ? "block" : "inline"}
      </Text>
      <View style={styles.smokeRow}>
        <Pressable
          style={styles.smokeBtn}
          onPress={() => setLatexIdx((i) => (i + 1) % 3)}
        >
          <Text style={styles.smokeBtnText}>Next formula</Text>
        </Pressable>
        <Pressable
          style={styles.smokeBtn}
          onPress={() => setDisplayMode((d) => !d)}
        >
          <Text style={styles.smokeBtnText}>Toggle displayMode</Text>
        </Pressable>
        <Pressable
          style={styles.smokeBtn}
          onPress={() => setHandlerGen((g) => g + 1)}
        >
          <Text style={styles.smokeBtnText}>New callback ref</Text>
        </Pressable>
      </View>
      <Text style={styles.smokeHint}>
        {`After changing formula or mode, the counters above should update; after "New callback ref", you should still receive sizes (Paper / Fabric listener fix).`}
      </Text>
      <View style={styles.smokeAutoHost}>
        <RaTeXView
          latex={
            latexIdx === 0 ? EXPR : latexIdx === 1 ? EXPR2 : EXPR3
          }
          fontSize={22}
          displayMode={displayMode}
          onContentSizeChange={onContentSizeChange}
        />
      </View>
      <View style={styles.cardHeader}>
        <StatusDot status={fixedOk} />
        <Text style={styles.cardTitle}>Fixed 100×34 (scale down, no overflow)</Text>
      </View>
      <View style={styles.smokeFixedHost}>
        <RaTeXView
          latex={EXPR2}
          fontSize={26}
          displayMode={true}
          style={{ width: 100, height: 34 }}
          onContentSizeChange={(e) => {
            const { width, height } = e.nativeEvent;
            if (width > 0 && height > 0) setFixedOk("ok");
          }}
          onError={() => setFixedOk("error")}
        />
      </View>
    </View>
  );
}

// ─── InlineTeX custom font smoke: Expo prebuild assets/font(s) path ──
function CaseInlineTeXCustomFont() {
  return (
    <View style={[styles.card, styles.fontCard]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>InlineTeX custom font</Text>
      </View>
      <View style={styles.fontCaseBody}>
        <Text style={styles.fontCaseLabel}>React Native Text</Text>
        <Text style={styles.customFontText}>{INLINE_FONT_CONTENT}</Text>

        <Text style={styles.fontCaseLabel}>InlineTeX textStyle</Text>
        <InlineTeX
          content={INLINE_FONT_CONTENT}
          textStyle={styles.customFontText}
        />
      </View>
    </View>
  );
}

// ─── Inline baseline: RaTeXView in <Text> vs alignItems:'baseline' row ──
//
// Two embeddings of the same `$…$` fixtures, both using RaTeXView only:
//
// Red border — formulas embedded in <Text>: RN places an inline view with its
// BOTTOM on the text baseline, so any formula with descent ($y$, $y_i$,
// $\frac{a}{b}$…) floats UP by exactly that descent (current default).
//
// Blue border — word-level <Text> and RaTeXView siblings in a wrapping flex row
// with alignItems:'baseline': Yoga aligns children by baseline. Text provides a
// real one (ParagraphShadowNode::baseline); RaTeXView does not yet, so Yoga
// falls back to its bottom edge and the row shows the SAME float-up — until the
// native shadow-node baseline() lands, after which blue rows must align
// perfectly (the descender-twins line makes it obvious).
const INLINE_BASELINE_FONT_SIZE = 16;
const INLINE_BASELINE_PARAS = [
  String.raw`No descent at all: $x^2 + 1$ and $a + b = c$ should sit exactly like words.`,
  String.raw`Descender twins — compare y with $y$, p with $p$, g with $g$, q with $q$ in one line.`,
  String.raw`Subscripts hang below: $y_i$, deeper $a_{i_j}$, and chained $x_{n+1} = x_n - f(x_n)/f'(x_n)$ mid-sentence.`,
  String.raw`A fraction $\frac{a}{b}$ between words, a taller one $\frac{x^2+1}{x-1}$ next, and the quadratic $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$ to finish the line.`,
  String.raw`Radicals: plain $\sqrt{2}$, stacked $\sqrt{1 + \sqrt{x}}$, and with a descender inside $\sqrt{y_j}$.`,
  String.raw`Operators stay inline-styled: sum $\sum_{n=1}^{\infty} \frac{1}{n^2}$, integral $\int_0^1 x\,dx$, limit $\lim_{x \to 0} \frac{\sin x}{x} = 1$.`,
  String.raw`Tall ascent, no descent: $e^{x^2}$ and $2^{2^n}$ should not float above the line.`,
  String.raw`Big delimiters both ways: $\left(\frac{1}{1+x}\right)^2$ and $\left[\sum_k a_k\right]$ inside running text.`,
];

/** Renders a `$…$` paragraph as RN <Text> with RaTeXView children — the way a
 * markdown renderer embeds formulas. With alignSelf:'baseline' in the style
 * the view translates itself down by the engine-exact descent (sync metrics,
 * no probes) — the same style that baseline-aligns it as a flex sibling. */
function InlineDefaultParagraph({
  source,
  alignBaseline,
}: {
  source: string;
  alignBaseline?: boolean;
}) {
  // Even indices are plain text, odd indices are formula bodies.
  const parts = source.split(/\$([^$]+)\$/g);
  return (
    <Text selectable style={styles.inlineParaText}>
      {parts.map((part, i) =>
        i % 2 === 0 ? (
          part
        ) : (
          <RaTeXView
            key={i}
            latex={part}
            fontSize={INLINE_BASELINE_FONT_SIZE}
            displayMode={false}
            style={alignBaseline ? { alignSelf: "baseline" } : undefined}
            color="#111827"
          />
        )
      )}
    </Text>
  );
}

/** The same `$…$` paragraph as a wrapping flex row under alignItems:'baseline':
 * every word is its own <Text> sibling so Yoga (not the text engine) owns
 * placement and aligns each child by its baseline. */
function InlineBaselineRowParagraph({ source }: { source: string }) {
  const parts = source.split(/\$([^$]+)\$/g);
  const children: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      children.push(
        <RaTeXView
          key={`m${i}`}
          latex={part}
          fontSize={INLINE_BASELINE_FONT_SIZE}
          displayMode={false}
          color="#111827"
        />
      );
      return;
    }
    for (const [j, word] of part.split(/\s+/).filter(Boolean).entries()) {
      children.push(
        <Text selectable key={`t${i}-${j}`} style={styles.inlineParaText}>
          {word}
        </Text>
      );
    }
  });
  return <View style={styles.inlineBaselineRow}>{children}</View>;
}

function CaseInlineBaseline() {
  return (
    <View style={[styles.card, styles.inlineCard]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>
          Inline baseline: {"<Text>"} embed vs alignItems:'baseline'
        </Text>
      </View>
      <Text style={styles.smokeHint}>
        Amber and blue should match; red floats up. Watch the descender-twins
        line.
      </Text>
      <View style={styles.inlineLegend}>
        <Text style={[styles.inlineLegendLine, { color: "#ef4444" }]}>
          {"<Text>bla <RaTeXView/> bla</Text>"}
        </Text>
        <Text style={[styles.inlineLegendLine, { color: "#f59e0b" }]}>
          {"<Text>bla <RaTeXView style={{alignSelf:'baseline'}}/> bla</Text>"}
        </Text>
        <Text style={[styles.inlineLegendLine, { color: "#3b82f6" }]}>
          {"<View style={{flexDirection:'row', alignItems:'baseline'}}>\n  <Text>bla</Text> <RaTeXView/> ...\n</View>"}
        </Text>
      </View>
      <View style={styles.inlineBody}>
        {INLINE_BASELINE_PARAS.map((para, i) => (
          <View key={i} style={styles.inlinePair}>
            <View style={[styles.inlineRow, styles.inlineRowDefault]}>
              <InlineDefaultParagraph source={para} />
            </View>
            <View style={[styles.inlineRow, styles.inlineRowAligned]}>
              <InlineDefaultParagraph source={para} alignBaseline />
            </View>
            <View style={[styles.inlineRow, styles.inlineRowBaseline]}>
              <InlineBaselineRowParagraph source={para} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Baseline with a text line ABOVE the math line (3-line paragraphs) ────────
//
// Same three variants as the inline-baseline card, but each paragraph opens
// with a plain-text line, so the math line has a text neighbor above AND below.
// Exposes what the alignment approach does to interline spacing around a tall
// aligned formula.
const NEIGHBOR_PARAS = [
  String.raw`This opening line is plain running. Big delimiters both ways: $\left(\frac{1}{1+x}\right)^2$ and $\left[\sum_k a_k\right]$ inside running text.`,
  String.raw`This opening line is plain running. Big delimiters both ways: $\left[\sum_k a_k\right]$ inside running text.`,
];

function CaseInlineBaselineNeighbors() {
  return (
    <View style={[styles.card, styles.inlineCard]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>
          Baseline with a plain text line above (3-line wrap)
        </Text>
      </View>
      <Text style={styles.smokeHint}>
        Line 1 is text only; the tall formulas sit on line 2. Compare the
        spacing between lines 1–2 and 2–3 across the three variants.
      </Text>
      <View style={styles.inlineBody}>
        {NEIGHBOR_PARAS.map((para, i) => (
          <View key={i} style={styles.inlinePair}>
            <View style={[styles.inlineRow, styles.inlineRowDefault]}>
              <InlineDefaultParagraph source={para} />
            </View>
            <View style={[styles.inlineRow, styles.inlineRowAligned]}>
              <InlineDefaultParagraph source={para} alignBaseline />
            </View>
            <View style={[styles.inlineRow, styles.inlineRowBaseline]}>
              <InlineBaselineRowParagraph source={para} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── KNOWN ISSUE (not fixable): deep descender overdraws the next line ───────
//
// RN's text engine reserves only the run font's descender BELOW the baseline —
// an inline view has no way to ask for more (the attachment protocol carries no
// depth). A formula whose descent far exceeds the text descender therefore
// overdraws the following line in <Text> (amber), while a baseline flex row
// reserves the full depth and pushes the next line down (blue). Fixing this
// needs RN itself to learn attachment depth; everything above the baseline IS
// fixed (ascent-only measure).
const DEEP_PARAS = [
  String.raw`This opening line is plain running text with no math in it at all. A very deep tail mid-line: $x = \cfrac{1}{2+\cfrac{1}{3+\cfrac{1}{4+y}}}$ splits the sentence, and this trailing text wraps onto the line right below the formula's descender.`,
];

function CaseDeepDescenderOverdraw() {
  return (
    <View style={[styles.card, styles.inlineCard]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>
          Known issue (not fixable): deep descender overdraws the next line
        </Text>
      </View>
      <Text style={styles.smokeHint}>
        The continued fraction descends far below the text descender. Amber
        (in-Text): RN reserves only the font descender below the baseline, so
        the tail overdraws line 3. Blue (flex): the row reserves the full depth
        and line 3 moves down. Needs RN-side attachment depth to fix.
      </Text>
      <View style={styles.inlineBody}>
        {DEEP_PARAS.map((para, i) => (
          <View key={i} style={styles.inlinePair}>
            <View style={[styles.inlineRow, styles.inlineRowAligned]}>
              <InlineDefaultParagraph source={para} alignBaseline />
            </View>
            <View style={[styles.inlineRow, styles.inlineRowBaseline]}>
              <InlineBaselineRowParagraph source={para} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── In-<Text> alignSelf options: none / baseline / center / start / end ─────
//
// Inside <Text> the text engine pins an inline view's bottom to the baseline;
// the native view then offsets its own ink per style.alignSelf: 'baseline' is
// engine-exact, 'center' centers the box on the TeX math axis, 'flex-start' /
// 'flex-end' approximate text-top / text-bottom from the em. Same sentence per
// row — only alignSelf on the formulas changes.
const INLINE_ALIGN_OPTIONS = [
  undefined,
  "baseline",
  "center",
  "flex-start",
  "flex-end",
] as const;

function CaseInlineAlignOptions() {
  return (
    <View style={[styles.card, styles.inlineCard]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>In-Text alignSelf options</Text>
      </View>
      <Text style={styles.smokeHint}>
        One sentence per option — only style.alignSelf on the formulas changes.
      </Text>
      <View style={styles.inlineBody}>
        {INLINE_ALIGN_OPTIONS.map((align) => (
          <View key={align ?? "none"} style={styles.inlinePair}>
            <Text style={[styles.inlineLegendLine, { color: "#6b7280" }]}>
              {align ? `alignSelf: '${align}'` : "(no alignSelf)"}
            </Text>
            <Text style={styles.inlineParaText}>
              gap py{" "}
              <RaTeXView
                latex={String.raw`\sqrt{y_j}`}
                fontSize={INLINE_BASELINE_FONT_SIZE}
                displayMode={false}
                style={align ? { alignSelf: align } : undefined}
                color="#111827"
              />{" "}
              mid{" "}
              <RaTeXView
                latex={String.raw`\frac{x^2+1}{x-1}`}
                fontSize={INLINE_BASELINE_FONT_SIZE}
                displayMode={false}
                style={align ? { alignSelf: align } : undefined}
                color="#111827"
              />{" "}
              end gy
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Baseline × font size mix: alignment must be fontSize-independent ─────
//
// The shift is computed from the formula's own metrics at its own fontSize, so
// it must hold when text and math sizes differ (the text engine pins the view
// bottom to the baseline regardless of either size). Amber (in <Text>) and
// blue (flex baseline row) must match in every combination.
const FONT_MIX_CASES = [
  { label: "text 32 / math 32", text: 32, math: 32 },
  { label: "text 32 / math 16", text: 32, math: 16 },
  { label: "text 16 / math 32", text: 16, math: 32 },
];

function CaseInlineFontMix() {
  return (
    <View style={[styles.card, styles.inlineCard]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>Baseline × font size mix</Text>
      </View>
      <Text style={styles.smokeHint}>
        alignSelf:'baseline' with differing text/math sizes — amber and blue
        must match in every combination.
      </Text>
      <View style={styles.inlineBody}>
        {FONT_MIX_CASES.map(({ label, text, math }) => (
          <View key={label} style={styles.inlinePair}>
            <Text style={[styles.inlineLegendLine, { color: "#6b7280" }]}>
              {label}
            </Text>
            <View style={[styles.inlineRow, styles.inlineRowAligned]}>
              <Text style={[styles.inlineParaText, { fontSize: text }]}>
                gap py{" "}
                <RaTeXView
                  latex={String.raw`\sqrt{y_j}`}
                  fontSize={math}
                  displayMode={false}
                  style={{ alignSelf: "baseline" }}
                  color="#111827"
                />{" "}
                mid{" "}
                <RaTeXView
                  latex={String.raw`\frac{x^2+1}{x-1}`}
                  fontSize={math}
                  displayMode={false}
                  style={{ alignSelf: "baseline" }}
                  color="#111827"
                />{" "}
                end gy
              </Text>
            </View>
            <View style={[styles.inlineRow, styles.inlineRowBaseline]}>
              <View style={styles.inlineBaselineRow}>
                <Text style={[styles.inlineParaText, { fontSize: text }]}>
                  gap py
                </Text>
                <RaTeXView
                  latex={String.raw`\sqrt{y_j}`}
                  fontSize={math}
                  displayMode={false}
                  color="#111827"
                />
                <Text style={[styles.inlineParaText, { fontSize: text }]}>
                  mid
                </Text>
                <RaTeXView
                  latex={String.raw`\frac{x^2+1}{x-1}`}
                  fontSize={math}
                  displayMode={false}
                  color="#111827"
                />
                <Text style={[styles.inlineParaText, { fontSize: text }]}>
                  end gy
                </Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── maxWidth autoscaling × baseline ─────
//
// A width-clamped formula downscales its ink (fit-scale, never up) and centers
// it inside the assigned box, so the ink baseline moves: the in-<Text> shift
// must anchor the SCALED ink baseline plus the centering gap, and the flex
// baseline() mirrors the same fit math. Control (unclamped) rows first.
const MAXW_LATEX = String.raw`x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}`;

function MaxWidthPair({
  label,
  maxWidth,
}: {
  label: string;
  maxWidth?: number;
}) {
  return (
    <View style={styles.inlinePair}>
      <Text style={[styles.inlineLegendLine, { color: "#6b7280" }]}>
        {label}
      </Text>
      <View style={[styles.inlineRow, styles.inlineRowAligned]}>
        <Text style={styles.inlineParaText}>
          gap py{" "}
          <RaTeXView
            latex={MAXW_LATEX}
            fontSize={INLINE_BASELINE_FONT_SIZE}
            displayMode={false}
            style={{ alignSelf: "baseline", maxWidth }}
            color="#111827"
          />{" "}
          end gy
        </Text>
      </View>
      <View style={[styles.inlineRow, styles.inlineRowBaseline]}>
        <View style={styles.inlineBaselineRow}>
          <Text style={styles.inlineParaText}>gap py</Text>
          <RaTeXView
            latex={MAXW_LATEX}
            fontSize={INLINE_BASELINE_FONT_SIZE}
            displayMode={false}
            style={{ maxWidth }}
            color="#111827"
          />
          <Text style={styles.inlineParaText}>end gy</Text>
        </View>
      </View>
    </View>
  );
}

function CaseInlineMaxWidth() {
  return (
    <View style={[styles.card, styles.inlineCard]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>maxWidth autoscaling × baseline</Text>
      </View>
      <Text style={styles.smokeHint}>
        The clamped formula scales its ink down; the scaled baseline must still
        sit on the text baseline in both host contexts.
      </Text>
      <View style={styles.inlineBody}>
        <MaxWidthPair label="no clamp (control)" />
        <MaxWidthPair label="maxWidth: 90 (≈0.6× ink scale)" maxWidth={90} />
        <MaxWidthPair label="maxWidth: 60 (≈0.4× ink scale)" maxWidth={60} />
      </View>
    </View>
  );
}

// ─── Yoga alignment variants: RaTeXView as a regular flex child ─────
//
// The shadow-node baseline() only changes what `baseline` alignment sees; every
// other align value must keep its usual Yoga meaning. One row per value, with a
// short-and-deep formula ($y_j$) and a tall fraction between text runs whose
// descenders (g, p, y) make the baseline row easy to judge. The last row uses
// alignSelf: 'baseline' per child (container centers) — per-child opt-in works
// the same way as container-level alignItems.
// Narrow style type: the RaTeXView style prop resolves against the symlinked
// library's own react-native types, which structurally clash with the demo's on
// unrelated fields (boxShadow) — a subset type is assignable to both.
type ChildAlign = {
  alignSelf?: "auto" | "flex-start" | "flex-end" | "center" | "stretch" | "baseline";
};

const ALIGN_SAMPLES: {
  label: string;
  container: ViewStyle;
  child?: ChildAlign;
}[] = [
  { label: "alignItems: 'flex-start'", container: { alignItems: "flex-start" } },
  { label: "alignItems: 'center'", container: { alignItems: "center" } },
  { label: "alignItems: 'flex-end'", container: { alignItems: "flex-end" } },
  { label: "alignItems: 'baseline'", container: { alignItems: "baseline" } },
  {
    label: "alignSelf: 'baseline' on each child, container centers",
    container: { alignItems: "center" },
    child: { alignSelf: "baseline" },
  },
];

function AlignSampleRow({
  container,
  child,
}: {
  container: ViewStyle;
  child?: ChildAlign;
}) {
  return (
    <View style={[styles.alignRow, container]}>
      <Text style={[styles.inlineParaText, child]}>gap py</Text>
      <RaTeXView
        latex="y_j"
        fontSize={INLINE_BASELINE_FONT_SIZE}
        displayMode={false}
        color="#111827"
        style={child}
      />
      <Text style={[styles.inlineParaText, child]}>mid</Text>
      <RaTeXView
        latex={String.raw`\frac{x^2+1}{x-1}`}
        fontSize={INLINE_BASELINE_FONT_SIZE}
        displayMode={false}
        color="#111827"
        style={child}
      />
      <Text style={[styles.inlineParaText, child]}>end g</Text>
    </View>
  );
}

function CaseYogaAligns() {
  return (
    <View style={[styles.card, styles.inlineCard]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>Yoga aligns: RaTeXView as flex child</Text>
      </View>
      <Text style={styles.smokeHint}>
        Each row is flexDirection:'row' with the align value below it. The tall
        fraction gives the row height contrast; 'baseline' (and per-child
        alignSelf:'baseline') should line the formulas up with the text like
        glyphs, the rest keep their usual box meaning.
      </Text>
      <View style={styles.inlineBody}>
        {ALIGN_SAMPLES.map((sample) => (
          <View key={sample.label}>
            <AlignSampleRow container={sample.container} child={sample.child} />
            <Text style={styles.alignLabel}>{sample.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── ref.getTexMetrics(): drawn ink baseline for custom hosts ────────────────
//
// Hosts that do their own layout (markdown engines placing formulas over a
// custom text view, canvas typesetters) can't use flex baseline or <Text>.
// getTexMetrics() hands them the placement numbers synchronously in
// useLayoutEffect. The green ruler is positioned purely from the returned
// depth — it must kiss the ink baseline at every clamp width, because depth
// is DRAWN: fit-scale and centering gap for the committed frame are already
// applied (drawnDepth = gap + naturalDepth × scale).
const METRICS_LATEX = String.raw`\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}`;
const METRICS_WIDTHS = [undefined, 200, 140, 90] as const;

function TexMetricsRow({ maxWidth }: { maxWidth?: number }) {
  const ref = useRef<RaTeXViewRef>(null);
  const [probe, setProbe] = useState<{
    metrics: RaTeXTexMetrics;
    frameHeight: number;
  } | null>(null);

  useLayoutEffect(() => {
    const metrics = ref.current?.getTexMetrics();
    let frameHeight = 0;
    ref.current?.measure((_x, _y, _w, h) => {
      frameHeight = h; // sync on Fabric
    });
    setProbe(metrics && frameHeight > 0 ? { metrics, frameHeight } : null);
  }, [maxWidth]);

  return (
    <View style={styles.metricsRow}>
      <View style={styles.metricsBox}>
        <RaTeXView
          ref={ref}
          latex={METRICS_LATEX}
          fontSize={24}
          displayMode={false}
          color="#111827"
          style={{ alignSelf: "flex-start", maxWidth }}
        />
        {probe && (
          <View
            style={[
              styles.metricsBaseline,
              { top: probe.frameHeight - probe.metrics.depth },
            ]}
          />
        )}
      </View>
      <Text style={styles.metricsLabel}>
        {maxWidth ? `maxWidth ${maxWidth}` : "natural"}
        {probe
          ? ` · scale ${probe.metrics.scale.toFixed(2)} · depth ${probe.metrics.depth.toFixed(1)}`
          : " · …"}
      </Text>
    </View>
  );
}

function CaseTexMetrics() {
  return (
    <View style={[styles.card, styles.inlineCard]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>
          ref.getTexMetrics(): ink baseline for custom hosts
        </Text>
      </View>
      <Text style={styles.smokeHint}>
        The green ruler is placed only from getTexMetrics().depth (top =
        frameHeight − depth). It must sit on the ink baseline in every row —
        including the clamped ones, where the drawn depth shrinks with scale.
      </Text>
      <View style={styles.inlineBody}>
        {METRICS_WIDTHS.map((w) => (
          <TexMetricsRow key={w ?? "natural"} maxWidth={w} />
        ))}
      </View>
    </View>
  );
}

// ─── getTexMetrics() perf: uncached vs cached, N unique formulas ─────
const PERF_SIZES = [10, 50, 100, 200];
const PERF_REPS = 5;

// Every formula has the SAME shape/size (unique only via the embedded
// nonce/index digits) so per-formula cost is comparable across N.
function makePerfFormulas(n: number, nonce: number): string[] {
  return Array.from(
    { length: n },
    (_, i) =>
      String.raw`\frac{${nonce}x_{${i}} + \sqrt{${(i % 7) + 2}}}{y^{${(i % 5) + 2}} - ${nonce}} + \sum_{k=1}^{${(i % 4) + 2}} k^{${(i % 3) + 2}}`,
  );
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

type PerfRow = { n: number; uncachedMs: number; cachedMs: number; failed: number };

function CaseTexMetricsPerf() {
  const [rows, setRows] = useState<PerfRow[] | null>(null);
  const nonceRef = useRef(1);

  const run = useCallback(() => {
    // Warmup: ramps the CPU governor and JIT before anything is timed.
    for (const f of makePerfFormulas(100, nonceRef.current++)) {
      getTexMetrics(f, 16, false);
    }
    const out: PerfRow[] = [];
    for (const n of PERF_SIZES) {
      const uncached: number[] = [];
      const cached: number[] = [];
      let failed = 0;
      for (let rep = 0; rep < PERF_REPS; rep++) {
        const formulas = makePerfFormulas(n, nonceRef.current++);
        const t0 = performance.now();
        for (const f of formulas) {
          if (!getTexMetrics(f, 16, false)) failed++;
        }
        const t1 = performance.now();
        for (const f of formulas) {
          getTexMetrics(f, 16, false);
        }
        uncached.push(t1 - t0);
        cached.push(performance.now() - t1);
      }
      out.push({
        n,
        uncachedMs: median(uncached),
        cachedMs: median(cached),
        failed,
      });
    }
    setRows(out);
  }, []);

  return (
    <View style={[styles.card, styles.inlineCard]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>getTexMetrics() perf (global)</Text>
      </View>
      <Text style={styles.smokeHint}>
        Warmup, then per N: 5 reps of (N unique formulas cold, same N again
        cached); medians shown. Parse cache holds 128 entries — at N=200 the
        second pass thrashes the LRU, so "cached" ≈ uncached there.
      </Text>
      <Pressable style={styles.button} onPress={run}>
        <Text style={styles.buttonText}>Run perf test</Text>
      </Pressable>
      {rows && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
          {rows.map((r) => (
            <Text key={r.n} style={styles.perfLine}>
              {`N=${String(r.n).padStart(3)}  uncached ${r.uncachedMs.toFixed(1)}ms (${(r.uncachedMs / r.n).toFixed(2)}/f)  cached ${r.cachedMs.toFixed(1)}ms (${(r.cachedMs / r.n).toFixed(3)}/f)${r.failed ? `  failed=${r.failed}` : ""}`}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Case C: Explicit dimensions (control — should always work) ─────
function CaseExplicit({ renderKey }: { renderKey: number }) {
  const [status, setStatus] = useState<"pending" | "ok" | "error">("pending");

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <StatusDot status={status} />
        <Text style={styles.cardTitle}>C: Explicit 300x60 (control)</Text>
      </View>
      <View style={{ alignItems: "center", padding: 12 }}>
        <RaTeXView
          // key={renderKey}
          latex={EXPR}
          fontSize={28}
          displayMode={true}
          style={{ width: 200, height: 60 }}
          onContentSizeChange={(e) => {
            const { width, height } = e.nativeEvent;
            console.log(`[C] size: ${width}x${height}`);
            if (width > 0 && height > 0) setStatus("ok");
          }}
          onError={(e) => {
            console.error(`[C] error:`, e.nativeEvent.error);
            setStatus("error");
          }}
        />
      </View>
    </View>
  );
}

// ─── App ─────────────────────────────────────────────────────────────
export default function App() {
  const [key, setKey] = useState(0);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>RaTeX Repro — Issues #120 / #42</Text>
        <Text style={styles.subtitle}>
          Render #{key} — gray dot = pending, green = rendered, red = error
        </Text>

        <Pressable style={styles.button} onPress={() => setKey((k) => k + 1)}>
          <Text style={styles.buttonText}>Force Re-mount (key={key + 1})</Text>
        </Pressable>

        <CaseStreamingMath />
        <CaseDetachCancel />
        <CaseLayoutEffectMeasure />
        <CasePR45Smoke />
        <CaseInlineTeXCustomFont />
        <CaseInlineBaseline />
        <CaseInlineBaselineNeighbors />
        <CaseDeepDescenderOverdraw />
        <CaseInlineAlignOptions />
        <CaseInlineFontMix />
        <CaseInlineMaxWidth />
        <CaseYogaAligns />
        <CaseTexMetrics />
        <CaseTexMetricsPerf />

        <View style={styles.cases}>
          <CaseFlexMinHeight renderKey={key} />
          <CaseFlatList renderKey={key} />
          <CaseExplicit renderKey={key} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 12,
  },
  subtitle: {
    fontSize: 12,
    color: "#666",
    textAlign: "center",
    marginTop: 2,
    marginBottom: 8,
  },
  button: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    alignSelf: "center",
    marginBottom: 8,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  cases: {
    flexGrow: 1,
    minHeight: 520,
    padding: 12,
    gap: 12,
  },
  measureCard: {
    flex: 0,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 8,
    paddingBottom: 12,
  },
  measureHint: {
    fontSize: 10,
    color: "#6b7280",
    paddingHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  measureBody: {
    paddingHorizontal: 12,
  },
  measureStage: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
  },
  measureHost: {
    position: "relative",
  },
  decoFrame: {
    position: "absolute",
    left: 0,
    top: 0,
    borderWidth: 2,
    borderColor: "#e11d48",
    borderStyle: "dashed",
    borderRadius: 2,
  },
  decoBaseline: {
    position: "absolute",
    left: 0,
    height: 2,
    backgroundColor: "#2563eb",
  },
  measureMeta: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
    textAlign: "center",
    marginTop: 4,
  },
  smokeCard: {
    flex: 0,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 8,
    paddingBottom: 12,
  },
  streamCard: {
    flex: 0,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 8,
    paddingBottom: 12,
  },
  streamHint: {
    fontSize: 11,
    color: "#4b5563",
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  streamStage: {
    // Fixed height + top/left alignment: the card never resizes and the
    // formula's top-left corner never moves, so the only thing that CAN move
    // is the content inside the RaTeXView — the artifact under test.
    // Deliberately shorter than the full 8-line block (~363dp at fontSize 20):
    // the last appends also exercise the clamped case, where the content must
    // scale to fit its container uniformly and without flicker.
    height: 340,
    alignItems: "flex-start",
    justifyContent: "flex-start",
    paddingHorizontal: 12,
    overflow: "hidden",
  },
  streamStageAuto: {
    // No fixed height: the stage grows with the content, exercising the
    // auto-sizing streaming path (no clamp, no scale-to-fit).
    height: "auto",
  },
  streamCheckbox: {
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  streamCheckboxText: {
    fontSize: 13,
    color: "#111827",
  },
  detachCard: {
    flex: 0,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 8,
    paddingBottom: 12,
  },
  detachMeta: {
    fontSize: 11,
    color: "#4b5563",
    alignSelf: "center",
  },
  detachStrip: {
    marginHorizontal: 12,
    marginTop: 4,
  },
  detachBox: {
    width: 148,
    height: 76,
    marginRight: 8,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#d1d5db",
    backgroundColor: "#f9fafb",
    alignItems: "center",
    justifyContent: "center",
  },
  detachFormula: {
    width: 136,
    height: 52,
  },
  detachIndex: {
    position: "absolute",
    top: 2,
    right: 5,
    fontSize: 9,
    color: "#9ca3af",
  },
  detachChunk: {
    width: 64,
    height: 76,
    marginRight: 8,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#bfdbfe",
    backgroundColor: "#eff6ff",
    alignItems: "center",
    justifyContent: "center",
  },
  detachChunkText: {
    fontSize: 10,
    color: "#3b82f6",
  },
  detachErrors: {
    fontSize: 10,
    color: "#ef4444",
    paddingHorizontal: 12,
    marginTop: 6,
  },
  smokeMeta: {
    fontSize: 11,
    color: "#4b5563",
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  smokeHint: {
    fontSize: 10,
    color: "#6b7280",
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  smokeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  smokeBtn: {
    backgroundColor: "#0d9488",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  smokeBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  smokeAutoHost: {
    alignItems: "center",
    paddingVertical: 8,
    minHeight: 56,
  },
  smokeFixedHost: {
    alignItems: "center",
    paddingBottom: 8,
  },
  inlineCard: {
    flex: 0,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 8,
    paddingBottom: 12,
  },
  inlineBody: {
    paddingHorizontal: 12,
    gap: 12,
  },
  inlinePair: {
    gap: 4,
  },
  inlineRow: {
    borderLeftWidth: 3,
    paddingLeft: 8,
    paddingVertical: 2,
  },
  inlineRowDefault: {
    borderLeftColor: "#ef4444",
  },
  inlineRowAligned: {
    borderLeftColor: "#f59e0b",
  },
  inlineLegend: {
    paddingHorizontal: 12,
    marginBottom: 8,
    gap: 3,
  },
  inlineLegendLine: {
    fontSize: 11,
    fontFamily: "Menlo",
  },
  inlineRowBaseline: {
    borderLeftColor: "#3b82f6",
  },
  inlineBaseLineText: {
    alignItems: "baseline",
  },
  inlineBaselineRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: 4,
    rowGap: 2,
  },
  alignRow: {
    flexDirection: "row",
    columnGap: 6,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  alignLabel: {
    fontSize: 11,
    color: "#6b7280",
    fontFamily: "Menlo",
    marginTop: 2,
  },
  metricsRow: {
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  metricsBox: {
    alignSelf: "flex-start",
  },
  metricsBaseline: {
    position: "absolute",
    left: -8,
    right: -8,
    height: 1,
    backgroundColor: "#ffb981",
  },
  metricsLabel: {
    fontSize: 11,
    color: "#6b7280",
    fontFamily: "Menlo",
    marginTop: 4,
  },
  perfLine: {
    fontSize: 11,
    color: "#111827",
    fontFamily: "Menlo",
    marginTop: 4,
  },
  inlineParaText: {
    fontSize: INLINE_BASELINE_FONT_SIZE,
    // No lineHeight: RN iOS centers glyphs in a custom lineHeight via a
    // baselineOffset the attachment placement ignores, sinking every inline
    // view by (lineHeight - fontLineHeight) / 2 (RN core bug).
    //
    // overflow visible: RN <Text> defaults to overflow:'hidden', and on iOS
    // the paragraph clips its inline-view attachments to its own bounds — a
    // baseline-aligned formula whose descent exceeds the text descender (e.g.
    // math bigger than text) would lose its ink below the last line.
    overflow: "visible",
    color: "#111827",
  },
  fontCard: {
    flex: 0,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 8,
  },
  fontCaseBody: {
    gap: 8,
    padding: 12,
  },
  fontCaseLabel: {
    color: "#4b5563",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  customFontText: {
    color: "#111827",
    fontFamily: INLINE_FONT_FAMILY,
    fontSize: 17,
  },
  card: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  flatListPage: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
});
