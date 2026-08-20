import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SplitDeck } from '../SplitDeck';

describe('SplitDeck campaign strip order', () => {
  it('renders the campaign strip ahead of the unlanded strip and the stage', () => {
    const { container } = render(
      <SplitDeck
        commandBar={<div>bar</div>}
        rail={<div>rail</div>}
        inspector={<div>inspector</div>}
        inspectorOpen={false}
        campaignStrip={<div>campaign</div>}
        unlandedStrip={<div>unlanded</div>}
        missionStrip={<div>mission</div>}
        stage={<div>stage</div>}
      />,
    );

    const campaign = container.querySelector('[data-testid="split-campaign-strip"]');
    const unlanded = container.querySelector('[data-testid="split-unlanded-strip"]');
    const stage = container.querySelector('[data-testid="split-stage"]');

    expect(campaign).not.toBeNull();
    expect(unlanded).not.toBeNull();
    expect(stage).not.toBeNull();

    expect(campaign!.compareDocumentPosition(unlanded!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(campaign!.compareDocumentPosition(stage!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
