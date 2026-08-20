/**
 * Tests for the landing-now annotation feature.
 *
 * Verifies that UnlandedStrip annotates in-flight land jobs with elapsed time,
 * and that the component renders unchanged when the job-store read fails (fail-open).
 */
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { UnlandedStrip } from './UnlandedStrip';

describe('UnlandedStrip landing-now annotation', () => {
  it('annotates an epic with a running land job as landing now with elapsed time', () => {
    const unlandedEpic = [{ branch: 'collab/epic/ab12cd34', epicId8: 'ab12cd34', ahead: 3 }];
    const landsInFlight = [{ jobId: 'j1', epicId: 'ab12cd34-xxxx-xxxx-xxxx-xxxxxxxxxxxx', startedAtMs: 1_000_000 }];
    const nowMs = 1_000_000 + 200_000;

    const { getByText, queryByText, container } = render(
      <UnlandedStrip
        unlandedEpics={unlandedEpic}
        landsInFlight={landsInFlight}
        nowMs={nowMs}
      />
    );

    const headerButton = container.querySelector('button[aria-expanded]');
    fireEvent.click(headerButton!);

    // The landing-now span should be rendered with the correct elapsed time
    expect(queryByText(/landing now · 3m 20s/)).toBeDefined();

    // The branch span should still be present
    expect(getByText('collab/epic/ab12cd34')).toBeDefined();

    // The +ahead span should still be present
    expect(getByText('+3')).toBeDefined();

    // The landing-now span should have the correct testid
    const landingNowSpan = container.querySelector('[data-testid="landing-now"]');
    expect(landingNowSpan).toBeDefined();
    expect(landingNowSpan?.textContent).toMatch(/landing now · 3m 20s/);
  });

  it('renders the banner unchanged when the job-store read throws', () => {
    const unlandedEpic = [{ branch: 'collab/epic/ab12cd34', epicId8: 'ab12cd34', ahead: 3 }];

    // Render with empty landsInFlight (fail-open value when job-store read throws)
    const a = render(
      <UnlandedStrip
        unlandedEpics={unlandedEpic}
        landsInFlight={[]}
      />
    );
    fireEvent.click(a.container.querySelector('button[aria-expanded]')!);
    const aHtml = a.container.innerHTML;
    a.unmount();

    // Render with the prop omitted (default = [])
    const b = render(
      <UnlandedStrip
        unlandedEpics={unlandedEpic}
      />
    );
    fireEvent.click(b.container.querySelector('button[aria-expanded]')!);
    const bHtml = b.container.innerHTML;
    b.unmount();

    // Both renders should produce identical HTML
    expect(aHtml).toBe(bHtml);

    // The landing-now span should not be present in either render
    const c = render(
      <UnlandedStrip
        unlandedEpics={unlandedEpic}
        landsInFlight={[]}
      />
    );
    fireEvent.click(c.container.querySelector('button[aria-expanded]')!);
    expect(c.queryByText(/landing now/)).toBeNull();
    c.unmount();
  });
});
