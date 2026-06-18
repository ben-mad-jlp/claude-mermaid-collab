import { describe, it, expect } from 'vitest';
import { buildServerIconMap } from '../SupervisorPanel';

/**
 * Regression test for the "supervised card shows the fallback/alien server icon"
 * bug. Supervised rows are stamped with the 'local' SENTINEL (serverScope =
 * activeId ?? 'local'), but the icon map was built only from servers[].id —
 * which are real uuids/paths — so get('local') missed and the card fell back to
 * the generic icon. The fix (buildServerIconMap) aliases the 'local' sentinel to
 * the local server's icon.
 *
 * Note: SupervisorPanel no longer renders inline SessionCards (the per-project
 * chevron + inline cards were dropped in fde3ced8 — the panel is now a header-only
 * project index). The icon-resolution logic lives in the exported pure helper
 * buildServerIconMap, which is what we assert against directly here.
 */

const LOCAL_ICON = 'Rocket';

describe('SupervisorPanel — local sentinel icon resolution', () => {
  it('aliases the "local" sentinel to the local server icon, not the fallback', () => {
    // The local server carries a real id (uuid-like) — NOT 'local' — plus source:'local'.
    const map = buildServerIconMap([
      { id: 'srv-uuid-123', label: 'Local', source: 'local', host: 'localhost', icon: LOCAL_ICON },
    ]);

    // Real id resolves as usual.
    expect(map.get('srv-uuid-123')).toBe(LOCAL_ICON);
    // The 'local' sentinel resolves to the local server's icon (the regression):
    // before the fix this was undefined → generic fallback icon.
    expect(map.get('local')).toBe(LOCAL_ICON);
  });

  it('resolves the local sentinel via loopback host when source is unset', () => {
    const map = buildServerIconMap([
      { id: 'srv-uuid-123', label: 'Local', host: '127.0.0.1', icon: LOCAL_ICON },
    ]);
    expect(map.get('local')).toBe(LOCAL_ICON);
  });
});
