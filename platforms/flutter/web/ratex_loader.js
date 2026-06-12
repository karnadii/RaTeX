// ratex_loader.js — Load the RaTeX WASM module and expose global functions.
//
// Include this in your Flutter web app's index.html:
//   <script src="packages/ratex_flutter/ratex_loader.js"></script>
//
// The script creates a global `ratexReady` Promise and exposes
// `renderLatex(latex, displayMode?, color?)` as a global function once the WASM module
// is initialized.

// Resolve the WASM module path relative to this script's location.
const _scriptSrc = document.currentScript?.src ?? '';
const _basePath = _scriptSrc.substring(0, _scriptSrc.lastIndexOf('/') + 1);

window.ratexReady = (async () => {
  try {
    const mod = await import(_basePath + 'pkg/ratex_wasm.js');
    await mod.default();
    // Expose renderLatex globally for dart:js_interop access.
    window.renderLatex = mod.renderLatex;
  } catch (e) {
    console.error('RaTeX WASM load failed:', e);
    throw e;
  }
})();