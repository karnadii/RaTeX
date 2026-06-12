import 'dart:js_interop';

@JS('ratexImportModule')
external JSPromise _ratexImport(JSString specifier);

@JS()
extension type _RatexModule._(JSObject _) implements JSObject {
  @JS('default')
  external JSPromise init();

  @JS('renderLatex')
  external JSString renderLatex(
      JSString latex, JSBoolean? displayMode, JSString? color);
}

@JS('renderLatex')
external set _globalRenderLatex(JSFunction fn);

Future<void> initRaTeXWeb() async {
  try {
    final rawModule = await _ratexImport(
            './assets/packages/ratex_flutter/web/pkg/ratex_wasm.js'.toJS)
        .toDart as JSObject;
    final mod = _RatexModule._(rawModule);
    await mod.init().toDart;
    _globalRenderLatex =
        ((JSString latex, JSBoolean? displayMode, JSString? color) =>
            mod.renderLatex(latex, displayMode, color)).toJS;
  } catch (e) {
    throw StateError('RaTeX WASM initialization failed: $e');
  }
}
