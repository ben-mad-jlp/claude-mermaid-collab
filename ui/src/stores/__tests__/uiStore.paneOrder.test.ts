import { describe, it, expect } from 'vitest';
import { canonicalizePaneOrder, ALL_PANE_KEYS } from '../uiStore';

// A stale paneOrder key (a since-removed pane like 'ops'/'terminal', or any
// dev-build stray) used to render an untoggleable blank pane. canonicalizePaneOrder
// is the load-time guard (persist `merge`, runs on every rehydrate regardless of
// version) that keeps the persisted order clean.
describe('canonicalizePaneOrder', () => {
  it('drops unknown/since-removed keys while preserving saved order', () => {
    expect(canonicalizePaneOrder(['browser', 'ops', 'studio', 'terminal', 'bridge']))
      .toEqual(['browser', 'studio', 'bridge', 'spec']);
  });

  it('appends missing known keys after the saved ones', () => {
    expect(canonicalizePaneOrder(['spec'])).toEqual(['spec', 'bridge', 'studio', 'browser']);
  });

  it('returns the full default order for empty/undefined/garbage input', () => {
    expect(canonicalizePaneOrder([])).toEqual(ALL_PANE_KEYS);
    expect(canonicalizePaneOrder(undefined)).toEqual(ALL_PANE_KEYS);
    expect(canonicalizePaneOrder(['ops', 'terminal', 'nope'])).toEqual(ALL_PANE_KEYS);
  });

  it('is idempotent and never duplicates a key', () => {
    const once = canonicalizePaneOrder(['studio', 'studio', 'bridge']);
    expect(once).toEqual(canonicalizePaneOrder(once));
    expect(new Set(once).size).toBe(once.length);
  });
});
