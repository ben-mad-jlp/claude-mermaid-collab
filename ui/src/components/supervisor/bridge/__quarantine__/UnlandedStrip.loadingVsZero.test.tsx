/**
 * QUARANTINE — red-by-design repro for an EXPLORE finding.
 *
 * O5: "empty and zero states must be visually distinguishable from loading and from
 * error; nothing must never look like not-yet."
 *
 * supervisorStore.ts:747 initializes `unlandedEpicsByProject: {}`. Until the first
 * fetch for a project resolves (supervisorStore.ts:965 sets the entry from the API
 * response), `unlandedEpicsByProject[project]` is `undefined` -- there is no separate
 * "loading" flag threaded through. BridgeDashboard.tsx:614-615 passes that lookup
 * straight into `<UnlandedStrip unlandedEpics={unlandedEpicsByProject[project]} />`.
 *
 * UnlandedStrip.tsx:11 does `const unlanded = unlandedEpics ?? [];` and then (line 14)
 * `if (unlanded.length === 0) return null;` -- so BOTH "haven't fetched yet" (prop is
 * `undefined`) and "fetched, confirmed zero unlanded epics" (prop is `[]`) render
 * nothing at all. A human watching the Bridge cannot tell "still loading" from "all
 * clear" from this panel; the strip's very absence is claimed by two different states.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { UnlandedStrip } from '../UnlandedStrip';

describe('UnlandedStrip -- loading vs confirmed-zero honesty (quarantine, expected RED)', () => {
  it('renders a visibly different DOM for "not yet fetched" (undefined) vs "confirmed zero" (empty array)', () => {
    const notYetFetched = render(<UnlandedStrip unlandedEpics={undefined} />);
    const notYetFetchedHtml = notYetFetched.container.innerHTML;
    notYetFetched.unmount();

    const confirmedZero = render(<UnlandedStrip unlandedEpics={[]} />);
    const confirmedZeroHtml = confirmedZero.container.innerHTML;
    confirmedZero.unmount();

    // O5: these must not be the byte-identical "render nothing" -- today both are ''.
    expect(notYetFetchedHtml).not.toBe(confirmedZeroHtml);
  });
});
