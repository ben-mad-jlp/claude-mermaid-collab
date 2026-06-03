/**
 * Runtime reader for the app's Tailwind-v4 semantic design tokens.
 *
 * The semantic tokens (`--color-accent-500`, `--color-success-100`, …) are
 * declared on `:root` in `index.css`, often as `var()` chains onto the base
 * palette (`--color-success-500: var(--color-green-500)`). To get a concrete,
 * usable color out of such a chain — and to honour light/dark/sepia overrides —
 * we resolve it through a hidden probe element: assigning `color: var(name,
 * fallback)` lets the browser substitute the whole chain (or the CSS fallback if
 * the token is undefined) and `getComputedStyle().color` hands back a concrete
 * `rgb(...)` string that Mermaid's themeVariables / classDef fills accept.
 *
 * In a non-DOM context (SSR, unit tests without jsdom styling) we simply return
 * the fallback, so callers like `roadmapToMermaid` stay pure and deterministic.
 */
export function readThemeColor(varName: string, fallback: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined' || !document.body) {
    return fallback;
  }
  try {
    const probe = document.createElement('span');
    probe.style.color = `var(${varName}, ${fallback})`;
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    document.body.removeChild(probe);
    return resolved || fallback;
  } catch {
    return fallback;
  }
}
