/**
 * P4: `.wslconfig` vmIdleTimeout merge — disables WSL2 idle shutdown without
 * clobbering existing settings.
 */
import { describe, it, expect } from 'bun:test';
import { setVmIdleTimeout } from '../wslconfig.ts';

describe('setVmIdleTimeout', () => {
  it('creates [wsl2] with vmIdleTimeout when the file is empty', () => {
    expect(setVmIdleTimeout('')).toBe('[wsl2]\nvmIdleTimeout=-1\n');
  });

  it('appends [wsl2] after an unrelated section, preserving it', () => {
    const got = setVmIdleTimeout('[experimental]\nautoMemoryReclaim=gradual\n');
    expect(got).toBe('[experimental]\nautoMemoryReclaim=gradual\n\n[wsl2]\nvmIdleTimeout=-1\n');
  });

  it('adds the key into an existing [wsl2] section, preserving its other keys', () => {
    const got = setVmIdleTimeout('[wsl2]\nmemory=8GB\nprocessors=4\n');
    expect(got).toBe('[wsl2]\nmemory=8GB\nprocessors=4\nvmIdleTimeout=-1\n');
  });

  it('replaces an existing vmIdleTimeout value (idempotent on re-run)', () => {
    const once = setVmIdleTimeout('[wsl2]\nvmIdleTimeout=60000\nmemory=8GB\n');
    expect(once).toBe('[wsl2]\nvmIdleTimeout=-1\nmemory=8GB\n');
    expect(setVmIdleTimeout(once)).toBe(once); // idempotent
  });

  it('honors a custom timeout value', () => {
    expect(setVmIdleTimeout('', 600000)).toBe('[wsl2]\nvmIdleTimeout=600000\n');
  });

  it('does not disturb keys in other sections named similarly', () => {
    const got = setVmIdleTimeout('[other]\nvmIdleTimeout=5\n');
    expect(got).toBe('[other]\nvmIdleTimeout=5\n\n[wsl2]\nvmIdleTimeout=-1\n');
  });
});
