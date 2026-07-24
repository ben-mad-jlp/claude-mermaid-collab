/**
 * NODE PERMISSION SPEC — the intended sandbox of every leaf-executor node, as DATA.
 *
 * WHY THIS FILE EXISTS. Today every node is spawned with `--dangerously-skip-permissions`
 * (permissionMode 'bypassPermissions', leaf-executor.ts spawn sites), so a node's
 * `allowedTools` list in NODE_PROFILE is the ENTIRE sandbox — and within any granted tool the
 * call is unconstrained: `Edit` takes any absolute path, `Bash` runs any command anywhere. The
 * only structural fence is that the node's cwd is its lane worktree and `GIT_CEILING_DIRECTORIES`
 * pins git *discovery* (not pytest, not edits). A survey (2026-07-24) found 9 of 11 node kinds
 * can run arbitrary shell, and three nodes documented "read-only" (review, verify, research)
 * actually carry `Bash` — the read-only-ness lived in a comment, not the grant.
 *
 * This file turns that intent into code, with three jobs:
 *   1. LOCK the current grant of every node (`current`) so a future NODE_PROFILE edit that
 *      WIDENS a node's tools trips a test instead of shipping silently. Widening the daemon's
 *      attack surface must be a conscious, reviewed change.
 *   2. Declare each node's INTENT and its TARGET grant (`intent`, `target`, the confinement
 *      flags) — the goal state the enforcement work drives toward.
 *   3. Expose the GAP between current and target (`permissionGaps()`) as the enforcement backlog.
 *
 * This file changes NO runtime behavior. It is the map. The enforcement — replacing bypass with
 * a decide-never-ask permission layer that confines writes/exec to the worktree — is staged
 * separately, node class by node class, and is gated on verifying the CLI's headless
 * permission-mode + hook mechanics first (a tty-less child that PROMPTS hangs forever).
 */

import type { LeafNodeKind } from './leaf-executor';
import { VERIFY_GATE_MCP_TOOL } from './leaf-executor';

/** What a node is FOR — the lens for judging whether its grant is right.
 *  - 'read-only'   : inspects code and reports a verdict; must not write or run arbitrary shell.
 *  - 'planner'     : reads code and writes exactly ONE artifact (a blueprint / plan); no arbitrary exec.
 *  - 'writer'      : edits product code and runs its own checks; write+exec are legitimate, but must
 *                    stay inside the lane worktree.
 *  - 'narrow'      : acts ONLY through a fixed set of MCP verbs; no raw Write/Edit/Bash at all. */
export type NodeIntent = 'read-only' | 'planner' | 'writer' | 'narrow';

export interface NodePermissionEntry {
  intent: NodeIntent;
  /** The tools the node is granted RIGHT NOW (locked against NODE_PROFILE by the conformance
   *  test). Order-insensitive — compared as a set. */
  current: readonly string[];
  /** The tools the node SHOULD be granted once enforcement lands. When it differs from `current`
   *  the delta is the backlog item (see permissionGaps). */
  target: readonly string[];
  /** True when the node's writes (Edit/Write) must be confined to the lane worktree — a write to
   *  an absolute path outside it is the main-checkout leak (empty-diff misfile, 2026-07-24). */
  writeConfinedToWorktree: boolean;
  /** True when the node's shell/exec must be confined to the lane worktree — a `cd`-out + test run
   *  produces a good-faith false green against the wrong tree. */
  execConfinedToWorktree: boolean;
  /** Why this intent/target — the reviewed rationale, kept next to the grant it justifies. */
  notes: string;
}

const READ = 'Read';
const EDIT = 'Edit';
const WRITE = 'Write';
const GREP = 'Grep';
const GLOB = 'Glob';
const BASH = 'Bash';
const REPORT_MCP = 'mcp__mermaid__file_to_bucket';

/**
 * The spec. Every LeafNodeKind MUST have an entry (enforced by the coverage test).
 *
 * `current` is the truth as of 2026-07-24 and is LOCKED to NODE_PROFILE. `target` encodes the
 * decisions from the permission survey:
 *   - read-only nodes lose Bash (a read-only node with arbitrary shell is not read-only). Where a
 *     node legitimately runs ONE command (verify's typecheck, review's checks), the target is a
 *     pinned MCP verb, not raw Bash — added when that verb ships; until then Bash stays and the
 *     gap is recorded.
 *   - writer/planner nodes keep write+exec but gain worktree confinement (the flags), which the
 *     permission layer — not the tool list — will enforce.
 *   - blueprint is a PLANNER: it should write only its blueprint file and inspect via Grep/Glob,
 *     not hold general Write + Bash.
 */
