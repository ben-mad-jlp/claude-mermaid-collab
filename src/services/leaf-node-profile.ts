import { join } from 'node:path';
import type { LeafNodeKind } from './leaf-prompts';
import type { EffortLevel } from '../agent/contracts';
import { VERIFY_GATE_MCP_TOOL } from './leaf-parsing';

/** Node wall-clock cap for the verify EXECUTE node. The default 600s node timeout is sized for
 *  a code node; a CAD assembly build (load vendor STEP parts → build subassemblies → run
 *  geometry/DOF/clearance gates) legitimately runs longer, and the L4 dogfood hit the 600s
 *  kill mid-build. 20min gives heavy assemblies room while still bounding a true runaway. */
export const VERIFY_EXEC_TIMEOUT_MS = 1_200_000;

/** Per-node model + tool allowlist (blueprint §3). Bash is read-only by prompt
 *  convention (the CLI has no RO-bash flag). The space-separated list is passed
 *  straight to `--allowedTools` by the P1 invoker. */
/** Per-node reasoning effort baseline (epic: daemon-set effort). Reasoning-heavy
 *  nodes (the opus ones: blueprint/review/driveplan) default to 'high'; the
 *  implementation/read nodes (sonnet) default to 'medium'. A per-project override
 *  (getProjectEffort) or MERMAID_NODE_EFFORT can replace these uniformly. */
/** Every leaf-executor node kind, in a stable display order (drives the matrix editor). */
export const LEAF_NODE_KINDS: LeafNodeKind[] = [
  'blueprint', 'implement', 'review',
  'research', 'wimplement', 'verify', 'fix',
  'driveplan', 'driveexec', 'report',
  'explore',
  'lens', 'commander',
  'summary',
];

/** Wall-clock cap for nodes that DO the build (implement-class). The invoker default
 *  (600s) killed real work mid-build — long implement runs are routine, especially on a
 *  Haiku node_profile_override pin. Stall detection is NOT slowed by this: the invoker's
 *  START WINDOW still kills a zero-output node at 600s (see node-invoker START_WINDOW_MS). */
export const IMPLEMENT_TIMEOUT_MS = 1_800_000;

/** Wall-clock cap for the blueprint node. Distinct from (and smaller than)
 *  {@link IMPLEMENT_TIMEOUT_MS} — blueprint does not edit code, but a large REMOVAL leaf's
 *  blueprint node was observed GROUNDING (enumerating every site to delete) past the
 *  invoker's 600s default before it ever reaches the citability gate, parking correct work
 *  as a start-window/timeout failure rather than a real rejection. 900s gives it room without
 *  matching implement's 1800s (blueprint still writes no code — a runaway blueprint should
 *  fail faster than a runaway build). */
export const BLUEPRINT_TIMEOUT_MS = 900_000;

/** Explore-node tool allowlist.
 *
 *  WAS DEAD UNTIL 2026-08-11: this constant was defined, exported, re-exported through
 *  leaf-executor — and never read. NODE_PROFILE.explore carried a hardcoded 'Read Grep Glob
 *  Bash' instead, so the explore node could not call `file_finding` and had no way to write
 *  the typed Finding its whole output path is built around. The deferral is in the original
 *  comment ("the wiring is criterion 1's responsibility"); criterion 1 never landed it.
 *
 *  The `desktop_*` verbs drive a real Electron app over CDP (electron-agent-bridge), so an
 *  explore node can audit a RUNNING UI instead of reasoning about React source: compare
 *  rendered values against the database, find a control wired to nothing, catch a stale
 *  binding. Reading the code cannot see any of that.
 *
 *  DESTRUCTIVE BY DESIGN. `desktop_click`/`desktop_fill`/`desktop_eval` can take any action the
 *  UI can — including landing an epic or dropping a todo — and `desktop_eval` runs arbitrary JS
 *  in the renderer. The blast radius is bounded by WHAT THE REQUEST POINTS AT, not by the
 *  allowlist: scope an exploration to a project whose state you are willing to lose. */
export const EXPLORE_NODE_ALLOWED_TOOLS = [
  'Read', 'Grep', 'Glob', 'Bash',
  'mcp__mermaid__file_finding',
  // Observation
  'mcp__mermaid__desktop_snapshot',
  'mcp__mermaid__desktop_screenshot',
  'mcp__mermaid__desktop_list_targets',
  'mcp__mermaid__desktop_wait_for',
  // Interaction — see the destructive-by-design note above
  'mcp__mermaid__desktop_navigate',
  'mcp__mermaid__desktop_click',
  'mcp__mermaid__desktop_fill',
  'mcp__mermaid__desktop_eval',
].join(' ');

