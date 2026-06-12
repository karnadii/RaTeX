import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'src/display_list.dart';
import 'src/ratex_backend.dart';
import 'src/ratex_ffi.dart' if (dart.library.js_interop) 'src/ratex_web.dart'
    as backend;
import 'src/ratex_native_init.dart'
    if (dart.library.js_interop) 'src/ratex_web_init.dart' as init;
import 'src/ratex_exception.dart';
import 'src/ratex_painter.dart';

export 'src/display_list.dart';
export 'src/ratex_exception.dart';

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

  final RaTeXBackend _backend = backend.createBackend();

  DisplayList parseAndLayout(
    String latex, {
    bool displayMode = true,
    Color color = const Color(0xFF000000),
  }) =>
      _backend.parseAndLayout(
        latex,
        displayMode: displayMode,
        color: _toRaTeXColor(color),
      );
}

typedef RaTeXParseAndLayoutArgs = ({
  String latex,
  bool displayMode,
  int colorValue,
});

@immutable
class RaTeXParseAndLayoutIsolateArgs {
  const RaTeXParseAndLayoutIsolateArgs({
    required this.latex,
    required this.displayMode,
    this.colorArgb,
  });

  final String latex;
  final bool displayMode;

  final int? colorArgb;
}

DisplayList ratexParseAndLayoutInIsolate(Object args) {
  final RaTeXParseAndLayoutIsolateArgs resolved = switch (args) {
    final RaTeXParseAndLayoutIsolateArgs a => a,
    (:final String latex, :final bool displayMode, :final int colorValue) =>
      RaTeXParseAndLayoutIsolateArgs(
        latex: latex,
        displayMode: displayMode,
        colorArgb: colorValue,
      ),
    _ => throw ArgumentError.value(
        args,
        'args',
        'Expected RaTeXParseAndLayoutIsolateArgs or '
            '({String latex, bool displayMode, int colorValue}).',
      ),
  };
  final color = resolved.colorArgb == null
      ? const Color(0xFF000000)
      : Color(resolved.colorArgb!);
  return RaTeXEngine.instance.parseAndLayout(
    resolved.latex,
    displayMode: resolved.displayMode,
    color: color,
  );
}

// MARK: - Stateful widget

class RaTeXWidget extends StatefulWidget {
  final String latex;
  final double fontSize;
  final bool displayMode;
  final Color? color;
  final Widget? loading;
  final void Function(RaTeXException)? onError;

  const RaTeXWidget({
    super.key,
    required this.latex,
    this.fontSize = 24,
    this.displayMode = true,
    this.color,
    this.loading,
    this.onError,
  });

  @override
  State<RaTeXWidget> createState() => _RaTeXWidgetState();
}

class _RaTeXWidgetState extends State<RaTeXWidget> {
  DisplayList? _displayList;
  RaTeXException? _error;
  Color? _lastInheritedColor;

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
        old.color != widget.color) {
      _lastInheritedColor = widget.color == null ? _inheritedColor : null;
      _render();
    }
  }

  Color get _inheritedColor =>
      DefaultTextStyle.of(context).style.color ?? Colors.black;

  Future<void> _render() async {
    try {
      final resolvedColor = widget.color ?? _inheritedColor;
      final dl = await compute(
        ratexParseAndLayoutInIsolate,
        RaTeXParseAndLayoutIsolateArgs(
          latex: widget.latex,
          displayMode: widget.displayMode,
          colorArgb: resolvedColor.value, // ignore: deprecated_member_use
        ),
      );
      if (mounted) {
        setState(() {
          _displayList = dl;
          _error = null;
        });
      }
    } on RaTeXException catch (e) {
      widget.onError?.call(e);
      if (mounted) {
        setState(() {
          _error = e;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Text('RaTeX error: ${_error!.message}',
          style: const TextStyle(color: Colors.red, fontSize: 12));
    }
    final dl = _displayList;
    if (dl == null) {
      return widget.loading ?? const SizedBox.shrink();
    }
    final painter = RaTeXPainter(displayList: dl, fontSize: widget.fontSize);
    return SizedBox(
      width: painter.widthPx,
      height: painter.totalHeightPx,
      child: CustomPaint(painter: painter),
    );
  }
}
