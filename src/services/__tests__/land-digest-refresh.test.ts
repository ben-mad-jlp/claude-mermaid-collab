import { describe, test, expect, mock } from 'bun:test';
import { refreshProjectDigestOnLand } from '../coordinator-live.ts';

describe('refreshProjectDigestOnLand', () => {
  test('invokes the refresh with the landed project when the flag is ON', async () => {
    const refreshDigest = mock((_p: string) => {});
    const digestEnabled = mock((_p: string) => true);
    await refreshProjectDigestOnLand('/proj/A', { refreshDigest, digestEnabled });
    expect(digestEnabled).toHaveBeenCalledWith('/proj/A');
    expect(refreshDigest).toHaveBeenCalledWith('/proj/A');
  });

  test('skips the refresh when the flag is OFF (guard consulted, refresh untouched)', async () => {
    const refreshDigest = mock((_p: string) => {});
    const digestEnabled = mock((_p: string) => false);
    await refreshProjectDigestOnLand('/proj/A', { refreshDigest, digestEnabled });
    expect(digestEnabled).toHaveBeenCalledWith('/proj/A');
    expect(refreshDigest).toHaveBeenCalledTimes(0);
  });

  test('a refresh throw does not propagate (land stays ok)', async () => {
    const refreshDigest = mock((_p: string) => { throw new Error('boom'); });
    const digestEnabled = mock((_p: string) => true);
    // Resolves without throwing — the advisory catch swallows the failure.
    await expect(
      refreshProjectDigestOnLand('/proj/A', { refreshDigest, digestEnabled }),
    ).resolves.toBeUndefined();
  });
});
