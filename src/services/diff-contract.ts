/**
 * v2 diff contract: a superset of the v1 LeafSizeManifest (leaf-executor.ts) that adds a
 * leafKind classification and a closed set of mechanically-checkable requirements.
 * Absence/command-result are unrepresentable by construction — see DiffRequirement.
 * Standalone leaf module (mirrors split-decision.ts) to avoid a circular import with
 * leaf-executor.ts / todo-store.ts. NOT wired into any pipeline yet.
 */

import type { LeafSplitDecision } from './split-decision';
import { parseSplitDecision } from './split-decision';

/** Coarse, content-level classification carried IN the contract itself (independent of
 *  the todo's `type` field). */
export type DiffLeafKind = 'feature' | 'fix' | 'refactor' | 'test' | 'infra';

export const DIFF_LEAF_KINDS: DiffLeafKind[] = ['feature', 'fix', 'refactor', 'test', 'infra'];

/** A positive, citable fact: a named symbol exists in a named file. */
export interface SymbolPresentRequirement {
  kind: 'symbol-present';
  id: string;
  file: string;
  symbol: string;
  description: string;
}

/** A positive, citable fact: a named test exists. Decided mechanically — the literal
 *  `true` tag means a contract author cannot construct this with `mechanical: false`. */
export interface NamedTestRequirement {
  kind: 'named-test';
  id: string;
  testFile: string;
  testName: string;
  mechanical: true;
}

/** A positive, citable fact: a metric derived from gate output or a grep count compares
 *  to a value. `source` is a closed 2-member union — no `command`/`produce` member exists,
 *  so arbitrary shell execution is unrepresentable, not just discouraged. */
export interface ThresholdRequirement {
  kind: 'threshold';
  id: string;
  source: 'gate-output' | 'grep-count';
  metric: string;
  comparison: 'gte' | 'lte' | 'eq';
  value: number;
  mechanical: true;
}

/** A positive, citable behavioral expectation the diff should satisfy. LLM-decided:
 *  it carries NO `mechanical` literal, so a machine stage can never claim to have proven it. */
export interface ObservableRequirement {
  kind: 'observable';
  id: string;
  description: string;
}

/** A positive, cited invariant the diff must preserve (the TYPED positive form a "do not break X"
 *  takes — never an absence). LLM-decided: NO `mechanical` literal. */
export interface InvariantRequirement {
  kind: 'invariant';
  id: string;
  description: string;
}

export type DiffRequirement =
  | SymbolPresentRequirement
  | NamedTestRequirement
  | ThresholdRequirement
  | ObservableRequirement
  | InvariantRequirement;

/** A DiffRequirement's discriminant, reused so the matrix stays keyed to the same 3 kinds as
 *  the union — a 4th kind added to DiffRequirement forces a compile error here too. */
export type DiffRequirementKind = DiffRequirement['kind'];

/** §4 strictness matrix: for each of the 5 leafKinds, whether each of the 3 requirement kinds
 *  is a REQUIRED cell (the contract must carry at least one requirement of that kind) or an
 *  OPTIONAL cell (zero or more is fine). Every leafKind row must be a fully-covered
 *  Record<DiffRequirementKind, ...> or DIFF_LEAF_KINDS.map below silently under-checks.
 *
 *  - feature / fix: both require a symbol-present AND a named-test (the citable code change
 *    plus the test proving it) — threshold stays optional.
 *  - refactor: requires only symbol-present (the moved/renamed symbol) — a refactor is not
 *    obligated to add a new test if existing tests already cover the behavior.
 *  - test: requires only named-test — a test-only leaf has no new production symbol to cite.
 *  - infra: requires only symbol-present (the new config/wiring point) — infra leaves rarely
 *    ship their own test.
 */
