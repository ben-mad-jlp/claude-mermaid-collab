/**
 * SplitDeck tests — the current layout contract (crit 4, mission 42812662): the
 * stage fills the work column full-height, and the inspector is an ON-DEMAND
 * drawer that mounts only when `inspectorOpen`, so it consumes no space until
 * invoked (replacing the old permanent vertical SplitPane).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SplitDeck } from './SplitDeck';

function renderDeck(opts: { inspectorOpen?: boolean; onInspectorClose?: () => void } = {}) {
  return render(
    <SplitDeck
      commandBar={<div>bar</div>}
      rail={<div>rail</div>}
      stage={<div>stage</div>}
      inspector={<div>inspector</div>}
      inspectorOpen={opts.inspectorOpen ?? false}
      onInspectorClose={opts.onInspectorClose}
    />
  );
}

describe('SplitDeck', () => {
  it('always renders the stage; inspector is absent until invoked', () => {
    renderDeck({ inspectorOpen: false });
    expect(screen.getByTestId('split-stage')).toBeInTheDocument();
    expect(screen.queryByTestId('split-inspector')).toBeNull();
  });

  it('mounts the inspector drawer + backdrop when open', () => {
    renderDeck({ inspectorOpen: true });
    expect(screen.getByTestId('split-stage')).toBeInTheDocument();
    expect(screen.getByTestId('split-inspector')).toBeInTheDocument();
    expect(screen.getByTestId('split-inspector-backdrop')).toBeInTheDocument();
  });

  it('dismisses via the close button and the backdrop', () => {
    const onClose = vi.fn();
    renderDeck({ inspectorOpen: true, onInspectorClose: onClose });
    fireEvent.click(screen.getByTestId('split-inspector-close'));
    fireEvent.click(screen.getByTestId('split-inspector-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('inspector resize', () => {
  function makeStubStorage() {
    const store = new Map<string, string>();
    return {
      getItem: vi.fn((key: string) => (store.has(key) ? store.get(key)! : null)),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn((key: string) => store.delete(key)),
      clear: vi.fn(() => store.clear()),
      key: vi.fn(() => null),
      get length() {
        return store.size;
      },
    };
  }

  it('renders the resize handle when open, absent when closed', () => {
    renderDeck({ inspectorOpen: true });
    expect(screen.getByTestId('split-inspector-resize')).toBeInTheDocument();
  });

  it('does not render the resize handle when closed', () => {
    renderDeck({ inspectorOpen: false });
    expect(screen.queryByTestId('split-inspector-resize')).toBeNull();
  });

  it('drags to change the inspector width', () => {
    const stub = makeStubStorage();
    Object.defineProperty(window, 'localStorage', { value: stub, configurable: true });

    renderDeck({ inspectorOpen: true });
    const handle = screen.getByTestId('split-inspector-resize');
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 1024 - 420 });
    fireEvent.pointerMove(window, { clientX: 1024 - 500 });

    expect(screen.getByTestId('split-inspector').style.width).toBe('500px');
  });

  it('clamps the width at the minimum and maximum bounds', () => {
    const stub = makeStubStorage();
    Object.defineProperty(window, 'localStorage', { value: stub, configurable: true });

    renderDeck({ inspectorOpen: true });
    const handle = screen.getByTestId('split-inspector-resize');
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 1024 - 420 });

    // clientX near window width → width near 0 → clamps to min
    fireEvent.pointerMove(window, { clientX: 1020 });
    expect(screen.getByTestId('split-inspector').style.width).toBe('320px');

    // clientX near 0 → width near window.innerWidth → clamps to max
    const max = Math.min(window.innerWidth * 0.9, 900);
    fireEvent.pointerMove(window, { clientX: 0 });
    expect(screen.getByTestId('split-inspector').style.width).toBe(`${max}px`);
  });

  it('persists the dragged width and restores it on remount', () => {
    const stub = makeStubStorage();
    Object.defineProperty(window, 'localStorage', { value: stub, configurable: true });

    const { unmount } = renderDeck({ inspectorOpen: true });
    const handle = screen.getByTestId('split-inspector-resize');
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 1024 - 420 });
    fireEvent.pointerMove(window, { clientX: 1024 - 500 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(stub.setItem).toHaveBeenCalledWith('bridge.inspectorWidth', '500');

    unmount();
    renderDeck({ inspectorOpen: true });
    expect(screen.getByTestId('split-inspector').style.width).toBe('500px');
  });
});
