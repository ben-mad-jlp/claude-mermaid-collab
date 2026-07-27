/**
 * Parser utilities for leaf execution: size manifests, review verdicts, verify gates.
 * Extracted from leaf-executor.ts to separate concerns and enable reuse.
 */

import type { LeafSplitItem, LeafSplitDecision } from './split-decision';
import { parseSplitDecision } from './split-decision';
import type { Todo } from './todo-store';
import { VERIFY_GATE_VERB } from './leaf-prompts';

// Re-export types so they're available to users of leaf-parsing.ts
export type { LeafSplitItem, LeafSplitDecision } from './split-decision';

/**
 * P5 — structured size manifest the BLUEPRINT node emits as a trailing ```json
 * fenced block. Single source of truth for "what files/tasks a leaf touches";
 * ALSO consumed by the Bridge file-manifest (todo 86b2f019), so keep it
 * ADDITIVE-ONLY (bump {@link LeafSizeManifest.schemaVersion}, never repurpose a
 * field).
 */
export interface LeafSizeManifest {
  schemaVersion: number;
  estimatedFiles: number;
  estimatedTasks: number;
  nonEnumerableFanout: boolean;
  filesToCreate: string[];
  filesToEdit: string[];
  tasks: Array<{ id: string; files: string[]; description: string }>;
  /** SR-6: present iff the blueprint emitted a well-formed `splitDecision`. */
  splitDecision?: LeafSplitDecision;
  /** SR-6: true iff a `splitDecision` KEY was present but failed validation. The gate
   *  then takes the FLOOR — a malformed decision must never read as "split into N". */
  splitDecisionMalformed?: boolean;
}

export type ReviewLens = 'completeness' | 'regression-blast-radius';

/** The floor pipeline's review verdict. TRI-STATE, mirroring {@link VerifyGateVerdict}:
 *  - 'pass'  — a parseable `VERDICT: PASS` line.
 *  - 'fail'  — a parseable `VERDICT: FAIL` line: a real FINDING, feed it back to implement.
 *  - 'error' — empty/whitespace, or NO parseable VERDICT line at all: the reviewer said
 *              NOTHING. An INFRA failure, NOT a finding → park blocked (bug 80bacbc4: an
 *              empty provider response read as 'fail', so the executor re-ran implement
 *              against phantom findings and livelocked to node-budget exhaustion).
 *  Fail-closed is preserved: an 'error' is never an accept. Anything that is neither an
 *  explicit PASS nor an explicit FAIL is 'error' — a terse-but-real verdict is a PASS/FAIL
 *  line and is handled here; judging a review's DEPTH is out of scope (G2/G3). */
export type LeafReviewVerdict = 'pass' | 'fail' | 'error';

/** Result of a single review pass with a specific lens. */
export interface ReviewPassResult {
  lens: ReviewLens;
  verdict: 'pass' | 'fail';
  report: string;
}

/** The verify pipeline's domain-gate verdict (epic f5c7fc46), derived purely from the
 *  deterministic verb's raw JSON result. Three outcomes:
 *  - 'pass'  — gate(s) actually ran and all passed.
 *  - 'fail'  — gate(s) ran, at least one failed (or the plan errored/halted) → real findings.
 *  - 'error' — no usable result (empty / unparseable / NO gate ran = vacuous): an INFRA
 *              failure, NOT a finding → park blocked. The vacuous-result case is exactly the
 *              build123d T14 failure this epic fixes (a clean-looking result that verified
 *              nothing), so a result with zero gates is an error, never a silent pass. */
export interface VerifyGateVerdict {
  status: 'pass' | 'fail' | 'error';
  reasons: string[];
}

/** Strip the markdown wrapping a model often adds around a sentinel line — the prompts
 *  SHOW the sentinels in backticks, so the model echoes the backticks (and sometimes
 *  bold or quotes). A line-anchored regex then misses the sentinel and a clean/pass
 *  result reads as a failure (the L4 waves-file-stuck false-stuck). Normalize first;
 *  newlines are kept so line-anchored matching still works. */
