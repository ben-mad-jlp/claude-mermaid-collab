/**
 * Regression test for distinguished loading vs confirmed-zero states.
 *
 * O5 (UX clarity): "empty and zero states must be visually distinguishable from loading
 * and from error; nothing must never look like not-yet."
 *
 * UnlandedStrip must render DISTINCT DOM for "not yet fetched" (undefined prop) vs
 * "fetched, confirmed zero unlanded epics" (empty array prop). Both now have separate
 * testids and visually distinct markup, so a human watching the Bridge can tell
 * "still loading" from "all clear" from "has unlanded epics".
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { UnlandedStrip } from '../UnlandedStrip';

describe('UnlandedStrip', () => {
  it('renders distinct DOM for not-yet-fetched (undefined) vs confirmed-zero (empty array)', () => {
    // Render the loading state (undefined prop)
    const notYetFetched = render(<UnlandedStrip unlandedEpics={undefined} />);
    const notYetFetchedHtml = notYetFetched.container.innerHTML;
    notYetFetched.unmount();

    // Render the confirmed-clear state (empty array)
    const confirmedZero = render(<UnlandedStrip unlandedEpics={[]} />);
    const confirmedZeroHtml = confirmedZero.container.innerHTML;
    confirmedZero.unmount();

    // The two states must render visually distinct HTML
    expect(notYetFetchedHtml).not.toBe(confirmedZeroHtml);

    // Verify the testids are present in each render
    const loadingRender = render(<UnlandedStrip unlandedEpics={undefined} />);
    expect(loadingRender.getByTestId('unlanded-strip-loading')).toBeDefined();
    loadingRender.unmount();

    const clearRender = render(<UnlandedStrip unlandedEpics={[]} />);
    expect(clearRender.getByTestId('unlanded-strip-clear')).toBeDefined();
    clearRender.unmount();
  });
});
