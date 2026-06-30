import 'dart:convert';
import 'dart:js_interop';

import 'display_list.dart';
import 'ratex_exception.dart';

@JS('renderLatex')
external JSString _renderLatexGlobal(JSString latex,
    [JSBoolean? displayMode, JSString? color]);

RaTeXWebBackend createBackend() => RaTeXWebBackend();

class RaTeXWebBackend {
  DisplayList parseAndLayout(
    String latex, {
    bool displayMode = true,
    RaTeXColor color = const RaTeXColor(0, 0, 0, 1),
  }) {
    final colorStr = _colorToCss(color);
    final JSString jsonString;
    try {
      jsonString =
          _renderLatexGlobal(latex.toJS, displayMode.toJS, colorStr.toJS);
    } catch (e) {
      throw RaTeXException('WASM renderLatex failed: $e');
    }
    final dartString = jsonString.toDart;
    if (dartString.isEmpty) {
      throw const RaTeXException('WASM renderLatex returned empty result');
    }
    final decoded = jsonDecode(dartString) as Map<String, dynamic>;
    return DisplayList.fromJson(decoded);
  }

  static String _colorToCss(RaTeXColor c) {
    String hex(double v) =>
        (v * 255).round().clamp(0, 255).toRadixString(16).padLeft(2, '0');
    final a = c.a == 1.0 ? '' : hex(c.a);
    return '#${hex(c.r)}${hex(c.g)}${hex(c.b)}$a';
  }
}
