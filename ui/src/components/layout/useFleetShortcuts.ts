import { useEffect } from 'react';

/**
 * Global function-key shortcuts for the fleet, by display order (no on-card badge):
 *   - Shift+F1..F12       → click watching card #N   ([data-watch-card] in DOM order)
 *   - Ctrl+Shift+F1..F12  → click Bridge project #N  ([data-testid=project-rail-row])
 *
 * "Essentially clicking" the element: we dispatch a real click on the Nth match in
 * document order, so this stays decoupled from each panel's internals and tracks
 * whatever order the rail/list currently renders (incl. a user reorder).
 */
export function useFleetShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = /^F(\d{1,2})$/.exec(e.key);
      if (!m) return;
      const n = parseInt(m[1], 10) - 1;
      if (n < 0) return;
      const clickNth = (selector: string) => {
        const el = document.querySelectorAll<HTMLElement>(selector)[n];
        if (el) { e.preventDefault(); el.click(); }
      };
      // Ctrl+Shift+F# → Bridge project (check ctrl first; Shift+F# is the no-ctrl case).
      if (e.shiftKey && e.ctrlKey && !e.altKey && !e.metaKey) {
        clickNth('[data-testid="project-rail-row"]');
      } else if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        clickNth('[data-watch-card]');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
