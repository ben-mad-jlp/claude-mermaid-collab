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
