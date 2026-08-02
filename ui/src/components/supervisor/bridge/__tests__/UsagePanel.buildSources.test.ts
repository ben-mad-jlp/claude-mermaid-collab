import { describe, it, expect } from 'vitest';
import { BUILD_SOURCES } from '../UsagePanel';

describe('UsagePanel BUILD_SOURCES', () => {
  it('BUILD_SOURCES excludes node and leaf', () => {
    expect(BUILD_SOURCES.has('node')).toBe(false);
    expect(BUILD_SOURCES.has('leaf')).toBe(false);
  });

  it('BUILD_SOURCES contains all granular node kinds plus forge', () => {
    const granularKinds = ['blueprint', 'implement', 'review', 'verify', 'driveplan', 'driveexec', 'research', 'grok-node'];
    for (const kind of granularKinds) {
      expect(BUILD_SOURCES.has(kind)).toBe(true);
    }
    expect(BUILD_SOURCES.has('forge')).toBe(true);
  });

  it('BUILD_SOURCES has no members outside the granular allowlist', () => {
    const allowlist = new Set(['blueprint', 'implement', 'review', 'verify', 'driveplan', 'driveexec', 'research', 'grok-node', 'wimplement', 'fix', 'report', 'forge']);
    for (const source of BUILD_SOURCES) {
      expect(allowlist.has(source)).toBe(true);
    }
  });

  it('BUILD_SOURCES excludes summary', () => {
    expect(BUILD_SOURCES.has('summary')).toBe(false);
  });
});
