import { describe, it, expect } from 'vitest';
import { STATUS_STYLE, STATUS_LABEL, statusTooltip } from '../missionShared';
import type { MissionStatus } from '@/stores/supervisorStore';

// Keep in sync with the MissionStatus union in supervisorStore.ts — this is the
// exhaustiveness list the test iterates, since TS unions have no runtime form.
const ALL_STATUSES: MissionStatus[] = [
  'abandoned', 'over-budget', 'blocked', 'building',
  'needs-verify', 'needs-discovery', 'unapproved', 'converged',
];

describe('missionShared status vocabulary', () => {
  it.each(ALL_STATUSES)('%s has a non-empty style, label, and tooltip', (status) => {
    expect(STATUS_STYLE[status]).toBeTruthy();
    expect(STATUS_LABEL[status]).toBeTruthy();
    expect(statusTooltip(status)).toBeTruthy();
    expect(statusTooltip(status)).not.toBe(status); // not the ?? status fallback
  });
});
