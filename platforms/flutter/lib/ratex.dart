import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'src/display_list.dart';
import 'src/ratex_ffi.dart' if (dart.library.js_interop) 'src/ratex_web.dart'
    as backend;
import 'src/ratex_native_init.dart'
    if (dart.library.js_interop) 'src/ratex_web_init.dart' as init;
import 'src/ratex_exception.dart';
import 'src/ratex_painter.dart';

export 'src/display_list.dart';
export 'src/ratex_exception.dart';

/// Process-scoped LRU cache for parsed-and-laid-out [DisplayList]s.
/// Keyed on `(latex, fontSize, displayMode, maxWidthEm)` — color is intentionally
/// excluded because it's applied at paint time, not layout time.
/// Two formulas with the same source/fontSize/displayMode but different
/// colors share a cache entry (the paint pass overrides color anyway).
/// Best-effort: a miss falls through to the isolate renderer.
class RaTeXRenderCache {
  RaTeXRenderCache({int maxSize = 64}) : _maxSize = maxSize;

  final int _maxSize;
  final _cache = <String, DisplayList>{};

  String _key(String latex, double fontSize, bool displayMode,
          double? maxWidthEm) =>
      '$latex\x00$fontSize\x00$displayMode\x00$maxWidthEm';

  DisplayList? get(String latex, double fontSize, bool displayMode,
      [double? maxWidthEm]) {
    final key = _key(latex, fontSize, displayMode, maxWidthEm);
    final dl = _cache.remove(key);
    if (dl != null) _cache[key] = dl; // move to end (most-recently-used)
    return dl;
  }

  void put(String latex, double fontSize, bool displayMode, DisplayList dl,
      [double? maxWidthEm]) {
    final key = _key(latex, fontSize, displayMode, maxWidthEm);
    _cache.remove(key); // remove old entry if present
    _cache[key] = dl;
    if (_cache.length > _maxSize) {
      _cache.remove(_cache.keys.first); // evict least-recently-used
    }
  }

  void clear() => _cache.clear();

  int get length => _cache.length;
}

/// Process-wide render cache shared by all [RaTeXWidget] instances.
/// ponytail: a global singleton is the simplest process-scoped cache.
/// If isolates ever need their own cache, pass it via the isolate args.
final raTeXRenderCache = RaTeXRenderCache();

/// Coerces any render-time failure into a [RaTeXException] so the
/// `onError` callback and raw-value fallback receive a uniform type.
/// A [RaTeXException] is passed through unchanged; everything else
/// (`StateError`, JS-interop failures, missing-library errors) is
/// wrapped with its string representation so the message survives.
RaTeXException coerceRenderError(Object error) {
  if (error is RaTeXException) return error;
  return RaTeXException(error.toString());
}

RaTeXColor _toRaTeXColor(Color color) => RaTeXColor(
      color.red / 255.0, // ignore: deprecated_member_use
      color.green / 255.0, // ignore: deprecated_member_use
      color.blue / 255.0, // ignore: deprecated_member_use
      color.alpha / 255.0, // ignore: deprecated_member_use
    );

// MARK: - Initialization

/// Initialize the RaTeX engine.
///
/// On web, this loads the WASM module (must be called before any rendering).
/// On native platforms, this is a no-op.
///
/// Call this once in `main()` before `runApp()`:
/// ```dart
/// void main() async {
///   await initRaTeX();
///   runApp(MyApp());
/// }
/// ```
Future<void> initRaTeX() => init.initRaTeXWeb();

// MARK: - Engine

class RaTeXEngine {
  static final RaTeXEngine instance = RaTeXEngine._();
  RaTeXEngine._();

  // ponytail: only one consumer (instance.parseAndLayout); the impl class
  // shape is enforced by the conditional import. dynamic beats an interface
  // with one method.
  final dynamic _backend = backend.createBackend();

  DisplayList parseAndLayout(
    String latex, {
    bool displayMode = true,
    Color color = const Color(0xFF000000),
    double? maxWidthEm,
  }) =>
      _backend.parseAndLayout(
        latex,
        displayMode: displayMode,
        color: _toRaTeXColor(color),
        maxWidthEm: maxWidthEm,
      );
}

@immutable
class RaTeXParseAndLayoutIsolateArgs {
  const RaTeXParseAndLayoutIsolateArgs({
    required this.latex,
    required this.displayMode,
    this.maxWidthEm,
    this.colorArgb,
  });

  final String latex;
  final bool displayMode;
  final double? maxWidthEm;

  final int? colorArgb;
}

DisplayList ratexParseAndLayoutInIsolate(RaTeXParseAndLayoutIsolateArgs args) {
  final color =
      args.colorArgb == null ? const Color(0xFF000000) : Color(args.colorArgb!);
  return RaTeXEngine.instance.parseAndLayout(
    args.latex,
    displayMode: args.displayMode,
    color: color,
    maxWidthEm: args.maxWidthEm,
  );
}

// MARK: - Stateful widget

class RaTeXWidget extends StatefulWidget {
  final String latex;
  final double fontSize;
  final bool displayMode;
  final Color? color;

  /// Available width in logical pixels for automatic line wrapping.
  final double? maxWidth;
  final void Function(RaTeXException)? onError;

  /// Optional contrasting color drawn as a glyph-level stroke
  /// behind every item in the formula. Pass the plot's
  /// background color so the label stays readable when it
  /// crosses a curve, grid line, or axis. Set `null` (default)
  /// to skip the halo pass.
  final Color? haloColor;

