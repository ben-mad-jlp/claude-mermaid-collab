/**
 * The liveness-watchdog threshold must be settable in a way that SURVIVES how the app is
 * actually launched.
 *
 * MEASURED 2026-08-11: the env-var override worked from a terminal and silently reverted to
 * 45s on every `open -a`/Finder/deploy-script relaunch (GUI launches drop env). Under the land
 * gate's own full-suite run (load 27) the sidecar couldn't answer health for 45s and the
 * watchdog SIGKILLed it MID-LAND — the gate killing the server it reports to. The config file
 * is the source that survives launches; env stays as the explicit per-run override.
 *
 * The resolver is pure — env and config are ARGUMENTS — so these tests never read the live
 * ~/.mermaid-collab/config.json. A resolver that reached for the real file would leak machine
 * state into assertions (the known machine-config-leak class).
 */
import { describe, it, expect } from 'bun:test';
import { resolveWatchdogThresholdMs } from '../sidecar-forensics';

describe('watchdog threshold resolution', () => {
  it('reads the config map when no env var is set — the GUI-launch path', () => {
    expect(resolveWatchdogThresholdMs({}, { MERMAID_WATCHDOG_THRESHOLD_SECONDS: '300' })).toBe(300_000);
  });

  it('env wins over config — an explicit per-run override stays an override', () => {
    expect(
      resolveWatchdogThresholdMs(
        { MERMAID_WATCHDOG_THRESHOLD_SECONDS: '120' },
        { MERMAID_WATCHDOG_THRESHOLD_SECONDS: '300' },
      ),
    ).toBe(120_000);
  });

  it('falls through to null when neither source speaks — caller applies its default', () => {
    expect(resolveWatchdogThresholdMs({}, null)).toBeNull();
    expect(resolveWatchdogThresholdMs({}, { OTHER_KEY: 'x' })).toBeNull();
  });

  it('rejects values below the 15s probe interval — lower would kill on a single probe', () => {
    expect(resolveWatchdogThresholdMs({ MERMAID_WATCHDOG_THRESHOLD_SECONDS: '5' }, null)).toBeNull();
    expect(resolveWatchdogThresholdMs({}, { MERMAID_WATCHDOG_THRESHOLD_SECONDS: '0' })).toBeNull();
  });

  it('rejects nonsense in ONE source but still honours the other', () => {
    // A typo'd env var must not mask a valid config value — reverting to 45s silently is the
    // exact failure this exists to end.
    expect(
      resolveWatchdogThresholdMs(
        { MERMAID_WATCHDOG_THRESHOLD_SECONDS: 'lots' },
        { MERMAID_WATCHDOG_THRESHOLD_SECONDS: '300' },
      ),
    ).toBe(300_000);
  });
});