export const CONTRACT_STRICTNESS_MATRIX: Record<DiffLeafKind, Record<DiffRequirementKind, 'required' | 'optional'>> = {
  feature: { 'symbol-present': 'required', 'named-test': 'required', threshold: 'optional', observable: 'optional', invariant: 'optional' },
  fix: { 'symbol-present': 'required', 'named-test': 'required', threshold: 'optional', observable: 'optional', invariant: 'optional' },
  refactor: { 'symbol-present': 'required', 'named-test': 'optional', threshold: 'optional', observable: 'optional', invariant: 'optional' },
  test: { 'symbol-present': 'optional', 'named-test': 'required', threshold: 'optional', observable: 'optional', invariant: 'optional' },
  infra: { 'symbol-present': 'required', 'named-test': 'optional', threshold: 'optional', observable: 'optional', invariant: 'optional' },
};

/** v2 superset of LeafSizeManifest (leaf-executor.ts:261-274). v1 fields are carried
 *  verbatim under the same names/shapes; v2 adds leafKind/requirements/outOfScope. */
export interface DiffContract {
  schemaVersion: 2;
  estimatedFiles: number;
  estimatedTasks: number;
  nonEnumerableFanout: boolean;
  filesToCreate: string[];
  filesToEdit: string[];
  tasks: Array<{ id: string; files: string[]; description: string }>;
  splitDecision?: LeafSplitDecision;
  splitDecisionMalformed?: boolean;
  leafKind: DiffLeafKind;
  requirements: DiffRequirement[];
  outOfScope: string[];
}

/** Enforces the §4 strictness matrix for one leafKind against an already-parsed contract's
 *  `requirements[]`. Returns the FIRST missing required cell (matrix key iteration order:
 *  'symbol-present', 'named-test', 'threshold') so a caller reports one concrete, exact field
 *  name at a time — never an aggregate list. `missingField` is always one of the 3 literal
 *  DiffRequirementKind strings, i.e. directly citable back to CONTRACT_STRICTNESS_MATRIX. */
export function validateContractForKind(
  contract: DiffContract,
  leafKind: DiffLeafKind,
): { underspecified: true; missingField: DiffRequirementKind } | { underspecified: false } {
  const cells = CONTRACT_STRICTNESS_MATRIX[leafKind];
  const present = new Set(contract.requirements.map((r) => r.kind));
  for (const kind of Object.keys(cells) as DiffRequirementKind[]) {
    if (cells[kind] === 'required' && !present.has(kind)) {
      return { underspecified: true, missingField: kind };
    }
  }
  return { underspecified: false };
}

const toStrArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function validateRequirement(raw: unknown): DiffRequirement | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && r.id.trim() ? r.id : null;
  if (id === null) return null; // every requirement must be addressable
  switch (r.kind) {
    case 'symbol-present': {
      if (
        typeof r.file === 'string' && r.file.trim() &&
        typeof r.symbol === 'string' && r.symbol.trim() &&
        typeof r.description === 'string' && r.description.trim()
      ) {
        return { kind: 'symbol-present', id, file: r.file, symbol: r.symbol, description: r.description };
      }
      return null;
    }
    case 'named-test': {
      if (
        typeof r.testFile === 'string' && r.testFile.trim() &&
        typeof r.testName === 'string' && r.testName.trim() &&
        r.mechanical === true
      ) {
        return { kind: 'named-test', id, testFile: r.testFile, testName: r.testName, mechanical: true };
      }
      return null;
    }
    case 'threshold': {
      if (
        (r.source === 'gate-output' || r.source === 'grep-count') &&
        typeof r.metric === 'string' && r.metric.trim() &&
        (r.comparison === 'gte' || r.comparison === 'lte' || r.comparison === 'eq') &&
        typeof r.value === 'number' && Number.isFinite(r.value) &&
        r.mechanical === true
      ) {
        return { kind: 'threshold', id, source: r.source, metric: r.metric, comparison: r.comparison, value: r.value, mechanical: true };
      }
      return null;
    }
    case 'observable': {
      if (typeof r.description === 'string' && r.description.trim()) {
        return { kind: 'observable', id, description: r.description };
      }
      return null;
    }
    case 'invariant': {
      if (typeof r.description === 'string' && r.description.trim()) {
        return { kind: 'invariant', id, description: r.description };
      }
      return null;
    }
    default:
      return null;
  }
}

