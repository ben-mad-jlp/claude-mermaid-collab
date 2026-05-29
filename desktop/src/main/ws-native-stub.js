// Empty stub for ws's optional native deps (bufferutil / utf-8-validate).
//
// The main build forces ws onto its pure-JS mask/unmask path via the
// WS_NO_BUFFER_UTIL / WS_NO_UTF_8_VALIDATE env vars (see electron.vite.config
// banner), so ws never actually loads these natives. But ws still contains a
// static `require('bufferutil')` / `require('utf-8-validate')`. The production
// build replaces those with frozen empty objects; `electron-vite dev` does NOT,
// and instead errors with "Could not resolve" when the (uninstalled) natives
// can't be found. Aliasing both specifiers to this empty module makes dev
// resolve them the same way prod does. It is never executed at runtime.
export default {};
