import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProjectRegistry } from '../project-registry.ts';

describe('ProjectRegistry.register — skip transient isolation dirs', () => {
  let dir: string;
  let reg: ProjectRegistry;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'proj-reg-'));
    reg = new ProjectRegistry(path.join(dir, 'projects.json'));
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('registers a real project path', async () => {
    const real = await fs.mkdtemp(path.join(os.tmpdir(), 'real-proj-'));
    try {
      const r = await reg.register(real);
      expect(r.created).toBe(true);
      expect((await reg.list()).some((p) => p.path === real)).toBe(true);
    } finally {
      await fs.rm(real, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('SKIPS a worker worktree path (under .collab/agent-sessions/worktrees) as a no-op', async () => {
    const wt = '/Users/x/Code/repo/.collab/agent-sessions/worktrees/backend-2';
    const r = await reg.register(wt); // does not even need to exist — skipped before fs check
    expect(r.created).toBe(false);
    expect((await reg.list()).some((p) => p.path === wt)).toBe(false);
  });

  it('SKIPS the __integration__ / supervisor scratch dirs too', async () => {
    for (const wt of [
      '/Users/x/Code/repo/.collab/agent-sessions/worktrees/__integration__',
      '/Users/x/Code/repo/.collab/agent-sessions/worktrees/supervisor',
    ]) {
      expect((await reg.register(wt)).created).toBe(false);
    }
    expect((await reg.list()).length).toBe(0);
  });
});
