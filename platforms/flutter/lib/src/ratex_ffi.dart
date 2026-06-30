// ratex_ffi.dart — Dart FFI bindings to libratex_ffi (iOS, Android, macOS, Windows, Linux).
//
// C ABI:
//   RatexResult ratex_parse_and_layout(const char* latex, const RatexOptions* opts);
//   void        ratex_free_display_list(char* json);
//   const char* ratex_get_last_error(void);

import 'dart:convert';
import 'dart:ffi';
import 'dart:io';

import 'package:ffi/ffi.dart';

import 'display_list.dart';
import 'ratex_exception.dart';

// MARK: - C struct mirrors

/// Mirror of `RatexOptions` from ratex.h.
///
/// Always set [structSize] to `sizeOf<RatexOptions>()` before use.
final class NativeRatexColor extends Struct {
  @Float()
  external double r;

  @Float()
  external double g;

  @Float()
  external double b;

  @Float()
  external double a;
}

final class RatexOptions extends Struct {
  /// Must equal `sizeOf<RatexOptions>()`.
  @UintPtr()
  external int structSize;

  /// `0` = inline/text style (`$...$`), `1` = display/block style (`$$...$$`).
  @Int32()
  external int displayMode;

  external Pointer<NativeRatexColor> color;
}

/// Mirror of `RatexResult` from ratex.h.
final class RatexResult extends Struct {
  /// JSON display list on success, null pointer on error.
  external Pointer<Utf8> data;

  /// `0` on success, non-zero on error.
  @Int32()
  external int errorCode;
}

// MARK: - Native function type definitions

typedef _ParseAndLayoutC = RatexResult Function(
    Pointer<Utf8>, Pointer<RatexOptions>);
typedef _ParseAndLayoutDart = RatexResult Function(
    Pointer<Utf8>, Pointer<RatexOptions>);

typedef _FreeDisplayListC = Void Function(Pointer<Utf8>);
typedef _FreeDisplayListDart = void Function(Pointer<Utf8>);

typedef _GetLastErrorC = Pointer<Utf8> Function();
typedef _GetLastErrorDart = Pointer<Utf8> Function();

// MARK: - Library loader

DynamicLibrary _openLib() {
  // iOS: static library is force-loaded into the process via CocoaPods
  // macOS: dynamic library is linked via vendored_libraries in the podspec
  if (Platform.isIOS || Platform.isMacOS) return DynamicLibrary.process();
  if (Platform.isWindows) return DynamicLibrary.open('ratex_ffi.dll');
  if (Platform.isAndroid || Platform.isLinux) {
    return DynamicLibrary.open('libratex_ffi.so');
  }
  throw UnsupportedError('Unsupported platform: ${Platform.operatingSystem}');
}

// MARK: - FFI bindings (lazy)

// ponytail: lookup happens once at first access; no wrapper class needed.
final _ParseAndLayoutDart _parseAndLayout = _openLib()
    .lookupFunction<_ParseAndLayoutC, _ParseAndLayoutDart>(
        'ratex_parse_and_layout');
final _FreeDisplayListDart _freeDisplayList = _openLib()
    .lookupFunction<_FreeDisplayListC, _FreeDisplayListDart>(
        'ratex_free_display_list');
final _GetLastErrorDart _getLastError = _openLib()
    .lookupFunction<_GetLastErrorC, _GetLastErrorDart>('ratex_get_last_error');

// MARK: - Public wrapper

/// Dart FFI wrapper around the RaTeX C ABI.
class RaTeXFfi {
  DisplayList parseAndLayout(
    String latex, {
    bool displayMode = true,
    RaTeXColor color = const RaTeXColor(0, 0, 0, 1),
  }) {
    final inputPtr = latex.toNativeUtf8();
    final optsPtr = calloc<RatexOptions>();
    final colorPtr = calloc<NativeRatexColor>();
    try {
      optsPtr.ref.structSize = sizeOf<RatexOptions>();
      optsPtr.ref.displayMode = displayMode ? 1 : 0;
      colorPtr.ref.r = color.r;
      colorPtr.ref.g = color.g;
      colorPtr.ref.b = color.b;
      colorPtr.ref.a = color.a;
      optsPtr.ref.color = colorPtr;

      final result = _parseAndLayout(inputPtr, optsPtr);
      if (result.errorCode != 0) {
        final errPtr = _getLastError();
        final tail = errPtr.address == 0
            ? 'no message (code ${result.errorCode})'
            : errPtr.toDartString();
        throw RaTeXException(tail);
      }
      if (result.data.address == 0) {
        throw const RaTeXException(
          'native returned success but null data (FFI layout or linking issue)',
        );
      }
      final json = result.data.toDartString();
      _freeDisplayList(result.data);

      final decoded = jsonDecode(json) as Map<String, dynamic>;
      return DisplayList.fromJson(decoded);
    } finally {
      calloc.free(inputPtr);
      calloc.free(colorPtr);
      calloc.free(optsPtr);
    }
  }
}

RaTeXFfi createBackend() => RaTeXFfi();
