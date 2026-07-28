import { describe, it, expect } from 'bun:test';
import { tabRegistryKey, tabsPersistFilePath } from '../cdp-session.js';

describe('tabRegistryKey', () => {
  it('gives distinct keys for the same session under two distinct project roots', () => {
    const a = tabRegistryKey('/Users/x/work/repo-a', 'zen');
    const b = tabRegistryKey('/Users/x/work/repo-b', 'zen');
    expect(a).not.toBe(b);
  });

  it('gives the same key for two worktrees of one tracking root', () => {
    const w1 = tabRegistryKey('/Users/x/work/repo/.collab/agent-sessions/worktrees/lane-1', 'zen');
    const w2 = tabRegistryKey('/Users/x/work/repo/.collab/agent-sessions/worktrees/lane-2', 'zen');
    expect(w1).toBe(w2);
  });
});

describe('tabsPersistFilePath', () => {
  it('uid-scopes the world-shared /tmp tabs registry so two users on one project do not collide', () => {
    const uid = typeof process.getuid === 'function' ? String(process.getuid()) : 'nouid';
    expect(tabsPersistFilePath(24777)).toBe(`/tmp/.mermaid-collab-${uid}-tabs-24777.json`);
    // The uid segment is what keeps a second OS user's registry distinct even
    // when the CDP port (derived per-project) is identical.
    expect(tabsPersistFilePath(24777)).toContain(`-${uid}-`);
  });
});