/** Extract + validate the LAST ```json fence from any of the given sources into a
 *  {@link DiffContract}. FAIL-SAFE: ANY failure (no fence, JSON error, bad types, wrong
 *  schemaVersion, missing/invalid leafKind) ⇒ this source is skipped, trying the next;
 *  if no source parses, returns null. Never throws. Individual malformed `requirements`
 *  elements are dropped (filtered), not treated as a whole-contract failure. */
export function parseDiffContract(
  ...sources: Array<string | undefined>
): DiffContract | null {
  for (const src of sources) {
    if (!src) continue;
    const fences = [...src.matchAll(/```json\s*([\s\S]*?)```/g)];
    if (fences.length === 0) continue;
    const last = fences[fences.length - 1][1];
    try {
      const raw = JSON.parse(last) as Record<string, unknown>;
      if (raw.schemaVersion !== 2) continue;

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

      if (typeof raw.leafKind !== 'string' || !DIFF_LEAF_KINDS.includes(raw.leafKind as DiffLeafKind)) {
        continue;
      }
      const leafKind = raw.leafKind as DiffLeafKind;

      const tasksRaw = Array.isArray(raw.tasks) ? (raw.tasks as unknown[]) : [];
      const tasks = tasksRaw
        .map((t) => (t && typeof t === 'object' ? (t as Record<string, unknown>) : {}))
        .map((t) => ({
          id: typeof t.id === 'string' ? t.id : '',
          files: toStrArr(t.files),
          description: typeof t.description === 'string' ? t.description : '',
        }));

      const hasKey = Object.prototype.hasOwnProperty.call(raw, 'splitDecision');
      const decision = hasKey ? parseSplitDecision(raw.splitDecision) : null;

      const requirementsRaw = Array.isArray(raw.requirements) ? (raw.requirements as unknown[]) : [];
      const requirements = requirementsRaw
        .map((r) => validateRequirement(r))
        .filter((r): r is DiffRequirement => r !== null);

      return {
        schemaVersion: 2,
        estimatedFiles,
        estimatedTasks,
        nonEnumerableFanout,
        filesToCreate: toStrArr(raw.filesToCreate),
        filesToEdit: toStrArr(raw.filesToEdit),
        tasks,
        ...(decision ? { splitDecision: decision } : {}),
        ...(hasKey && !decision ? { splitDecisionMalformed: true } : {}),
        leafKind,
        requirements,
        outOfScope: toStrArr(raw.outOfScope),
      };
    } catch {
      /* not parseable — try the next source, else fall through to null */
    }
  }
  return null;
}

/** Emit a single ```json fenced block whose inner JSON round-trips losslessly through
 *  {@link parseDiffContract} — callers must only construct DiffContract values already in
 *  normalized form (no `undefined` mixed into string arrays; `splitDecision` omitted
 *  entirely when absent rather than set to `undefined`). */
export function renderContract(c: DiffContract): string {
  return '```json\n' + JSON.stringify(c, null, 2) + '\n```';
}

/** A per-requirement verdict emitted by one gating stage. `id` addresses the declared
 *  requirement this verdict decides — verdicts are keyed by requirement id, and an id
 *  absent from the contract is discarded downstream. `mechanical` is a runtime convention:
 *  it is `true` only for the mechanical stages (named-test / threshold / scope stages) and
 *  `false` for the LLM-decided observable/invariant stages. `status: 'undecided'` is the LLM
 *  ABSTAIN outcome (advisory, non-gating). `reason` is optional free text. `stage` is an open
 *  string label naming the stage that produced the verdict. */
/**
 * A single mechanical-stage finding from diffContractReview (mechanical:true).
 * The six-stage engine (stages 1–3,5–6) emits one entry per triggered breach /
 * decided requirement, deciding WITHOUT an LLM. `subject` is the changed/declared
 * file or the decided requirement (carrying its declared id); `decision` is the
 * mechanical outcome; `stage` names the producing stage. Only still-undecided
 * observable/invariant requirements are forwarded to the closed LLM ballot.
 */
export interface DiffContractVerdict {
  stage: string;
  subject: { kind: 'file'; path: string } | { kind: 'requirement'; id: string };
  decision: 'breach' | 'unmet' | 'met' | 'not-applicable';
  mechanical: boolean;
  reason: string;
}
