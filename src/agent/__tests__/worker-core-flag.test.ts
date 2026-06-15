import { describe, it, expect, afterEach } from 'vitest';
import { workerCoreEnabledFor } from '../adapters/grok-own';

afterEach(() => {
  delete process.env.WORKER_CORE;
  delete process.env.WORKER_CORE_PROJECTS;
});

describe('workerCoreEnabledFor (per-project opt-in)', () => {
  it('is OFF by default (no env, no allowlist)', () => {
    expect(workerCoreEnabledFor('/Users/me/anyproj')).toBe(false);
  });

  it('env WORKER_CORE=1 is a dev-only global override', () => {
    process.env.WORKER_CORE = '1';
    expect(workerCoreEnabledFor('/anything/at/all')).toBe(true);
  });

  it('allowlist matches by full path OR basename, and excludes others', () => {
    process.env.WORKER_CORE_PROJECTS = '/Users/me/claude-mermaid-collab, other-proj';
    expect(workerCoreEnabledFor('/Users/me/claude-mermaid-collab')).toBe(true); // full path
    expect(workerCoreEnabledFor('/elsewhere/other-proj')).toBe(true); // basename
    expect(workerCoreEnabledFor('/Users/me/build123d-ocp-mcp')).toBe(false); // a drive project — NOT enabled
  });
});