export const NODE_PERMISSION_SPEC: Record<LeafNodeKind, NodePermissionEntry> = {
  blueprint: {
    intent: 'planner',
    current: [READ, WRITE, GREP, GLOB, BASH],
    target: [READ, WRITE, GREP, GLOB], // inspection via Grep/Glob; Write confined to the blueprint path
    writeConfinedToWorktree: true,
    execConfinedToWorktree: true,
    notes: 'Plans one leaf, writes ONE blueprint file. Does not need arbitrary Bash; its inspection is reads/greps. Write must not escape the blueprint artifact path.',
  },
  implement: {
    intent: 'writer',
    current: [READ, EDIT, GREP, GLOB, BASH],
    target: [READ, EDIT, GREP, GLOB, BASH],
    writeConfinedToWorktree: true,
    execConfinedToWorktree: true,
    notes: 'Edits product code and runs its own checks — both legitimate, but confined to the worktree. The main-checkout edit/test leak (2026-07-24) is exactly an unconfined Edit + unconfined Bash.',
  },
  wimplement: {
    intent: 'writer',
    current: [READ, EDIT, GREP, GLOB, BASH],
    target: [READ, EDIT, GREP, GLOB, BASH],
    writeConfinedToWorktree: true,
    execConfinedToWorktree: true,
    notes: 'Wave implement — same posture as implement.',
  },
  fix: {
    intent: 'writer',
    current: [READ, EDIT, GREP, GLOB, BASH],
    target: [READ, EDIT, GREP, GLOB, BASH],
    writeConfinedToWorktree: true,
    execConfinedToWorktree: true,
    notes: 'Surgical re-implement in place — same posture as implement.',
  },
  review: {
    intent: 'read-only',
    current: [READ, GREP, GLOB, BASH],
    target: [READ, GREP, GLOB, BASH], // Bash retained until a pinned check verb replaces it; GAP recorded via execConfinedToWorktree
    writeConfinedToWorktree: true,
    execConfinedToWorktree: true,
    notes: 'Documented read-only but holds Bash. Must never write. Its Bash (running the claimed checks) should become a pinned check verb; until then it stays but must be worktree-confined.',
  },
  verify: {
    intent: 'read-only',
    current: [READ, GREP, GLOB, BASH],
    target: [READ, GREP, GLOB, BASH], // Bash retained for bash-tsc until a pinned typecheck verb replaces it
    writeConfinedToWorktree: true,
    execConfinedToWorktree: true,
    notes: 'Runs a typecheck (bash-tsc) and reads — no writes. The typecheck should be a pinned run_typecheck verb, not raw Bash; until then Bash stays, worktree-confined.',
  },
  research: {
    intent: 'read-only',
    current: [READ, GREP, GLOB, BASH],
    target: [READ, GREP, GLOB], // pure read-only: no command it runs justifies arbitrary Bash
    writeConfinedToWorktree: true,
    execConfinedToWorktree: true,
    notes: 'Commented read-only. Its exploration is reads/greps via the Read/Grep tools; arbitrary Bash is unjustified and should be dropped.',
  },
  driveplan: {
    intent: 'planner',
    current: [READ, WRITE, GREP, GLOB, BASH],
    target: [READ, WRITE, GREP, GLOB], // authors an AssemblyBuildPlan; inspection via Grep/Glob
    writeConfinedToWorktree: true,
    execConfinedToWorktree: true,
    notes: 'Authors a plan artifact. Like blueprint, does not need arbitrary Bash; Write confined to the plan path.',
  },
  driveexec: {
    intent: 'writer',
    current: [READ, WRITE, BASH, VERIFY_GATE_MCP_TOOL],
    target: [READ, VERIFY_GATE_MCP_TOOL], // "constrained to the single gate verb" — make the grant match the comment
    writeConfinedToWorktree: true,
    execConfinedToWorktree: true,
    notes: 'Comment says constrained to ONE deterministic gate verb, but the grant also carries raw Write + Bash — the grant contradicts the intent. Target: the verb (plus Read), nothing else.',
  },
  report: {
    intent: 'narrow',
    current: [READ, GREP, GLOB, REPORT_MCP],
    target: [READ, GREP, GLOB, REPORT_MCP],
    writeConfinedToWorktree: true,
    execConfinedToWorktree: true,
    notes: 'Already narrow ✓ — reads, files findings via one MCP verb, emits the report as its final message (the executor persists it). No Bash, no raw Write. This is the target pattern.',
  },
  summary: {
    intent: 'read-only',
    current: [READ, GREP, GLOB],
    target: [READ, GREP, GLOB],
    writeConfinedToWorktree: true,
    execConfinedToWorktree: true,
    notes: 'Already read-only ✓ — reads a watched session and emits a summary. No Bash, no Write. This is the target pattern.',
  },
};

/** A single open enforcement item: a node whose live grant is wider than its target. */
export interface PermissionGap {
  kind: LeafNodeKind;
  intent: NodeIntent;
  /** Tools granted now but NOT in the target — the surface to remove/replace. */
  toRemove: string[];
  notes: string;
}

/** The enforcement backlog, derived from the spec: every node where `current` grants a tool the
 *  `target` does not. Pure over the spec — no store, no I/O. Ordered by node kind for stability. */
export function permissionGaps(
  spec: Record<LeafNodeKind, NodePermissionEntry> = NODE_PERMISSION_SPEC,
): PermissionGap[] {
  const out: PermissionGap[] = [];
  for (const kind of Object.keys(spec) as LeafNodeKind[]) {
    const e = spec[kind];
    const targetSet = new Set(e.target);
    const toRemove = e.current.filter((t) => !targetSet.has(t));
    if (toRemove.length > 0) out.push({ kind, intent: e.intent, toRemove, notes: e.notes });
  }
  return out;
}

/** Normalise an `allowedTools` string (space-separated, as NODE_PROFILE stores it) into a set,
 *  so the conformance test compares grants order- and whitespace-insensitively. */
export function toolSet(allowedTools: string): Set<string> {
  return new Set(allowedTools.split(/\s+/).filter(Boolean));
}
