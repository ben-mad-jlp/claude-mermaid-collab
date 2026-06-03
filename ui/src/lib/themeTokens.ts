/**
 * Runtime reader for the app's design tokens, normalized to a Mermaid-safe hex.
 *
 * Two hazards this guards against (both caused a P0: the roadmap mermaid hung on
 * "Rendering…" after the token-driven theme landed):
 *
 *  1. NOT EVERY TOKEN RESOLVES AT RUNTIME. Tailwind v4 bakes its base palette via
 *     `@theme inline`, so `--color-green-500` (and the semantic tokens that chain
 *     onto it, e.g. `--color-success-500: var(--color-green-500)`) are NOT live
 *     custom properties on `:root`. A `color: var(--color-success-500, #fallback)`
 *     does NOT take the CSS fallback — the property is defined-but-invalid, so the
 *     declaration drops to the *inherited* color. We detect that by inheriting a
 *     sentinel on a wrapper and falling back to the literal when it shows through.
 *
 *  2. COMMAS BREAK CLASSDEF SYNTAX. `getComputedStyle().color` serializes to
 *     `rgb(r, g, b)`; those commas split Mermaid's comma-separated `classDef`
 *     properties (`fill:rgb(14, 165, 233),stroke:…`) and make `mermaid.render`
 *     throw/hang. We normalize every resolved color to comma-free `#rrggbb`.
 *
 * In a non-DOM / unstyled context (SSR, jsdom unit tests) we return the literal
 * fallback, keeping callers like `roadmapToMermaid` pure and deterministic.
 */

// A color the page is extremely unlikely to actually use, inherited onto the
// probe's parent so an unresolved `var()` reveals itself as this value.
const SENTINEL = 'rgb(1, 2, 3)';

/** Normalize any CSS color string (rgb/rgba/oklch/named) to comma-free hex. */
function toHexColor(color: string): string | null {
  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // Seed with a known value; an unparseable color leaves fillStyle unchanged.
    ctx.fillStyle = '#000000';
    ctx.fillStyle = color;
    const out = ctx.fillStyle;
    // Canvas serializes opaque colors to #rrggbb; reject anything with a comma
    // (rgba with alpha) so we never feed a comma back into a classDef.
    if (typeof out === 'string' && /^#[0-9a-fA-F]{6,8}$/.test(out)) return out;
    return null;
  } catch {
    return null;
  }
}

export function readThemeColor(varName: string, fallback: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined' || !document.body) {
    return fallback;
  }
  try {
    const wrap = document.createElement('div');
    wrap.style.color = SENTINEL; // inherited base — shows through if var() is invalid
    wrap.style.display = 'none';
    const probe = document.createElement('span');
    probe.style.color = `var(${varName})`;
    wrap.appendChild(probe);
    document.body.appendChild(wrap);
    const resolved = getComputedStyle(probe).color;
    document.body.removeChild(wrap);
    // Unresolved token (empty, or the sentinel bled through) → literal fallback.
    if (!resolved || resolved.replace(/\s/g, '') === SENTINEL.replace(/\s/g, '')) {
      return fallback;
    }
    return toHexColor(resolved) ?? fallback;
  } catch {
    return fallback;
  }
}
