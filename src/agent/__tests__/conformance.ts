/**
 * WorkerAgent conformance harness (PAW P1).
 *
 * A per-adapter lifecycle assertion: feed an adapter the RECORDED panes a worker
 * renders across its lifecycle (cold spawn → working → idle-at-prompt →
 * permission prompt → dead bare-shell) and assert the adapter collapses each into
 * the normalized WorkerEvent booleans the coordinator's watchdog acts on. This is
 * the contract that pins a provider's scrape detectors to today's behavior — when
 * a second provider is added, it must pass the SAME fixtures (modulo its own
 * recorded panes) before it can be registered.
 *
 * The fixtures below are the Claude TUI panes whose exact regexes the
 * ClaudeCodeAgent inherited from coordinator-live.ts — so this doubles as the
 * byte-identical guard for the MOVE.
 */
import type { WorkerAgent, WorkerEvent } from '../worker-agent';

/** One recorded lifecycle phase: a captured pane + the WorkerEvent fields it must
 *  produce (only the asserted fields are listed). */
export interface ConformanceFixture {
  phase: string;
  pane: string;
  expect: Partial<Pick<WorkerEvent, 'tuiReady' | 'tuiPresent' | 'activelyWorking'>> & {
    permission?: { isPermission: boolean; tool?: string | null };
    /** When set, extractStallContext(pane) must CONTAIN this substring. */
    stallContains?: string;
  };
}

/** A small process snapshot fixture for the agent-liveness BFS. */
export interface LivenessFixture {
  phase: string;
  rootPid: number;
  snap: Map<number, { children: number[]; comm: string }>;
  expectAlive: boolean;
}

// --- Recorded Claude TUI panes, one per lifecycle phase ----------------------

const PANE_WORKING =
  '🧠 12% ctx | claude\n✻ Zesting… (26s · ↓ 1.1k tokens · esc to interrupt)\n';

const PANE_IDLE_AT_PROMPT =
  '🧠 40% ctx | for agents\n' +
  'I need a decision on which approach to take:\n' +
  '  (a) rewrite the parser\n' +
  '  (b) patch it in place\n' +
  'Which option do you want? recommend (b)\n' +
  '❯ ';

const PANE_PERMISSION =
  '🧠 8% ctx | claude\n' +
  'Bash(rm -rf build)\n' +
  'Do you want to proceed?\n' +
  '❯ 1. Yes\n' +
  '  2. Yes, and don\'t ask again\n' +
  '  3. No\n';

const PANE_PERMISSION_MCP =
  '🧠 8% ctx | claude\n' +
  'mcp__mermaid__create_design(name: x)\n' +
  'Do you want to proceed?\n' +
  '❯ 1. Yes\n' +
  '  2. Yes, and don\'t ask again\n' +
  '  3. No\n';

const PANE_DEAD_SHELL = 'benmaderazo@host project %  \n';

/** The Claude adapter's lifecycle fixtures (the reference set). */
export const CLAUDE_PANE_FIXTURES: ConformanceFixture[] = [
  {
    phase: 'working (spinner + elapsed timer)',
    pane: PANE_WORKING,
    expect: { tuiReady: true, tuiPresent: true, activelyWorking: true, permission: { isPermission: false } },
  },
  {
    phase: 'idle at prompt (turn ended, awaiting input)',
    pane: PANE_IDLE_AT_PROMPT,
    expect: { tuiReady: true, tuiPresent: true, activelyWorking: false, permission: { isPermission: false }, stallContains: '(b)' },
  },
  {
    phase: 'permission prompt (Bash, non-allowlisted)',
    pane: PANE_PERMISSION,
    expect: { tuiReady: true, activelyWorking: false, permission: { isPermission: true, tool: 'Bash' } },
  },
  {
    phase: 'permission prompt (MCP tool token)',
    pane: PANE_PERMISSION_MCP,
    expect: { permission: { isPermission: true, tool: 'mcp__mermaid__create_design' } },
  },
  {
    phase: 'dead bare shell (Claude exited)',
    pane: PANE_DEAD_SHELL,
    expect: { tuiReady: false, tuiPresent: false, activelyWorking: false, permission: { isPermission: false } },
  },
];

/** Liveness BFS fixtures: a `claude` anywhere in the subtree → alive. */
export const CLAUDE_LIVENESS_FIXTURES: LivenessFixture[] = [
  {
    phase: 'claude is a grandchild of the pane shell',
    rootPid: 100,
    snap: new Map([
      [100, { children: [200], comm: '-zsh' }],
      [200, { children: [300], comm: 'node' }],
      [300, { children: [], comm: 'claude' }],
    ]),
    expectAlive: true,
  },
  {
    phase: 'bare shell, no claude in subtree',
    rootPid: 100,
    snap: new Map([
      [100, { children: [200], comm: '-zsh' }],
      [200, { children: [], comm: 'node' }],
    ]),
    expectAlive: false,
  },
];

/** Assertion result for one fixture (so the harness is usable outside vitest too). */
export interface ConformanceFailure {
  phase: string;
  field: string;
  expected: unknown;
  actual: unknown;
}

/** Run the conformance fixtures against an adapter; returns the list of mismatches
 *  (empty = conformant). Pure — no I/O, no test framework — so it can be driven by
 *  a vitest spec (conformance.test.ts) or invoked directly. */
export function runConformance(
  agent: WorkerAgent,
  fixtures: ConformanceFixture[] = CLAUDE_PANE_FIXTURES,
  liveness: LivenessFixture[] = CLAUDE_LIVENESS_FIXTURES,
): ConformanceFailure[] {
  const failures: ConformanceFailure[] = [];
  const cmp = (phase: string, field: string, expected: unknown, actual: unknown) => {
    if (expected !== undefined && expected !== actual) failures.push({ phase, field, expected, actual });
  };

  for (const f of fixtures) {
    const ev = agent.snapshot(f.pane);
    cmp(f.phase, 'tuiReady', f.expect.tuiReady, ev.tuiReady);
    cmp(f.phase, 'tuiPresent', f.expect.tuiPresent, ev.tuiPresent);
    cmp(f.phase, 'activelyWorking', f.expect.activelyWorking, ev.activelyWorking);
    if (f.expect.permission) {
      cmp(f.phase, 'permission.isPermission', f.expect.permission.isPermission, ev.permission.isPermission);
      if (f.expect.permission.tool !== undefined) {
        cmp(f.phase, 'permission.tool', f.expect.permission.tool, ev.permission.tool);
      }
    }
    if (f.expect.stallContains !== undefined) {
      const has = ev.stallContext.includes(f.expect.stallContains);
      if (!has) failures.push({ phase: f.phase, field: 'stallContext', expected: `contains "${f.expect.stallContains}"`, actual: ev.stallContext });
    }
    // The snapshot detectors must agree with the standalone detector methods —
    // proves the event stream and the watchdog read the same booleans.
    cmp(f.phase, 'snapshot/isTuiReady parity', ev.tuiReady, agent.isTuiReady(f.pane));
    cmp(f.phase, 'snapshot/isActivelyWorking parity', ev.activelyWorking, agent.isActivelyWorking(f.pane));
  }

  for (const lf of liveness) {
    cmp(lf.phase, 'isAgentAliveInSubtree', lf.expectAlive, agent.isAgentAliveInSubtree(lf.rootPid, lf.snap));
  }

  return failures;
}
