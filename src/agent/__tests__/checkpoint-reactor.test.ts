import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createGitOps } from '../git-ops.js';
import { CheckpointStore } from '../checkpoint-store.js';
import { EventLog } from '../event-log.js';
import { CheckpointReactor } from '../checkpoint-reactor.js';

async function run(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn({ cmd: ['git', ...args], cwd, stdout: 'pipe', stderr: 'pipe' });
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`git ${args.join(' ')} failed: ${stderr}`);
}

async function initRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmc-cp-reactor-'));
  await run(dir, ['init', '-q', '-b', 'main']);
  await run(dir, ['config', 'user.email', 'test@example.com']);
  await run(dir, ['config', 'user.name', 'Test']);
  await run(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

describe('CheckpointReactor', () => {
  const tmpDirs: string[] = [];
  let store: CheckpointStore;
  let log: EventLog;
  let reactor: CheckpointReactor;

  beforeEach(() => {
    store = new CheckpointStore(':memory:');
    log = new EventLog(':memory:');
    reactor = new CheckpointReactor(createGitOps(), store, log);
  });

  afterEach(() => {
    store.close();
    log.close();
    while (tmpDirs.length) {
      const d = tmpDirs.pop()!;
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('non-git cwd: returns sha "none", inserts row, emits event', async () => {
    const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'cmc-non-repo-'));
    tmpDirs.push(nonRepo);
    const sessionId = 'sess-a';
    const turnId = 'turn-1';

    const { sha, firstSeq } = await reactor.snapshot(sessionId, nonRepo, turnId);
    expect(sha).toBe('none');
    expect(firstSeq).toBe(1);

    const row = store.get(sessionId, turnId);
    expect(row).toBeDefined();
    expect(row!.stashSha).toBe('none');
    expect(row!.firstSeq).toBe(1);

    // Event was appended to the log.
    const lastSeq = log.getLastSeq(sessionId);
    expect(lastSeq).toBe(1);
    const events: unknown[] = [];
    for await (const ev of log.replay(sessionId, 0)) events.push(ev);
    expect(events).toHaveLength(1);
    const ev = events[0] as { kind: string; stashSha: string; turnId: string; firstSeq: number };
    expect(ev.kind).toBe('checkpoint_created');
    expect(ev.stashSha).toBe('none');
    expect(ev.turnId).toBe(turnId);
    expect(ev.firstSeq).toBe(1);
  });

  it('git repo with changes: returns real stash SHA, firstSeq = lastSeq + 1', async () => {
    const repo = await initRepo();
    tmpDirs.push(repo);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\n');
    await run(repo, ['add', '.']);
    await run(repo, ['commit', '-q', '-m', 'init']);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'modified\n');

    const sessionId = 'sess-b';
    // Pre-seed event log so firstSeq should be 3.
    log.append(sessionId, [
      { kind: 'user_message', sessionId, ts: Date.now(), messageId: 'm1', text: 'hi' },
      { kind: 'user_message', sessionId, ts: Date.now(), messageId: 'm2', text: 'yo' },
    ] as never);
    expect(log.getLastSeq(sessionId)).toBe(2);

    const turnId = 'turn-2';
    const { sha, firstSeq } = await reactor.snapshot(sessionId, repo, turnId);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(firstSeq).toBe(3);

    const row = store.get(sessionId, turnId);
    expect(row!.stashSha).toBe(sha);
    expect(row!.firstSeq).toBe(3);

    // Event appended at seq 3.
    expect(log.getLastSeq(sessionId)).toBe(3);
  });

  it('empty clean repo: sha === "HEAD"', async () => {
    const repo = await initRepo();
    tmpDirs.push(repo);
    // Need at least one commit; stash create on empty HEAD returns empty string only
    // when working tree is clean relative to HEAD.
    fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\n');
    await run(repo, ['add', '.']);
    await run(repo, ['commit', '-q', '-m', 'init']);

    const { sha } = await reactor.snapshot('sess-c', repo, 'turn-3');
    expect(sha).toBe('HEAD');

    const row = store.get('sess-c', 'turn-3');
    expect(row!.stashSha).toBe('HEAD');
  });
});
