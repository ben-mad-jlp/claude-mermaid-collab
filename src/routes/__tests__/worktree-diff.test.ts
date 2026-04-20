import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWorktreeDiffHandler } from '../worktree-diff';

let tmpRepo: string;

async function sh(cmd: string[], cwd: string) {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  await proc.exited;
}

beforeAll(async () => {
  tmpRepo = mkdtempSync(join(tmpdir(), 'wt-diff-'));
  await sh(['git', 'init', '-q'], tmpRepo);
  await sh(['git', 'config', 'user.email', 'test@example.com'], tmpRepo);
  await sh(['git', 'config', 'user.name', 'Test'], tmpRepo);
  writeFileSync(join(tmpRepo, 'a.txt'), 'alpha\n');
  writeFileSync(join(tmpRepo, 'c.txt'), 'gamma\n');
  await sh(['git', 'add', '.'], tmpRepo);
  await sh(['git', 'commit', '-q', '-m', 'init'], tmpRepo);
  // modify a.txt, create untracked b.txt, delete c.txt
  writeFileSync(join(tmpRepo, 'a.txt'), 'alpha-changed\n');
  writeFileSync(join(tmpRepo, 'b.txt'), 'beta\n');
  unlinkSync(join(tmpRepo, 'c.txt'));
});

afterAll(() => {
  rmSync(tmpRepo, { recursive: true, force: true });
});

describe('handleWorktreeDiffAPI', () => {
  it('returns 400 when sessionId missing', async () => {
    const handler = createWorktreeDiffHandler({ lookupWorktreePath: () => null });
    const res = await handler(new Request('http://x/api/agent/worktree-diff'));
    expect(res.status).toBe(400);
  });

  it('returns [] when no worktree found', async () => {
    const handler = createWorktreeDiffHandler({ lookupWorktreePath: () => null });
    const res = await handler(new Request('http://x/api/agent/worktree-diff?sessionId=s1'));
    const body: any = await res.json();
    expect(body).toEqual([]);
  });

  it('returns M/??/D entries with patches', async () => {
    const handler = createWorktreeDiffHandler({ lookupWorktreePath: () => tmpRepo });
    const res = await handler(new Request('http://x/api/agent/worktree-diff?sessionId=s1'));
    const body: any[] = await res.json();
    const byPath = Object.fromEntries(body.map((e) => [e.path, e]));
    expect(byPath['a.txt'].status).toBe('M');
    expect(byPath['b.txt'].status).toBe('??');
    expect(byPath['c.txt'].status).toBe('D');
    for (const e of body) {
      expect(typeof e.patch).toBe('string');
    }
  });
});