function stripSentinelFmt(text: string): string {
  return text.replace(/[`*_"']/g, '');
}

export function parseVerdict(text: string | undefined): LeafReviewVerdict {
  if (!text || !text.trim()) return 'error';
  const m = stripSentinelFmt(text).match(/^\s*VERDICT:\s*(PASS|FAIL)\b/im);
  if (!m) return 'error';
  return m[1].toUpperCase() === 'PASS' ? 'pass' : 'fail';
}

/** Join multiple review pass results using stricter-wins logic. A fail in any pass yields
 *  an overall fail. Single pass returns verbatim. Empty array returns fail-closed. When
 *  joining ≥2 passes, quotes each sub-report's VERDICT: lines with `> ` prefix so the
 *  final appended VERDICT line is the one parseVerdict reads. */
export function joinReviewReports(passes: ReviewPassResult[]): { verdict: 'pass' | 'fail'; report: string; lenses: ReviewLens[] } {
  if (passes.length === 0) {
    return {
      verdict: 'fail',
      report: 'VERDICT: FAIL — no review passes',
      lenses: [],
    };
  }
  if (passes.length === 1) {
    return {
      verdict: passes[0].verdict,
      report: passes[0].report,
      lenses: [passes[0].lens],
    };
  }
  // ≥2 passes: quote sub-report VERDICT lines and append final verdict
  const quotedReports = passes.map((pass) => {
    const lines = pass.report.split('\n');
    const quotedLines = lines.map((line) =>
      line.match(/^\s*VERDICT:/i) ? `> ${line}` : line
    );
    return quotedLines.join('\n');
  });

  const anyFail = passes.some((p) => p.verdict === 'fail');
  const verdict = anyFail ? 'fail' : 'pass';

  const sections = passes.map((pass, idx) => `## Lens: ${pass.lens}\n${quotedReports[idx]}`);
  const finalVerdictLine = anyFail
    ? `VERDICT: FAIL — ${passes.filter((p) => p.verdict === 'fail').map((p) => p.lens).join(', ')} raised concerns`
    : 'VERDICT: PASS';

  return {
    verdict,
    report: [...sections, finalVerdictLine].join('\n\n'),
    lenses: passes.map((p) => p.lens),
  };
}

/** Extract the JSON object from a node's echoed result, tolerant of surrounding prose. The
 *  driveexec node often wraps the PlanReport in commentary ("Raw result:", a ```json fence,
 *  an "Execution note:" trailer), so a whole-string fence match is too strict. Prefer a fenced
 *  block anywhere; else fall back to the outermost {...}. */
function unfenceJson(text: string): string {
  const t = text.trim();
  const fenced = t.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  if (fenced && fenced[1].includes('{')) return fenced[1].trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) return t.slice(first, last + 1);
  return t;
}

/** Extract + validate the LAST ```json fence from any of the given sources into a
 *  {@link LeafSizeManifest}. FAIL-SAFE: ANY failure (no fence, JSON error, bad
 *  types) ⇒ returns null; a null manifest ⇒ the FLOOR (linear) fail-safe, an oversized
 *  one (> SPLIT_CEILING enumerated files) ⇒ pre-flight auto-split.
 *  Mirrors parseVerdict's fail-closed posture; never throws. Exported (shared with
 *  the Bridge file-manifest, todo 86b2f019). */
export function parseSizeManifest(
  ...sources: Array<string | undefined>
): LeafSizeManifest | null {
  for (const src of sources) {
    if (!src) continue;
    const fences = [...src.matchAll(/```json\s*([\s\S]*?)```/g)];
    if (fences.length === 0) continue;
    const last = fences[fences.length - 1][1];
    try {
      const raw = JSON.parse(last) as Record<string, unknown>;
      const estimatedFiles = raw.estimatedFiles;
      const estimatedTasks = raw.estimatedTasks;
      const nonEnumerableFanout = raw.nonEnumerableFanout;
      if (
        typeof estimatedFiles !== 'number' || !Number.isFinite(estimatedFiles) || estimatedFiles < 0 ||
        typeof estimatedTasks !== 'number' || !Number.isFinite(estimatedTasks) || estimatedTasks < 0 ||
        typeof nonEnumerableFanout !== 'boolean'
      ) {
        continue;
      }
      const toStrArr = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
      const tasksRaw = Array.isArray(raw.tasks) ? (raw.tasks as unknown[]) : [];
      const tasks = tasksRaw
        .map((t) => (t && typeof t === 'object' ? (t as Record<string, unknown>) : {}))
        .map((t) => ({
          id: typeof t.id === 'string' ? t.id : '',
          files: toStrArr(t.files),
          description: typeof t.description === 'string' ? t.description : '',
        }));
      // SR-6: parse the optional splitDecision. A key present but malformed → tri-state.
      const hasKey = Object.prototype.hasOwnProperty.call(raw, 'splitDecision');
      const decision = hasKey ? parseSplitDecision(raw.splitDecision) : null;
      return {
        schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1,
        estimatedFiles,
        estimatedTasks,
        nonEnumerableFanout,
        filesToCreate: toStrArr(raw.filesToCreate),
        filesToEdit: toStrArr(raw.filesToEdit),
        tasks,
        ...(decision ? { splitDecision: decision } : {}),
        ...(hasKey && !decision ? { splitDecisionMalformed: true } : {}),
      };
    } catch {
      /* not parseable — try the next source, else fall through to null */
    }
  }
  return null;
}

/** Parse build_assembly_plan's raw PlanReport result into a {@link VerifyGateVerdict}. Pure +
 *  unit-testable, tolerant of markdown-fenced JSON. The real shape (confirmed L4 against the
/** The build123d MCP server key (its FastMCP name — `FastMCP("bsync-cad")`, registered in
 *  build123d-ocp-mcp/.mcp.json). A Claude Code node addresses its tools as
 *  `mcp__bsync-cad__<verb>`. Confirmed against the live MCP in L4. */
export const VERIFY_GATE_MCP_SERVER = 'bsync-cad';
/** Map a gate verb to the MCP-namespaced tool the execute node is allowlisted to. Kept as one
 *  function so every call site generalizes together. */
export function verbMcpTool(verb: string): string {
  return `mcp__${VERIFY_GATE_MCP_SERVER}__${verb}`;
}
/** The default verb's MCP tool — NODE_PROFILE.driveexec's static allowlist fallback. The
 *  pipeline recomputes the allowlist per-leaf from the resolved config (so a non-default verb
 *  is allowlisted correctly); this keeps the profile table total. */
export const VERIFY_GATE_MCP_TOOL = verbMcpTool(VERIFY_GATE_VERB);

/** The verify pipeline's domain gate, made PLUGGABLE in L3 (epic f5c7fc46 e9ce8693). A gate
 *  is a deterministic VERB (an MCP tool the execute node calls — its returned geometry/DOF/
 *  clearance verdicts are parsed by {@link parseVerifyGate}) and/or an optional COMMAND (a
 *  shell gate, e.g. `pytest -q`, composed AFTER the verb gate). This is the single seam other
 *  verify configs extend through: cartographer spec-sync (verb: check_graph_drift), asset-gen
 *  fitness, a pure-pytest dogfood — each lands as a CONFIG here with ZERO new dispatch in
 *  runVerifyPipeline (the hygiene that keeps a future recipe-registry extraction cheap). */
export interface VerifyGateConfig {
  /** The deterministic MCP verb the execute node invokes. Defaults to {@link VERIFY_GATE_VERB}. */
  verb: string;
  /** Optional shell command gate run in the worktree AFTER the verb gate; its non-zero exit is
   *  a FINDING (not an executor failure), composed into the report alongside the verb verdicts. */
  command?: string;
}

/** Resolve a verify leaf's gate config. L3 keys off `leaf.type`; today every verify type maps
 *  to the build_assembly_plan verb (no command), so this is behavior-identical to L2 — the
 *  POINT is the extension seam, not new routing. Add a case here (not new pipeline code) to
 *  introduce a new verify gate. Pure + unit-testable. */
export function resolveVerifyGate(leaf: Todo): VerifyGateConfig {
  // (future) switch on (leaf.type ?? '').toLowerCase() to pick verb/command per domain.
  return { verb: VERIFY_GATE_VERB };
}

/** Parse build_assembly_plan's raw PlanReport result into a {@link VerifyGateVerdict}. Pure +
 *  unit-testable, tolerant of markdown-fenced JSON. The real shape (confirmed L4 against the
 *  bsync-cad MCP) is:
 *    { ok: bool, error: str|null, halted_at: str|null,
 *      nodes: [ { node, op, ok, detail, attempts, repairs,
 *                 gates: [ { name, passed, detail } ] } ] }
 *  where gate `name` ∈ {validity, dof, mobility, clearance, contract}. A finding is any gate
 *  with passed:false, plus a top-level error/halt. PASS requires ≥1 gate ran AND none failed
 *  AND ok!==false. Zero gates ⇒ 'error' (vacuous — verified nothing). */
export function parseVerifyGate(resultText: string | undefined): VerifyGateVerdict {
  if (!resultText || !resultText.trim()) {
    return { status: 'error', reasons: ['verify-gate: empty verb result'] };
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(unfenceJson(resultText)) as Record<string, unknown>;
  } catch {
    return { status: 'error', reasons: ['verify-gate: unparseable verb result (not JSON)'] };
  }
  if (!raw || typeof raw !== 'object') {
    return { status: 'error', reasons: ['verify-gate: verb result is not a JSON object'] };
  }
  const reasons: string[] = [];
  // Top-level plan error / halt (the plan itself was rejected or execution stopped).
  if (typeof raw.error === 'string' && raw.error) {
    const halt = typeof raw.halted_at === 'string' && raw.halted_at ? ` (halted at ${raw.halted_at})` : '';
    reasons.push(`plan error: ${raw.error}${halt}`);
  }
  // Walk every node's gates; count how many actually ran (the anti-vacuous guard).
  let gatesRan = 0;
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    const node = n as Record<string, unknown>;
    const nodeId = typeof node.node === 'string' ? node.node : '?';
    const gates = Array.isArray(node.gates) ? node.gates : [];
    for (const g of gates) {
      if (!g || typeof g !== 'object') continue;
      const gate = g as Record<string, unknown>;
      gatesRan += 1;
      if (gate.passed === false) {
        const name = typeof gate.name === 'string' ? gate.name : 'gate';
        const detail = typeof gate.detail === 'string' && gate.detail ? `: ${gate.detail}` : '';
        reasons.push(`${nodeId} / ${name} failed${detail}`);
      }
    }
    // A node that failed without surfacing a failed gate is still a finding.
    if (node.ok === false && gates.every((g) => !g || typeof g !== 'object' || (g as Record<string, unknown>).passed !== false)) {
      const detail = typeof node.detail === 'string' && node.detail ? `: ${node.detail}` : '';
      reasons.push(`node ${nodeId} failed${detail}`);
    }
  }
  // Vacuous result — nothing was actually gated. Never a silent pass (the T14 failure mode).
  if (gatesRan === 0 && reasons.length === 0) {
    return { status: 'error', reasons: ['verify-gate: no gates ran (vacuous result — verified nothing)'] };
  }
  // Top-level ok:false with no other reason captured.
  if (raw.ok === false && reasons.length === 0) reasons.push('plan reported ok:false');
  return { status: reasons.length ? 'fail' : 'pass', reasons };
}
