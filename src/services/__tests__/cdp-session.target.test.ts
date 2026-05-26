import { describe, it, expect } from 'vitest';
import { selectElectronViewTarget, ELECTRON_VIEW_MARKER } from '../cdp-session.js';

// The electron-view target selection is extracted as a pure helper so it can be
// tested without a live CDP connection (cdp-session loads chrome-remote-interface
// via createRequire, which bypasses vi.mock). createOrReplaceTab delegates to this.
describe('selectElectronViewTarget', () => {
  it('selects the page target carrying the marker in its title', () => {
    const id = selectElectronViewTarget([
      { id: 'blank-host', type: 'page', title: '', url: '' },
      { id: 'view-1', type: 'page', title: ELECTRON_VIEW_MARKER, url: 'about:blank' },
    ]);
    expect(id).toBe('view-1');
  });

  it('selects the page target carrying the marker in its url', () => {
    const id = selectElectronViewTarget([
      { id: 'view-2', type: 'page', title: 'pane', url: `data:text/html,${ELECTRON_VIEW_MARKER}` },
    ]);
    expect(id).toBe('view-2');
  });

  it('ignores non-page targets even if they carry the marker', () => {
    expect(() =>
      selectElectronViewTarget([{ id: 'sw', type: 'service_worker', title: ELECTRON_VIEW_MARKER }])
    ).toThrow('embedded view target not found');
  });

  it('throws when no target carries the marker', () => {
    expect(() =>
      selectElectronViewTarget([{ id: 'x', type: 'page', title: 'other', url: 'http://x' }])
    ).toThrow('embedded view target not found');
  });
});
