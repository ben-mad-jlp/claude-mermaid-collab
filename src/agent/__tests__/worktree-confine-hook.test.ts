/**
 * Unit tests for the worktree-confinement PreToolUse hook's PURE decision logic
 * (hooks/worktree-confine.mjs → decide / findCdEscapes / isInside / canonicalize).
 *
 * Real temp dirs, injected values — NO mock.module (the backend suite runs in ONE process
 * and module mocks leak across files here). The decision function is pure: it takes the hook
 * input + the worktree string and returns allow/deny, so we never spawn claude.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// The shipped hook lives at repo-root hooks/. From src/agent/__tests__ that's ../../../hooks.
import { decide, findCdEscapes, isInside, canonicalize } from '../../../hooks/worktree-confine.mjs';

let root = '';          // a real temp dir standing in for the lane worktree's PARENT
let worktree = '';      // the lane worktree (canonical)
let outside = '';       // a sibling dir standing in for the MAIN checkout

beforeAll(() => {
  // realpathSync so /var → /private/var (macOS) is already resolved on our expected values.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'confine-')));
  worktree = join(root, 'wt-lane');
  outside = join(root, 'main-checkout');
  mkdirSync(worktree, { recursive: true });
  mkdirSync(join(worktree, 'sub'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(worktree, 'exists.txt'), 'x');
});
afterAll(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ } });

const write = (file_path: string) => ({ tool_name: 'Write', tool_input: { file_path } });
const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });
/** Narrow a Decision to its deny reason (throws if it was an allow) — for reason assertions. */
function denyReason(r: { deny: false } | { deny: true; reason: string }): string {
  if (!r.deny) throw new Error('expected a DENY decision, got allow');
  return r.reason;
}

describe('decide — missing boundary = allow (not a confined node)', () => {
  it('undefined worktree → allow', () => {
    expect(decide(write(join(outside, 'x.txt')), undefined).deny).toBe(false);
  });
  it('empty/whitespace worktree → allow', () => {
    expect(decide(write(join(outside, 'x.txt')), '   ').deny).toBe(false);
  });
});

describe('decide — write tools', () => {
  it('in-worktree absolute Write → allow', () => {
    expect(decide(write(join(worktree, 'new.txt')), worktree).deny).toBe(false);
  });
  it('in-worktree nested Write → allow', () => {
    expect(decide(write(join(worktree, 'sub', 'deep', 'new.txt')), worktree).deny).toBe(false);
  });
  it('relative Write resolves against the worktree → allow', () => {
    expect(decide({ tool_name: 'Write', tool_input: { file_path: 'sub/rel.txt' } }, worktree).deny).toBe(false);
  });
  it('absolute Write OUTSIDE (the main checkout) → deny, naming target + worktree', () => {
    const r = decide(write(join(outside, 'pytest_out.txt')), worktree);
    expect(r.deny).toBe(true);
    expect(denyReason(r)).toContain(outside);
    expect(denyReason(r)).toContain(worktree);
  });
  it('relative `..` escape → deny', () => {
    const r = decide({ tool_name: 'Write', tool_input: { file_path: '../main-checkout/evil.txt' } }, worktree);
    expect(r.deny).toBe(true);
  });
  it('Edit / MultiEdit / NotebookEdit are covered too', () => {
    expect(decide({ tool_name: 'Edit', tool_input: { file_path: join(outside, 'a') } }, worktree).deny).toBe(true);
    expect(decide({ tool_name: 'MultiEdit', tool_input: { file_path: join(outside, 'a') } }, worktree).deny).toBe(true);
    expect(decide({ tool_name: 'NotebookEdit', tool_input: { notebook_path: join(outside, 'nb.ipynb') } }, worktree).deny).toBe(true);
    expect(decide({ tool_name: 'NotebookEdit', tool_input: { notebook_path: join(worktree, 'nb.ipynb') } }, worktree).deny).toBe(false);
  });
  it('write with no path → allow (nothing evaluable, fail-open)', () => {
    expect(decide({ tool_name: 'Write', tool_input: {} }, worktree).deny).toBe(false);
  });
});

describe('decide — Bash cd/pushd confinement', () => {
  it('cd to an ABSOLUTE outside path then pytest → deny', () => {
    const r = decide(bash(`cd ${outside} && pytest`), worktree);
    expect(r.deny).toBe(true);
    expect(denyReason(r)).toContain(outside);
  });
  it('pushd to an absolute outside path → deny', () => {
    expect(decide(bash(`pushd ${outside}; make test`), worktree).deny).toBe(true);
  });
  it('cd to an absolute path INSIDE the worktree → allow', () => {
    expect(decide(bash(`cd ${join(worktree, 'sub')} && ls`), worktree).deny).toBe(false);
  });
  it('relative cd → allow (conservative: not a clear absolute escape)', () => {
    expect(decide(bash('cd sub && pytest'), worktree).deny).toBe(false);
  });
  it('cd back into the worktree → allow', () => {
    expect(decide(bash(`cd ${worktree} && pytest`), worktree).deny).toBe(false);
  });
  it('no cd at all → allow', () => {
    expect(decide(bash('pytest -q && echo done'), worktree).deny).toBe(false);
  });
  it('reading elsewhere (cat) with no cd → allow', () => {
    expect(decide(bash(`cat ${join(outside, 'file.txt')}`), worktree).deny).toBe(false);
  });
  it('does NOT false-positive on cd inside a quoted string (echo "cd /etc")', () => {
    expect(decide(bash('echo "cd /etc && rm -rf /"'), worktree).deny).toBe(false);
  });
  it('does NOT false-positive on `cd "$HOME"` (variable, not a literal absolute path)', () => {
    expect(decide(bash('cd "$HOME" && ls'), worktree).deny).toBe(false);
  });
  it('empty command → allow', () => {
    expect(decide({ tool_name: 'Bash', tool_input: { command: '' } }, worktree).deny).toBe(false);
  });
});

describe('decide — non-matched tools & malformed input', () => {
  it('Read → allow', () => {
    expect(decide({ tool_name: 'Read', tool_input: { file_path: join(outside, 'x') } }, worktree).deny).toBe(false);
  });
  it('malformed input object → allow (fail-open), never throws', () => {
    expect(decide(null as any, worktree).deny).toBe(false);
    expect(decide({} as any, worktree).deny).toBe(false);
    expect(decide({ tool_name: 'Bash' } as any, worktree).deny).toBe(false);
  });
});

describe('helpers', () => {
  it('isInside: same dir, nested, and sibling-prefix guard', () => {
    expect(isInside('/a/b', '/a/b')).toBe(true);
    expect(isInside('/a/b/c', '/a/b')).toBe(true);
    expect(isInside('/a/bb', '/a/b')).toBe(false); // prefix guard: /a/bb is NOT under /a/b
    expect(isInside('/a', '/a/b')).toBe(false);
  });
  it('canonicalize resolves .. and non-existent tails under an existing ancestor', () => {
    const c = canonicalize(join(worktree, 'sub', '..', 'created', 'later.txt'));
    expect(c).toBe(join(worktree, 'created', 'later.txt'));
  });
  it('findCdEscapes returns [] when there is no absolute escape', () => {
    expect(findCdEscapes('cd sub && pytest', worktree)).toEqual([]);
    expect(findCdEscapes('pytest', worktree)).toEqual([]);
  });
  it('findCdEscapes catches a chained absolute escape after &&', () => {
    expect(findCdEscapes(`echo hi && cd ${outside} && pytest`, worktree).length).toBe(1);
  });
});
