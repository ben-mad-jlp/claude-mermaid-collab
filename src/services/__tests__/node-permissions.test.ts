/**
 * Conformance + lock tests for the NODE PERMISSION SPEC.
 *
 * The spec (node-permissions.ts) is the reviewed map of what every leaf node MAY do. These
 * tests make it load-bearing:
 *   - COVERAGE: every LeafNodeKind has a spec entry (a new node cannot skip the survey).
 *   - LOCK: the spec's `current` grant matches NODE_PROFILE exactly, so widening a node's tools
 *     in NODE_PROFILE without consciously updating the spec is a RED test — silent attack-surface
 *     growth is impossible.
 *   - INTENT INVARIANTS: a node's grant cannot contradict its declared intent (a 'read-only' or
 *     'narrow' node may not TARGET Write/Edit; a 'narrow' node may not target Bash).
 *   - GAP LEDGER: the current enforcement backlog is asserted explicitly, so closing a gap is a
 *     deliberate spec edit, not an accident.
 */

import { describe, test, expect } from 'bun:test';
import { NODE_PROFILE, type LeafNodeKind, VERIFY_GATE_MCP_TOOL } from '../leaf-executor';
import { NODE_PERMISSION_SPEC, permissionGaps, toolSet } from '../node-permissions';

const ALL_KINDS = Object.keys(NODE_PROFILE) as LeafNodeKind[];
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

describe('node permission spec — coverage + lock', () => {
  test('every LeafNodeKind has a spec entry (no unspecced node)', () => {
    for (const kind of ALL_KINDS) {
      expect(NODE_PERMISSION_SPEC[kind]).toBeDefined();
    }
    // and the spec declares nothing that is not a real node kind
    for (const kind of Object.keys(NODE_PERMISSION_SPEC)) {
      expect(ALL_KINDS).toContain(kind as LeafNodeKind);
    }
  });

  test("spec.current LOCKS NODE_PROFILE.allowedTools for every node — widening a grant is a red test", () => {
    for (const kind of ALL_KINDS) {
      const live = toolSet(NODE_PROFILE[kind].allowedTools);
      const specd = new Set(NODE_PERMISSION_SPEC[kind].current);
      expect(
        { kind, live: [...live].sort(), specd: [...specd].sort() },
      ).toEqual({ kind, live: [...live].sort(), specd: [...specd].sort() });
      // exact set equality (the object compare above pins the message; this is the assertion)
      expect(live).toEqual(specd);
    }
  });
});

describe('node permission spec — intent invariants', () => {
  test('a read-only or narrow node NEVER targets a write tool', () => {
    for (const kind of ALL_KINDS) {
      const e = NODE_PERMISSION_SPEC[kind];
      if (e.intent === 'read-only' || e.intent === 'narrow') {
        for (const t of e.target) {
          expect(WRITE_TOOLS.has(t)).toBe(false);
        }
      }
    }
  });

  test('a narrow node targets no raw Bash (it acts only through MCP verbs)', () => {
    for (const kind of ALL_KINDS) {
      const e = NODE_PERMISSION_SPEC[kind];
      if (e.intent === 'narrow') {
        expect(e.target).not.toContain('Bash');
      }
    }
  });

  test('the two clean nodes (report, summary) are already AT their target', () => {
    for (const kind of ['report', 'summary'] as LeafNodeKind[]) {
      const e = NODE_PERMISSION_SPEC[kind];
      expect([...e.current].sort()).toEqual([...e.target].sort());
    }
  });
});

describe('node permission spec — enforcement backlog (the gap ledger)', () => {
  test('the current gaps are exactly the surveyed ones', () => {
    const gaps = Object.fromEntries(permissionGaps().map((g) => [g.kind, g.toRemove.sort()]));
    // Every node whose live grant is wider than its reviewed target. Closing any of these is a
    // deliberate edit to node-permissions.ts (and the enforcement that makes it safe).
    expect(gaps).toEqual({
      blueprint: ['Bash'],
      research: ['Bash'],
      driveplan: ['Bash'],
      driveexec: ['Bash', 'Write'],
    });
  });

  test('read-only nodes still holding Bash are flagged for a pinned-verb replacement, not silent', () => {
    // review + verify keep Bash in target FOR NOW (documented), so they are NOT in the gap list —
    // but their execConfinedToWorktree must be true so the permission layer fences that Bash.
    for (const kind of ['review', 'verify'] as LeafNodeKind[]) {
      const e = NODE_PERMISSION_SPEC[kind];
      expect(e.intent).toBe('read-only');
      expect(e.target).toContain('Bash');
      expect(e.execConfinedToWorktree).toBe(true);
    }
  });

  test('driveexec target matches its own "single gate verb" comment', () => {
    const e = NODE_PERMISSION_SPEC.driveexec;
    expect(e.target).toContain(VERIFY_GATE_MCP_TOOL);
    expect(e.target).not.toContain('Bash');
    expect(e.target).not.toContain('Write');
  });
});

describe('node permission spec — every writer/planner node is worktree-confined', () => {
  test('any node that can write or exec is flagged writeConfined AND execConfined', () => {
    for (const kind of ALL_KINDS) {
      const e = NODE_PERMISSION_SPEC[kind];
      const canWrite = e.current.some((t) => WRITE_TOOLS.has(t));
      const canExec = e.current.includes('Bash');
      if (canWrite) expect(e.writeConfinedToWorktree).toBe(true);
      if (canExec) expect(e.execConfinedToWorktree).toBe(true);
    }
  });
});
