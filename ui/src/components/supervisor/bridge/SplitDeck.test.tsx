/**
 * SplitDeck tests — the load-bearing layout contract: the stage sits ABOVE the
 * inspector in a vertical, draggable split (not a horizontal column pair).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SplitDeck } from './SplitDeck';

function renderDeck() {
  return render(
    <SplitDeck
      commandBar={<div>bar</div>}
      rail={<div>rail</div>}
      stage={<div>stage</div>}
      inspector={<div>inspector</div>}
    />
  );
}

describe('SplitDeck', () => {
  it('renders the stage and inspector panes', () => {
    renderDeck();
    expect(screen.getByTestId('split-stage')).toBeInTheDocument();
    expect(screen.getByTestId('split-inspector')).toBeInTheDocument();
  });

  it('stacks the stage above the inspector in a vertical panel group', () => {
    const { container } = renderDeck();
    const group = container.querySelector('[data-panel-group-direction]');
    expect(group).not.toBeNull();
    expect(group).toHaveAttribute('data-panel-group-direction', 'vertical');
  });
});
