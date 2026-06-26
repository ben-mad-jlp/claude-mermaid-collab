import { describe, it, expect } from 'bun:test';
import { isReapable } from '../leaf-worktree-reaper';

const NOW = 1_000_000_000;
const GRACE = 5 * 60_000;

describe('isReapable — leaf-worktree reaper decision', () => {
  it('reaps a terminal, not-inflight, QUIET worktree', () => {
    expect(isReapable({ isTerminal: true, inflight: false, mtimeMs: NOW - GRACE - 1, now: NOW })).toBe(true);
  });

  it('never reaps a non-terminal todo', () => {
    expect(isReapable({ isTerminal: false, inflight: false, mtimeMs: NOW - GRACE - 1, now: NOW })).toBe(false);
  });

  it('never reaps while a node is inflight', () => {
    expect(isReapable({ isTerminal: true, inflight: true, mtimeMs: NOW - GRACE - 1, now: NOW })).toBe(false);
  });

  it('GRACE: does NOT reap a terminal+not-inflight worktree written within the grace window (the merge-phase TOCTOU)', () => {
    // The exact bug: todo flipped terminal, no inflight row (between-nodes / merge phase),
    // but the worktree was just written → still live → must NOT reap.
    expect(isReapable({ isTerminal: true, inflight: false, mtimeMs: NOW - 1_000, now: NOW })).toBe(false);
  });

  it('reaps once the worktree has been quiet past the grace window', () => {
    expect(isReapable({ isTerminal: true, inflight: false, mtimeMs: NOW - GRACE - 1, now: NOW })).toBe(true);
  });

  it('reaps when mtime is unknown (path gone) — nothing live to protect', () => {
    expect(isReapable({ isTerminal: true, inflight: false, mtimeMs: null, now: NOW })).toBe(true);
  });
});
