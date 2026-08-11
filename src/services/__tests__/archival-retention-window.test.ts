/**
 * The retention window has to be shorter than the project's churn, or the sweep runs
 * every 5 minutes forever and archives nothing.
 *
 * MEASURED 2026-08-11: 2283 unarchived terminal rows, only 36 of them older than the
 * 30-day window then in force, and 1934 sitting in the 7-30 day band the window excluded.
 * The hot set had grown to 3125 rows against 308 genuinely live ones.
 */
import { describe, it, expect, afterEach } from 'bun:test';

const ORIGINAL = process.env.MERMAID_ARCHIVAL_RETENTION_DAYS;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MERMAID_ARCHIVAL_RETENTION_DAYS;
  else process.env.MERMAID_ARCHIVAL_RETENTION_DAYS = ORIGINAL;
});

/** The constant is resolved at module load, so each case needs a fresh module registry. */
async function freshRetentionMs(): Promise<number> {
  const mod = await import(`../archival-sweep.js?t=${Math.random()}`);
  return mod.ARCHIVAL_RETENTION_MS as number;
}

const DAY = 24 * 60 * 60 * 1000;

describe('archival retention window', () => {
  it('defaults to a week — short enough to catch a daemon project\'s churn', async () => {
    delete process.env.MERMAID_ARCHIVAL_RETENTION_DAYS;
    expect(await freshRetentionMs()).toBe(7 * DAY);
  });

  it('is short enough to reach the band where the rows actually live', async () => {
    delete process.env.MERMAID_ARCHIVAL_RETENTION_DAYS;
    const ms = await freshRetentionMs();
    // 1934 of 2283 terminal rows were 7-30 days old. A window at or above 30 days leaves
    // them all hot, which is the bug this replaces.
    expect(ms).toBeLessThan(30 * DAY);
    // ...but not so short that a row goes terminal and vanishes from view the same day.
    expect(ms).toBeGreaterThanOrEqual(2 * DAY);
  });

  it('honours an explicit override for a project that wants more history', async () => {
    process.env.MERMAID_ARCHIVAL_RETENTION_DAYS = '30';
    expect(await freshRetentionMs()).toBe(30 * DAY);
  });

  it('ignores nonsense rather than archiving everything on a typo', async () => {
    // 0 or negative would put the cutoff at (or ahead of) now and sweep live-ish rows.
    for (const bad of ['0', '-5', 'thirty', '', 'NaN']) {
      process.env.MERMAID_ARCHIVAL_RETENTION_DAYS = bad;
      expect(await freshRetentionMs()).toBe(7 * DAY);
    }
  });
});