  /// Halo stroke width in logical pixels. Ignored when
  /// [haloColor] is `null`. Defaults to `3.0` (matches
  /// plotter's `paintTextWithHalo`).
  final double haloWidth;

  const RaTeXWidget({
    super.key,
    required this.latex,
    this.fontSize = 24,
    this.displayMode = true,
    this.color,
    this.maxWidth,
    this.haloColor,
    this.haloWidth = 3.0,
    this.onError,
  });

  @override
  State<RaTeXWidget> createState() => _RaTeXWidgetState();
}

class _RaTeXWidgetState extends State<RaTeXWidget> {
  DisplayList? _displayList;
  RaTeXException? _error;
  Color? _lastInheritedColor;
  int _renderGeneration = 0;

  @override
  void initState() {
    super.initState();
    if (widget.color != null) {
      _render();
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (widget.color != null) {
      _lastInheritedColor = null;
      return;
    }

    final inheritedColor = _inheritedColor;
    if (_lastInheritedColor != inheritedColor) {
      _lastInheritedColor = inheritedColor;
      _render();
    }
  }

  @override
  void didUpdateWidget(RaTeXWidget old) {
    super.didUpdateWidget(old);
    if (old.latex != widget.latex ||
        old.fontSize != widget.fontSize ||
        old.displayMode != widget.displayMode ||
        old.maxWidth != widget.maxWidth ||
        old.color != widget.color) {
      _lastInheritedColor = widget.color == null ? _inheritedColor : null;
      _render();
    }
  }

  Color get _inheritedColor =>
      DefaultTextStyle.of(context).style.color ?? Colors.black;

  Future<void> _render() async {
    final generation = ++_renderGeneration;
    // Check the render cache first — a hit skips the isolate hop.
    final cached = raTeXRenderCache.get(
      widget.latex,
      widget.fontSize,
      widget.displayMode,
      _maxWidthEm,
    );
    if (cached != null) {
      if (!mounted || generation != _renderGeneration) return;
      setState(() {
        _displayList = cached;
        _error = null;
      });
      return;
    }
    try {
      final resolvedColor = widget.color ?? _inheritedColor;
      final dl = await compute(
        ratexParseAndLayoutInIsolate,
        RaTeXParseAndLayoutIsolateArgs(
          latex: widget.latex,
          displayMode: widget.displayMode,
          maxWidthEm: _maxWidthEm,
          colorArgb: resolvedColor.value, // ignore: deprecated_member_use
        ),
      );
      // Drop stale results: only the most recent render may update state.
      if (!mounted || generation != _renderGeneration) return;
      // Cache the result for future renders.
      raTeXRenderCache.put(
        widget.latex,
        widget.fontSize,
        widget.displayMode,
        dl,
        _maxWidthEm,
      );
      setState(() {
        _displayList = dl;
        _error = null;
      });
    } on RaTeXException catch (e) {
      // Stale errors should not clobber the current state or surface to callers.
      if (!mounted || generation != _renderGeneration) return;
      widget.onError?.call(e);
      setState(() {
        _error = e;
      });
    } catch (e) {
      // Phase 7C: non-RaTeXException failures (StateError, JS-interop
      // errors, missing native libs) previously bypassed onError and
      // the raw-value fallback. Coerce into RaTeXException so they
      // funnel into the same path. A bare catch is broader than
      // `on Exception`/`on Error` but simpler — any render failure
      // should fall back, not crash the app.
      if (!mounted || generation != _renderGeneration) return;
      final wrapped = coerceRenderError(e);
      widget.onError?.call(wrapped);
      setState(() {
        _error = wrapped;
      });
    }
  }

  double? get _maxWidthEm {
    final maxWidth = widget.maxWidth;
    if (maxWidth == null || !maxWidth.isFinite || maxWidth <= 0) return null;
    return maxWidth / widget.fontSize;
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Text('RaTeX error: ${_error!.message}',
          style: const TextStyle(color: Colors.red, fontSize: 12));
    }
    final dl = _displayList;
    if (dl == null) {
      // Reserve vertical space during loading so surrounding widgets
      // don't shift when the formula pops in. 1.4x font size is a
      // reasonable line-height estimate for a single-line formula.
      return Semantics(
        label: widget.latex,
        child: SizedBox(height: widget.fontSize * 1.4),
      );
    }
    final painter = RaTeXPainter(
      displayList: dl,
      fontSize: widget.fontSize,
      haloColor: widget.haloColor,
      haloWidth: widget.haloWidth,
    );
    final maxWidth = widget.maxWidth;
    final scale = maxWidth != null && maxWidth.isFinite && maxWidth > 0
        ? (maxWidth / painter.widthPx).clamp(0.0, 1.0)
        : 1.0;
    if (scale < 1.0 && scale >= 0.75) {
      return Semantics(
        label: widget.latex,
        child: SizedBox(
          width: maxWidth,
          height: painter.totalHeightPx * scale,
          child: Align(
            alignment: Alignment.centerLeft,
            child: Transform.scale(
              alignment: Alignment.centerLeft,
              scale: scale,
              child: SizedBox(
                width: painter.widthPx,
                height: painter.totalHeightPx,
                child: CustomPaint(painter: painter),
              ),
            ),
          ),
        ),
      );
    }
    return Semantics(
      label: widget.latex,
      child: SizedBox(
        width: painter.widthPx,
        height: painter.totalHeightPx,
        child: CustomPaint(painter: painter),
      ),
    );
  }
}