export const NODE_PROFILE: Record<LeafNodeKind, { model: string; allowedTools: string; effort: EffortLevel; timeoutMs?: number }> = {
  // Demoted opus→sonnet (2026-07-21): blueprint was the #1 cost center ($368/wk, more than
  // implement) with no measured reliability gain over sonnet at 'high' effort. A project that
  // wants opus back can set a per-(project,kind) override (resolveNodeModel in node-provider.ts).
  // Effort stays 'high' — reasoning depth, not model tier, is what blueprint needs most.
  blueprint: { model: 'sonnet', allowedTools: 'Read Write Grep Glob Bash', effort: 'high', timeoutMs: BLUEPRINT_TIMEOUT_MS },
  implement: { model: 'sonnet', allowedTools: 'Read Edit Write Grep Glob Bash', effort: 'medium', timeoutMs: IMPLEMENT_TIMEOUT_MS },
  review: { model: 'opus', allowedTools: 'Read Grep Glob Bash', effort: 'high' },
  // P5 waves:
  research: { model: 'sonnet', allowedTools: 'Read Grep Glob Bash', effort: 'medium' }, // read-only (spec §12: sonnet for non-blueprint/review)
  wimplement: { model: 'sonnet', allowedTools: 'Read Edit Write Grep Glob Bash', effort: 'medium', timeoutMs: IMPLEMENT_TIMEOUT_MS }, // read+edit
  verify: { model: 'sonnet', allowedTools: 'Read Grep Glob Bash', effort: 'medium' }, // read + bash-tsc
  fix: { model: 'sonnet', allowedTools: 'Read Edit Write Grep Glob Bash', effort: 'medium', timeoutMs: IMPLEMENT_TIMEOUT_MS }, // read+edit
  // verify pipeline (epic f5c7fc46): plan authors an AssemblyBuildPlan; driveexec is
  // CONSTRAINED to the single deterministic gate verb (invokes, authors nothing); report
  // writes+commits findings and files one session-todo per finding.
  driveplan: { model: 'opus', allowedTools: 'Read Write Grep Glob Bash', effort: 'high' },
  driveexec: { model: 'sonnet', allowedTools: `Read Write Bash ${VERIFY_GATE_MCP_TOOL}`, effort: 'medium' },
  // No Bash, no Write: the report node only READS the verdicts, files finding todos via MCP,
  // and EMITS the report markdown as its final message — the EXECUTOR writes it into the
  // worktree + commits it (L5: a node's new-file Write resolves to the project root, not the
  // worktree, so a node-written report never reaches mergeToEpic → accept reverses).
  report: { model: 'sonnet', allowedTools: 'Read Grep Glob mcp__mermaid__file_bugfix', effort: 'medium' },
  // explore shape: investigation that emits a findings report. Drives a live UI over CDP when
  // the request points at one — the allowlist is the constant above, not a literal, because a
  // literal here is exactly how that constant sat dead and unread since 2026-08-07.
  explore: { model: 'sonnet', allowedTools: EXPLORE_NODE_ALLOWED_TOOLS, effort: 'high' },
  // Judgment roles: campaign completion ruling (read-only, high-reasoning rulings over evidence)
  lens: { model: 'opus', allowedTools: 'Read Grep Glob Bash', effort: 'high' },
  commander: { model: 'opus', allowedTools: 'Read Grep Glob Bash', effort: 'high' },
  // zen mode (design-zen-mode Phase 4): summarizes a watched session's progress. Read-only;
  // emits the summary as its final message (consumed by Z7). Default sonnet (claude-sonnet-4-6).
  summary: { model: 'sonnet', allowedTools: 'Read Grep Glob', effort: 'low' },
};

/** In-place start-failure escalation target (see the `escalatedKinds` mechanism in runLeaf):
 *  a node that starts failing on its pinned model retries ONCE on something STRONGER. This
 *  used to just read NODE_PROFILE.blueprint.model, which worked while blueprint was pinned to
 *  opus — but blueprint was demoted to sonnet (cost), which would have silently made the
 *  escalation a no-op for every kind already pinned at sonnet (implement, driveexec, ...).
 *  Kept as an explicit constant so a future blueprint-tier change can't neuter escalation again. */
export const ESCALATION_MODEL = 'opus';

/** SR-7: a split child inherits its parent's plan slice, so its blueprint node RECONCILES
 *  instead of re-deriving. Cheap model, low effort. It is NOT skipped: the parent plan
 *  encodes cross-file contracts + test strategy that later siblings can invalidate, and
 *  SR-6's dependsOn bounds — but does not eliminate — that staleness. */
export const BLUEPRINT_REFRESH_PROFILE = { model: 'sonnet', effort: 'low' as EffortLevel };

/**
 * Absolute path of a leaf's per-run stream-json transcript, under the TRACKING
 * project (stable; the reader endpoint resolves the same path). Every node of the
 * leaf appends here with a boundary marker, so the file reads as one transcript
 * across the leaf's plan→build→verify→report chain (and across retries). Exported
 * so the reader route resolves the identical path.
 */
export function leafTranscriptPath(project: string, leafId: string): string {
  return join(project, '.collab', 'leaf-transcripts', `${leafId}.jsonl`);
}
