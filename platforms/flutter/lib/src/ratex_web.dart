import 'dart:convert';
import 'dart:js_interop';

import 'display_list.dart';
import 'ratex_backend.dart';
import 'ratex_exception.dart';

@JS('renderLatex')
external JSString _renderLatexGlobal(JSString latex,
    [JSBoolean? displayMode, JSString? color]);

RaTeXBackend createBackend() => RaTeXWebBackend();

class RaTeXWebBackend implements RaTeXBackend {
  @override
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
    final r = (c.r * 255).round().clamp(0, 255);
    final g = (c.g * 255).round().clamp(0, 255);
    final b = (c.b * 255).round().clamp(0, 255);
    final a = (c.a * 255).round().clamp(0, 255);
    if (c.a == 1.0) {
      return '#${r.toRadixString(16).padLeft(2, '0')}'
          '${g.toRadixString(16).padLeft(2, '0')}'
          '${b.toRadixString(16).padLeft(2, '0')}';
    }
    return '#${r.toRadixString(16).padLeft(2, '0')}'
        '${g.toRadixString(16).padLeft(2, '0')}'
        '${b.toRadixString(16).padLeft(2, '0')}'
        '${a.toRadixString(16).padLeft(2, '0')}';
  }
}
