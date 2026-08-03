import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CommandBar } from '../CommandBar';

describe('CommandBar crit progress', () => {
  it('renders crit met/total when critTotal is set', () => {
    const { getByTestId } = render(
      <CommandBar
        liveCount={0}
        inflightCount={0}
        needsYouCount={0}
        critMet={2}
        critTotal={8}
      />
    );

    const critProgress = getByTestId('bridge-crit-progress');
    expect(critProgress).toBeInTheDocument();
    expect(critProgress.textContent).toContain('2/8');
  });

  it('hides crit progress when critTotal is 0', () => {
    const { queryByTestId } = render(
      <CommandBar
        liveCount={0}
        inflightCount={0}
        needsYouCount={0}
        critMet={0}
        critTotal={0}
      />
    );

    expect(queryByTestId('bridge-crit-progress')).not.toBeInTheDocument();
  });

  it('hides crit progress when critTotal is undefined', () => {
    const { queryByTestId } = render(
      <CommandBar
        liveCount={0}
        inflightCount={0}
        needsYouCount={0}
      />
    );

    expect(queryByTestId('bridge-crit-progress')).not.toBeInTheDocument();
  });
});
