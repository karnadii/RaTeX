import 'dart:js_interop';

@JS('ratexReady')
external JSPromise _ratexReady();

Future<void> initRaTeXWeb() async {
  try {
    await _ratexReady().toDart;
  } catch (e) {
    throw StateError('RaTeX WASM initialization failed: $e');
  }
}