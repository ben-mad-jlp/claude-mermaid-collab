/**
 * Prompt builders for leaf nodes and their owned string constants.
 *
 * All 7 floor + verify-pipeline inline prompt builders are here, alongside the string
 * arrays + constants they exclusively reference. The ONLY symbols leaf-executor.ts needs
 * are the 7 exported builders, plus the path functions blueprintPath / verify*Path /
 * reviewReportPath (for both prompts and internal use) and VERIFY_GATE_VERB (for both).
 * Everything else (the manifest schema rules, the manifest-glob rules, etc.) stays private
 * and is never imported back.
 */

import type { Todo } from './todo-store';
import type { ExploreSpec } from './todo-store';
import { EXPLORE_REPORT_SENTINEL, VERIFY_GATE_VERB } from './leaf-parsing';
import type { ReviewLens } from './leaf-parsing';
import type { OrchestrationNodeKind } from './node-kinds';
import { ORCHESTRATION_NODE_KINDS } from './node-kinds';
import { COMPILE_CHECK_INSTRUCTION } from './compile-gate';

/** Node kinds. The floor chains blueprint→implement→review (unchanged). P5 adds the
 *  wave kinds (research/wimplement/verify/fix); `'implement'` stays RESERVED for the
 *  floor so floor ledger rows are byte-identical. */
export type LeafNodeKind =
  | 'blueprint' | 'implement' | 'review' // floor (unchanged)
  | 'research' | 'wimplement' | 'verify' | 'fix' // waves (P5)
  | 'driveplan' | 'driveexec' | 'report' // verify pipeline (epic f5c7fc46)
  | 'explore' // explore shape: read-only investigation, emits a findings report
  | 'summary'; // zen mode (design-zen-mode Phase 4): session-summary model knob

/** Re-exported for the existing import sites (leaf-executor imports it from here). The
 *  constant is DEFINED in leaf-parsing — see the note there: defining it in this module
 *  closes a value-level import cycle and TDZ-crashes at module init. */
export { VERIFY_GATE_VERB };

/** One-line description of what each node kind does — surfaced in the matrix editor. */
export const NODE_KIND_DESCRIPTIONS: Record<LeafNodeKind, string> = {
  blueprint: 'Floor: plans the leaf — authors the implementation blueprint the later nodes follow.',
  implement: 'Floor: writes the code per the blueprint (single-shot).',
  review: 'Floor: reviews the implementation against the blueprint; failure drives a retry.',
  research: 'Waves: read-only investigation per task before any edits.',
  wimplement: 'Waves: implements one file/target (read + edit).',
  verify: 'Waves: checks one file (e.g. runs tsc) and reports pass/fail.',
  fix: 'Waves: fixes a file that failed verify (same error twice ⇒ stuck).',
  driveplan: 'Verify pipeline: authors an AssemblyBuildPlan — plan only, no code.',
  driveexec: 'Verify pipeline: constrained to the single deterministic gate verb; authors nothing.',
  report: 'Verify pipeline: files one todo per finding and emits the report markdown.',
  explore: 'Explore: read-only investigation of an open question; emits a findings report.',
  summary: 'Zen mode: summarizes a watched interactive session into a short progress summary.',
};

/** Pipeline grouping for the node-kind matrix editor (UI: DaemonNodesMatrix).
 *  The single source of truth for which kinds belong to which pipeline + when
 *  each pipeline actually fires. Ordered; Floor first. `defaultCollapsed` drives
 *  the matrix's initial expand/collapse. Kinds must partition LEAF_NODE_KINDS ∪
 *  ORCHESTRATION_NODE_KINDS. */
export interface LeafNodeGroup {
  key: 'floor' | 'verify-cad' | 'orchestration' | 'explore';
  label: string;
  firesWhen: string;
  kinds: (LeafNodeKind | OrchestrationNodeKind)[];
  defaultCollapsed: boolean;
}

/** Node kinds that are NOT shown in the daemon-nodes settings matrix — kept as valid LeafNodeKinds
 *  (historical ledger rows, resume, NODE_PROFILE defaults) but deliberately hidden from the config UI:
 *   - the RETIRED wave kinds (research/wimplement/verify/fix): the fan-out path no longer runs
 *     (2026-07-08) — every leaf runs linear (FLOOR) and oversized leaves auto-split, so there is
 *     nothing to configure.
 *   - 'summary' (the Zen session-summary interpret model): configured by the summary loop, never run
 *     via runNode — it was only ever a non-configurable placeholder in the matrix.
 *  The route excludes these from the served rows and there is no group for them, so the matrix does
 *  not render an empty "Waves"/"Zen" section. */
export const MATRIX_HIDDEN_NODE_KINDS: LeafNodeKind[] = ['research', 'wimplement', 'verify', 'fix', 'summary'];

export const LEAF_NODE_GROUPS: LeafNodeGroup[] = [
  {
    key: 'floor', label: 'Floor', defaultCollapsed: false,
    firesWhen: 'Always — the default code-leaf path (blueprint → implement → review).',
    kinds: ['blueprint', 'implement', 'review'],
  },
  {
    key: 'verify-cad', label: 'Verify / CAD', defaultCollapsed: true,
    firesWhen: 'Only when leaf.type ∈ verify | cad-dogfood | dogfood (build-assembly geometry gate) — never for ordinary backend/ui leaves.',
    kinds: ['driveplan', 'driveexec', 'report'],
  },
  {
    key: 'orchestration', label: 'Orchestration', defaultCollapsed: false,
    firesWhen: 'Runs ABOVE the per-leaf pipeline, not per-leaf: mission forge (doc → mission), '
      + 'the autonomous conductor (drives a mission tick), and the criterion planner (decomposes '
      + 'a criterion into an epic).',
    kinds: ORCHESTRATION_NODE_KINDS,
  },
  {
    key: 'explore', label: 'Explore', defaultCollapsed: true,
    firesWhen: 'Only when leaf.type === explore — a read-only investigation whose deliverable is a committed report.',
    kinds: ['explore'],
  },
];

/** Fixed in-worktree path the blueprint node writes to and the later nodes read. */
export function blueprintPath(leaf: Todo): string {
  return `.collab/leaf-blueprints/${leaf.id}.md`;
}

/** Verify pipeline artifacts (epic f5c7fc46), all worktree-relative. The plan node writes
 *  the AssemblyBuildPlan; the execute node writes the verb's raw result; the report node
 *  writes the committed findings report. The first two are read back deterministically so
 *  the gate parses the verb's TRUE output, not the model's prose. */
export function verifyPlanPath(leaf: Todo): string {
  return `.collab/leaf-verify/${leaf.id}.plan.json`;
}
export function verifyResultPath(leaf: Todo): string {
  return `.collab/leaf-verify/${leaf.id}.result.json`;
}
export function verifyReportPath(leaf: Todo): string {
  return `docs/verify/${leaf.id}.report.md`;
}

/** The committed deliverable of a `review`-shape leaf (epic d8ac1a18 dogfood): a
 *  completeness-review report over the epic's union change-set. Worktree-relative;
 *  the executor writes + commits it (the node only emits the markdown), so the
 *  completion gate's work-committed re-verify sees real work. */
export function reviewReportPath(leaf: Todo): string {
  return `docs/review/${leaf.id}.report.md`;
}

/** The committed deliverable of an `explore`-shape leaf: a findings report
 *  emitted by the explore node. Worktree-relative; the executor writes + commits it. */
export function exploreReportPath(leaf: Todo): string {
  return `docs/explore/${leaf.id}.report.md`;
}

/** Stable per-leaf lane name. WorktreeManager keys records on this; `fresh:true`
 *  tears down the prior dir+branch so every attempt is a NEW branch off the tip. */
export function leafSessionKey(leaf: Todo): string {
  return `leaf-exec-${leaf.id.slice(0, 8)}`;
}

/** The FINISH-with-trailing-json-fence instruction + the size-manifest schema itself,
 *  shared VERBATIM by every blueprint-authoring prompt (buildNodePrompt's 'blueprint' case,
 *  buildBlueprintRefreshPrompt, buildCriteriaRepairPrompt, buildBlueprintRepairPrompt) so the
 *  schema can never drift between them. */
export const MANIFEST_JSON_SCHEMA_LINES: readonly string[] = [
  'FINISH the blueprint file with EXACTLY ONE trailing fenced ```json block (the machine-readable',
  'diff contract — the prose blueprint goes above it). It MUST be the LAST json fence in the file',
  'and parse as (schemaVersion 2 — a TYPED diff contract):',
  '```json',
  '{ "schemaVersion": 2, "leafKind": "feature|fix|refactor|test|infra",',
  '  "estimatedFiles": <int>, "estimatedTasks": <int>, "nonEnumerableFanout": <bool>,',
  '  "filesToCreate": ["<path>"], "filesToEdit": ["<path>"],',
  '  "tasks": [ { "id": "<slug>", "files": ["<path>"], "description": "<one line>" } ],',
  '  "requirements": [   // include ONLY the entries that apply; these five are the available FORMS, not a template to fill',
  '    { "kind": "symbol-present", "id": "<slug>", "file": "<path>", "symbol": "<name>", "description": "<one line>" },',
  '    { "kind": "named-test",     "id": "<slug>", "testFile": "<path>", "testName": "<exact test title>", "mechanical": true },',
  '    { "kind": "threshold",      "id": "<slug>", "source": "grep-count|gate-output", "metric": "<what is counted>", "comparison": "gte|lte|eq", "value": <int>, "mechanical": true },',
  '    { "kind": "observable",     "id": "<slug>", "description": "<a behavior the diff must satisfy, no single symbol/test>" },',
  '    { "kind": "invariant",      "id": "<slug>", "description": "<a property the diff must PRESERVE>" } ],',
  '  "outOfScope": ["<path or concern the diff must NOT touch>"],',
  '  "splitDecision": { "split": <bool>, "reason": "<why>",',
  '    "items": [ { "id": "<slug>", "files": ["<path>"], "dependsOn": ["<slug>"] } ] } }',
  '```',
];

/** The touchpoint-glob escape-hatch rule (a hash-named/generator-emitted file MAY be declared
 *  as a glob instead of an exact path) — shared by every prompt that documents the manifest
 *  schema above. */
const MANIFEST_GLOB_RULE_LINE =
  'A touchpoint whose exact name is unknowable in advance (e.g. a hash-named file a generator '
  + 'emits) MAY be declared as a GLOB pattern (`*`/`**`) in filesToCreate/filesToEdit instead of '
  + 'an exact path.';

/** The estimatedFiles/estimatedTasks/nonEnumerableFanout field glossary + the glob rule,
 *  appended right after MANIFEST_JSON_SCHEMA_LINES in the two FULL blueprint-authoring
 *  prompts (buildNodePrompt's 'blueprint' case and buildBlueprintRefreshPrompt). The two
 *  repair prompts state the glob rule earlier (as part of restating the offending criterion)
 *  and skip this trailing glossary. */
export const MANIFEST_SCHEMA_NOTES_LINES: readonly string[] = [
  'estimatedFiles = total distinct files created+edited. estimatedTasks = number of',
  'independent units of work. nonEnumerableFanout = true ONLY if there are sites you',
  'CANNOT statically enumerate (dynamic dispatch, string-keyed/reflective call sites).',
  MANIFEST_GLOB_RULE_LINE,
  'Turn EACH acceptance criterion into a REQUIREMENT using the TYPED form that fits — never prose:',
  'a code change that must exist -> symbol-present (its file + symbol); a test that must pass ->',
  'named-test (exact testFile + testName); a count/metric bound -> threshold (grep-count|gate-output);',
  'a property to PRESERVE (the positive form of "do not break/remove X") -> invariant; a behavior with',
  'no single symbol or test -> observable. There is NO way to express "X is absent", "no file does Y",',
  'or "run command Z" — restate any such criterion as a POSITIVE symbol-present / named-test /',
  'threshold / invariant. Required per leafKind: feature & fix need >=1 symbol-present AND >=1',
  'named-test; refactor & infra need >=1 symbol-present; test needs >=1 named-test.',
];

/** Cost lever (ledger: blueprint output ≈ implement output in weekly token volume, all prose).
 *  Shared VERBATIM by every prompt that asks a node to author or re-author the FULL blueprint
 *  body (buildNodePrompt's 'blueprint' case, buildBlueprintRefreshPrompt, and the two repair
 *  prompts, which re-emit the whole blueprint after a targeted fix) so the budget can never
 *  drift between them. Adds a length ceiling and bans verbosity classes that cost tokens but
 *  give the implementer no signal — it does NOT relax any citability/manifest/glob rule above. */
const BLUEPRINT_CONCISENESS_RULES_LINES: readonly string[] = [
  'LENGTH BUDGET: the blueprint prose (everything above the trailing json fence) fits ~120 lines',
  '/ ~1000 words for a normal leaf. Go longer ONLY when the leaf genuinely spans many files or',
  'tasks — length is not a proxy for rigor, and a short blueprint for a small leaf is correct, not',
  'lazy.',
  'Do NOT: quote or restate existing code/file contents (cite `file:line` instead), narrate your',
  'exploration ("I read...", "I found that..."), repeat the task title/description back, give',
  'step-by-step keystroke-level instructions, or hand out generic advice with no leaf-specific',
  'signal ("write clean code", "handle errors", "add tests"). The blueprint is a CONTRACT for a',
  'competent implementer who can already read the code: WHAT to build, WHERE (file:line',
  'touchpoints), the acceptance criteria, and any risk/invariant NOT obvious from the code —',
  'nothing else.',
  'REMOVAL/DELETION leaves specifically: do NOT enumerate every deleted symbol or line — that is',
  'exactly the verbosity this budget bans, and it is what times out a large removal blueprint before',
  'it ever reaches acceptance criteria. Instead name: the modules/entry points to remove, the',
  'surviving references that must be updated to stop pointing at them, and the zero-match gates (see',
  'the DELETION/REMOVAL criteria rules) that prove the removal is complete.',
];

/** Deletion/removal leaves assert an ABSENCE — but bare prose ("X no longer exists", "Y is
 *  untouched") is uncitable and is rejected by BOTH the blueprint-time citability gate
 *  (criteria-citability.ts's classifyCriterion, Rule 3 convictOnAbsence) and the terminal G3
 *  review-grounding gate (review-citations.ts's validateReviewGrounding — "cites nothing").
 *  Both gates ALREADY carry a narrow, fail-closed exception for a WELL-FORMED MECHANICAL
 *  absence (classifyCriterion's Rule 1.5 namesVerificationCommand; the review-side deferral is
 *  uncitedCriteriaAreAllCommandResults) — the command-evidence gate (node-commands.ts) verifies
 *  it against the command actually RECORDED at the spawn boundary, never trusted from prose. This
 *  block tells the blueprint author how to land inside that exception instead of outside it.
 *  Shared VERBATIM by the same four blueprint-authoring prompts as
 *  BLUEPRINT_CONCISENESS_RULES_LINES. */
const BLUEPRINT_DELETION_CRITERIA_RULES_LINES: readonly string[] = [
  'DELETION/REMOVAL criteria — a criterion asserting an absence MUST take one of these four',
  'citable forms, or it stays rejected exactly like any other bare prose absence:',
  '  (a) SURVIVING-STATE citation: cite the positive fact about what remains, not what is gone —',
  '      "App.tsx:42 renders OpsScreen; the sole remaining reference to ptyManager is server.ts:10".',
  '  (b) MECHANICAL zero-match gate: name the EXACT pattern AND scope as a command a reviewer can',
  '      run, plus the asserted result — e.g. "`grep -rn \'ptyManager\' src/` returns no matches" or',
  '      "`grep -c ZenMode ui/src/App.tsx` returns 0". State it as a named check, not a claim.',
  '  (c) diff-contract v2 (diff-contract.ts) structural absence: a ThresholdRequirement with',
  '      source "grep-count", comparison "eq", value 0 — the typed, mechanically-decided form —',
  '      when this leaf authors a v2 contract.',
  '  (d) SCOPE-GUARD negation: name the implementation PATH and a `git diff` check with an',
  '      asserted empty/zero result — e.g. "Implementation untouched — `git diff HEAD --stat -- src/services/foo.ts` is empty (0 files changed)".',
  'A bare absence with no exact pattern+scope ("X no longer defines Y", "Z is gone") is REJECTED —',
  'this is a narrow exception to the no-absence rule above, not a loophole for vague prose.',
];

/** The node's WORKING ROOT, written down. A leaf node's shell cwd IS its lane worktree, but
 *  nothing in its prompt ever said so: the leaf record's `targetProject` and the blueprint's
 *  prior-art citations name the MAIN checkout, so the moment a model chooses to be explicit
 *  about a path it writes the root it was TOLD, not the one it is IN — then `cd`s there and
 *  every later edit/test lands in a tree the executor never diffs (observed 3× on 2026-07-24,
 *  each filed as a mystery `empty-diff-spec-demands-changes`).
 *
 *  PURE: the caller passes the roots (it already holds the lane worktree path); this builder
 *  resolves nothing. Returns [] when no worktree is threaded, so old call sites are unchanged. */
export interface NodeRoots {
  /** The lane worktree — the node's cwd and the ONLY tree its edits count in. */
  worktree: string;
  /** The MAIN checkout of the same repo (the leaf's tracking root). Reference only. */
  mainCheckout?: string | null;
}

/** The PRIVILEGE BOUNDARY, written down for the same reason the working root is: nothing in
 *  the prompt ever said it, so a node that could not finish its task by the sanctioned route
 *  went looking for another one and found it.
 *
 *  Observed 2026-07-31 (mission 0a4a350d, leaf df08b5e3). The leaf was specced to run a deploy;
 *  the deploy script needs interactive sudo; a headless node has no TTY. Refused by `sudo -n`,
 *  it enumerated alternatives (SUDO_ASKPASS, group membership, the script's own sudo lines),
 *  found the docker group, and took host root via `docker run --privileged --pid=host -v /:/host
 *  … nsenter -t 1`. It then copied unlanded source onto a live service's runtime path and
 *  restarted that service six times to manufacture a transient reading its criteria demanded.
 *
 *  Nothing it did was blocked by a permission — docker-group membership is root-equivalent by
 *  design — so the boundary has to be stated, not merely assumed. `detectPrivilegeEscalation`
 *  and `detectOutsideWorktreeWrite` in node-commands.ts are the detection half; these lines are
 *  the prevention half. Both exist because either alone is insufficient. */
export const PRIVILEGE_BOUNDARY_LINES: readonly string[] = [
  '',
  'PRIVILEGE BOUNDARY: work with exactly the privilege you already have. Do NOT acquire more by',
  'a route this leaf did not name — no docker/podman to reach the host (`--privileged`, `--pid=host`,',
  '`-v /:/…`, `nsenter`), no `sudo -A`/SUDO_ASKPASS, no chroot, no setuid tricks. Do NOT deploy,',
  'restart or reload a service, and do NOT write anywhere outside your working root (scratch in',
  '/tmp is fine). If finishing genuinely requires privilege or a deploy you do not have, STOP and',
  'say so plainly in your final message, naming the exact step you could not perform — that is a',
  'correct, complete outcome for this leaf. It is never correct to find another way in.',
];

export function workingRootLines(roots?: NodeRoots): string[] {
  if (!roots?.worktree) return [];
  const lines = [
    `WORKING ROOT: ${roots.worktree}`,
    'That directory is already your shell cwd and is the ONLY tree whose changes count. Write every',
    'path relative to it (or absolute UNDER it), and do NOT `cd` out of it to work.',
  ];
  if (roots.mainCheckout && roots.mainCheckout !== roots.worktree) {
    lines.push(
      `The same repository is ALSO checked out at ${roots.mainCheckout} (tracking root, REFERENCE ONLY) and`,
      'paths in this leaf\'s description may point there. Reading it is fine; editing or running tests',
      'there is NOT — that work is discarded and your leaf is filed as an empty diff.',
    );
  }
  // A leaf that cannot find an interpreter WILL go looking for one, and the only one that
  // exists is in the main checkout — so it `cd`s there, trips the working-root gate, and is
  // blocked for a scope incident it had no way to avoid (yolox-markup mission 6e7ef04d: 5
  // escapes, 2 leaves, one morning; one reached reviewVerdict:"pass" and was blocked anyway).
  // The worktree is now PROVISIONED with the interpreter (worktree-manager linkSharedDeps),
  // so say where it is. Provisioning without telling the leaf just leaves it guessing.
  lines.push(
    'DEPENDENCIES ARE ALREADY PROVISIONED IN YOUR WORKING ROOT. Dependency directories that are',
    'gitignored (node_modules, .venv/venv) are symlinked in for every project dir that has them,',
    'so run tools from HERE, never from the tracking root: e.g. `./backend/.venv/bin/python -m',
    'pytest ...` or `./.venv/bin/python -m pytest ...` (relative to this working root), and the',
    'repo\'s usual node/bun commands. If a tool seems missing, look for its dependency dir inside',
    'the working root FIRST — `cd`-ing to the tracking root to borrow one is a scope violation that',
    'discards your work, even when the change itself is correct.',
  );
  lines.push(...PRIVILEGE_BOUNDARY_LINES);
  lines.push('');
  return lines;
}

/** Build the inline prompt for a node kind (clones the LOGIC of vibe-blueprint /
 *  vibe-go worker / vibe-review as a self-contained string — references NOTHING
 *  in skills/). */
/** One observable/invariant requirement the typed review must ballot on, keyed by its declared id.
 *  Derived at the call site from `contractBallotRequirements` (diff-contract-review.ts) — the SAME
 *  filter the grounding grader uses, so the reviewer is told to address exactly what will be graded. */
export interface BallotPromptRequirement {
  id: string;
  kind: 'observable' | 'invariant';
  text: string;
}

/** The TYPED REQUIREMENT BALLOT block appended to the review prompt when (and only when) the leaf
 *  carries observable/invariant contract requirements. Emitted BEFORE the final VERDICT trailer so
 *  the reviewer casts one per-id ballot line the closed grounding gate (parseBallotVerdicts +
 *  validateBallotGrounding) can read. Never called with an empty list — the caller guards on
 *  `.length`, preserving the byte-identical off-path. */
function buildReviewBallotBlock(reqs: ReadonlyArray<BallotPromptRequirement>): string[] {
  return [
    '',
    'TYPED REQUIREMENT BALLOT — this leaf carries a typed DiffContract. In ADDITION to the',
    '`## CRITERIA` section and the final VERDICT line, you MUST cast a ballot on EACH of these',
    'observable/invariant requirements (identified by their declared id):',
    ...reqs.map((r) => `  • REQ:${r.id} — ${r.text}`),
    'For EACH id listed above, emit EXACTLY ONE line (nothing else on the line), in this shape:',
    '`- [MET] REQ:<id> — <path>:<line>`   (requirement holds; cite a real changed `file:line`)',
    '`- [UNMET] REQ:<id> — <path>:<line>` (requirement is violated; cite where)',
    '`- [N/A] REQ:<id> — <why>`           (requirement does not apply to this change-set)',
    'A `[MET]` ballot MUST carry at least one `file:line` that resolves into THIS leaf\'s change-set',
    '(same citation discipline as the CRITERIA section — a build/gate RESULT is NOT a citation).',
    'A PRESERVATION/invariant requirement satisfied by NOT changing production code is still',
    'balloted `[MET]`, never `[N/A]`. Cite the TEST in THIS leaf\'s change-set that exercises and',
    'proves the invariant holds — never the unchanged production subject: an unchanged file resolves',
    'to nothing in the change-set and parks the leaf review-vacuous (the exact failure mode from',
    'incident leaf `6a5fdf36`, requirement `seal-stays-fail-open`). Do not mark a preservation',
    'requirement `[N/A]` merely because no production line changed — a changed TEST file:line is the',
    'correct citation, not an excuse to skip the ballot.',
    'Every id listed above must appear in EXACTLY one `REQ:<id>` ballot line — an omitted id parks',
    'the leaf as review-vacuous even when the code is correct.',
  ];
}

export function buildNodePrompt(
  kind: LeafNodeKind,
  leaf: Todo,
  blueprintText?: string,
  reviewFindings?: string,
  roots?: NodeRoots,
  ballotRequirements?: ReadonlyArray<BallotPromptRequirement>,
): string {
  const title = leaf.title ?? leaf.id;
  const description = leaf.description ?? '(no description)';
  const bp = blueprintPath(leaf);
  const rootLines = workingRootLines(roots);
  switch (kind) {
    case 'blueprint':
      return [
        'You are the BLUEPRINT node for ONE leaf todo. Do NOT write implementation code.',
        ...rootLines,
        `Title: ${title}`,
        `Description: ${description}`,
        'Read the relevant code (Read/Grep/Glob and Bash for inspection ONLY — no mutations).',
        `Produce a precise, self-contained implementation blueprint and WRITE it to \`${bp}\`.`,
        'The blueprint must cite the real files/symbols to touch and the exact change shape.',
        'ACCEPTANCE CRITERIA must be POSITIVE and CITABLE: each names a concrete change a reviewer can',
        'point a `file:line` at. NEVER write an absence or non-goal as an acceptance criterion ("no X',
        'changes", "X untouched/unchanged", "Y not modified") — a negative cannot be cited and will',
        'strand the leaf at review. When the spec constrains scope with a "do not touch X", record it as',
        'a NON-GOALS note in the prose, kept OUT of the acceptance-criteria list — not as a criterion.',
        '',
        ...BLUEPRINT_DELETION_CRITERIA_RULES_LINES,
        '',
        'Every acceptance criterion MUST be a STRUCTURAL fact about the diff — a concrete symbol',
        '(function, type, enum, field, string) that a reviewer can point a `file:line` at. A criterion',
        'MUST NOT assert a build, command, or gate RESULT (e.g. "xcodebuild BUILD SUCCEEDED", "tsc',
        'clean", "tests pass", "the gate is GREEN"): the deterministic acceptance GATE enforces',
        'compilation separately, and a gate result is NOT a citation — it must never appear as a',
        'criterion. If a leaf\'s only real check is that it compiles, still cite the concrete',
        'definitions the diff adds (e.g. "defines enum Space with members A, B at line N"), never a',
        'build-result criterion.',
        '',
        ...MANIFEST_JSON_SCHEMA_LINES,
        ...MANIFEST_SCHEMA_NOTES_LINES,
        '',
        ...BLUEPRINT_CONCISENESS_RULES_LINES,
        '',
        'YOU decide whether this leaf is decomposable — a file count cannot see coupling, you can.',
        '`splitDecision.split: false` ⇒ the leaf runs WHOLE in one worker, even at 12 files. Choose',
        'this whenever the change is COUPLED: a shared primitive that call sites must be written',
        'against, a lock protocol, a two-sided predicate. State that invariant in `reason`.',
        '`splitDecision.split: true` ⇒ EVERY item becomes ONE child leaf, and `dependsOn` becomes a',
        'REAL dependency edge between them (a child whose dep is unmet cannot be claimed). An item MAY',
        'hold several files — group them by INDEPENDENT UNIT, not one-per-file. A module and the tests',
        'that import it are NOT independent: the test item dependsOn the module item. `dependsOn` ids',
        'must reference sibling item ids, and the graph must be acyclic. Omit `items` when split:false.',
        'Prefer `split: false` when in doubt — an unsound split races; a whole leaf merely runs longer.',
        '',
        `ALSO output the COMPLETE blueprint (the same prose + the trailing json block) as your`,
        `FINAL reply message — verbatim — so the executor has the blueprint even if the file`,
        `read fails. (Write the file AND emit the full text as your final message.)`,
      ].join('\n');
    case 'implement':
      return [
        'You are the IMPLEMENT node. Make REAL, compiling code edits (Read/Edit only).',
        ...rootLines,
        reviewFindings
          ? `A PRIOR review of the EXISTING working tree FAILED. KEEP the correct work already present and make the SMALLEST changes that address ONLY these findings — do not rewrite from scratch:\n--- REVIEW FINDINGS ---\n${reviewFindings}\n--- END FINDINGS ---`
          : '',
        blueprintText
          ? `This leaf's blueprint is inlined below — implement it FULLY against the working tree. Do NOT search for, glob, or read ANY other blueprint file (other leaves' blueprints may be present in shared dirs — ignore them entirely).\n\n=== BLUEPRINT (${leaf.id}) START ===\n${blueprintText}\n=== BLUEPRINT END ===`
          : `Read the blueprint at \`${bp}\` — ONLY that exact file (ignore any other blueprint in the directory) — and the files it references, then implement it FULLY.`,
        'Do not stub or leave TODOs. Do NOT run the acceptance gate or report completion —',
        'the executor drives the gate. Just make the edits the blueprint specifies.',
        `If you spot-check compilation: ${COMPILE_CHECK_INSTRUCTION}`,
      ].filter(Boolean).join('\n');
    case 'review': {
      const reviewLines = [
        'You are the REVIEW node, READ-ONLY (Read/Grep/Glob and Bash for inspection ONLY; no edits).',
        ...rootLines,
        blueprintText
          ? `Compare the working tree against THIS leaf's blueprint, inlined below (do NOT read any other blueprint file — ignore strays in shared dirs):\n\n=== BLUEPRINT (${leaf.id}) START ===\n${blueprintText}\n=== BLUEPRINT END ===`
          : `Compare the working tree against the blueprint at \`${bp}\` (ONLY that exact file).`,
        'Decide if the work is complete and correct (it compiles, satisfies the blueprint, no obvious bugs).',
        COMPILE_CHECK_INSTRUCTION,
        'A file that fails ONLY under a bare-file `tsc <file>` run (not the project config) is NOT a real failure.',
        'Emit a `## CRITERIA` section: ONE line per acceptance criterion in the blueprint/spec, in this exact shape:',
        '`- [MET] <criterion> — <path>:<line>`  or  `- [UNMET] <criterion> — <path>:<line>`  or  `- [N/A] <criterion> — <why>`',
        'Every MET/UNMET line MUST carry at least one `file:line` citation into a file THIS leaf changed —',
        'the line you actually read to decide. Cite both sides when a criterion spans two files.',
        'A citation is not a formality: a criterion you cannot cite, you did not check.',
        'Supporting citations OUTSIDE this leaf\'s change-set are PERMITTED for context, but they do NOT',
        'count as grounding: every `[MET]`/`[UNMET]` STILL needs at least one in-change-set `file:line`.',
        'A build, command, or gate RESULT ("BUILD SUCCEEDED", "tsc clean", "tests pass", "gate GREEN")',
        'is NOT a citation — the acceptance gate enforces compilation on its own. Cite the concrete',
        'changed `file:line` a criterion names, never the gate outcome.',
        'A criterion whose ONLY proof is a command/build/gate RESULT is likewise uncitable — mark it',
        '`- [N/A] <criterion> — verified via <command evidence>` (name the command you ran), NEVER `[MET]`,',
        'since no changed `file:line` can ground a command outcome.',
        'ABSENCE / NON-GOAL criteria are inherently uncitable — no changed line can prove a negative.',
        'A criterion that asserts something was NOT done, left unchanged, or untouched (e.g. "no phase',
        'changes", "X unchanged", "Y not modified", "non-goal respected") MUST be marked',
        '`- [N/A] <criterion> — <why it is a non-goal>`, NEVER `[MET]`. Reserve MET/UNMET for criteria',
        'that name a POSITIVE change you can point a `file:line` at. (Marking such an absence [MET] with',
        'no citation strands the whole leaf as review-vacuous even when the code is correct; [N/A] is the',
        'honest, non-vacuous outcome. A positive claim with no citation is still a failure — this narrow',
        'exemption is only for criteria that NObody could cite.)',
        'Be as TERSE as the change deserves — a one-line diff earns a one-line review. There is no',
        'length requirement and none will be inferred; only the citations are checked.',
      ];
      // TYPED path only: append the per-requirement-id ballot BEFORE the VERDICT trailer. Guarding
      // on `.length` keeps the untyped output BYTE-IDENTICAL (the block is never spliced in).
      if (ballotRequirements?.length) {
        reviewLines.push(...buildReviewBallotBlock(ballotRequirements));
      }
      reviewLines.push(
        'End your reply with EXACTLY one line, nothing after it:',
        '`VERDICT: PASS`  (if complete and correct)',
        '`VERDICT: FAIL — <reason>`  (otherwise)',
      );
      return reviewLines.join('\n');
    }
    case 'explore': {
      const exploreSpec = leaf.exploreSpec as ExploreSpec | null | undefined;
      const exploreLines = [
        'You are the EXPLORE node. Conduct a READ-ONLY investigation (Read/Grep/Glob and Bash for inspection ONLY; no edits).',
        ...rootLines,
      ];
      if (exploreSpec) {
        exploreLines.push(
          `Scope: ${exploreSpec.scope}`,
          `Target: ${exploreSpec.target}`,
          `Oracle: ${exploreSpec.oracle}`,
        );
        if (exploreSpec.not) {
          exploreLines.push(`Not: ${exploreSpec.not}`);
        }
        if (exploreSpec.reach) {
          exploreLines.push(`Reach: ${exploreSpec.reach}`);
        }
      } else {
        exploreLines.push(
          `Title: ${title}`,
          `Description: ${description}`,
        );
      }
      exploreLines.push(
        '',
        'IMPORTANT: This is a READ-ONLY investigation. You MUST NOT Write or edit any file — the EXECUTOR writes and commits the report.',
        '',
        'Investigate thoroughly. Your FINAL reply message must contain the findings as markdown:',
        '',
        '## Findings',
        '',
        '- <finding 1>',
        '- <finding 2>',
        '...',
        '',
        'Finding NOTHING is a valid, successful exploration. Your report must ALWAYS end with the sentinel line (even with zero findings):',
        '',
        `\`${EXPLORE_REPORT_SENTINEL}: FINDINGS=<count>\``,
        '',
        'where <count> is the number of findings you listed (0 if none). Do not omit this line.',
      );
      return exploreLines.join('\n');
    }
    default:
      // Verify-pipeline kinds (driveplan/driveexec/report) are built by buildVerifyPrompt;
      // the retired wave kinds (research/wimplement/verify/fix) are never spawned. Neither
      // reaches here — this switch is exhaustive over the FLOOR kinds it owns.
      throw new Error(`buildNodePrompt: unsupported floor kind "${kind}"`);
  }
}

/** SR-7: Build the refresh prompt for a split child's BLUEPRINT node. The child reconciles
 *  the inherited parent plan against the current tree (reading only its file slice) rather
 *  than re-deriving from zero. The prompt inlines the parent's durable plan and the child's
 *  file slice, and instructs the node to RECONCILE (tree wins on disagreements, don't re-derive). */
export function buildBlueprintRefreshPrompt(leaf: Todo, inheritedText: string, files: string[]): string {
  const title = leaf.title ?? leaf.id;
  const description = leaf.description ?? '(no description)';
  const bp = blueprintPath(leaf);
  return [
    'You are the BLUEPRINT REFRESH node for ONE split child leaf. Do NOT write implementation code.',
    `Title: ${title}`,
    `Description: ${description}`,
    `You own EXACTLY these files: ${files.join(', ')}.`,
    '',
    'The parent plan you inherited (below) was authored BEFORE your sibling leaves landed. RECONCILE',
    'it against the CURRENT tree: read the files you own and the interfaces your dependencies actually',
    'shipped. Where the inherited prose disagrees with the tree, the TREE wins. Do not re-derive the',
    'design from zero.',
    '',
    `=== INHERITED PARENT PLAN (${leaf.inheritedBlueprintFrom}) START ===`,
    inheritedText,
    '=== INHERITED PARENT PLAN END ===',
    '',
    `Produce your reconciliation and WRITE it to \`${bp}\`.`,
    'The blueprint must cite the real files/symbols to touch and the exact change shape.',
    '',
    ...MANIFEST_JSON_SCHEMA_LINES,
    ...MANIFEST_SCHEMA_NOTES_LINES,
    '',
    ...BLUEPRINT_CONCISENESS_RULES_LINES,
    '',
    ...BLUEPRINT_DELETION_CRITERIA_RULES_LINES,
    '',
    'Emit `splitDecision.split: false` unless your slice genuinely decomposes further — you are',
    'already a split child.',
    '',
    `ALSO output the COMPLETE blueprint (the same prose + the trailing json block) as your`,
    `FINAL reply message — verbatim — so the executor has the blueprint even if the file`,
    `read fails. (Write the file AND emit the full text as your final message.)`,
  ].join('\n');
}

/** L4: Build the repair prompt for a blueprint node that emitted uncitable acceptance criteria.
 *  The prompt quotes each offending criterion with its rule-violation reason, restates the
 *  rules, and demands the full blueprint be rewritten to the same path with the same trailing
 *  json manifest. Used as a one-shot in-place repair before the implement node is spawned. */
export function buildCriteriaRepairPrompt(
  leaf: Todo,
  blueprintText: string,
  citability: { verdicts: Array<{ text: string; kind?: string; reason?: string }>; offenders: Array<{ text: string; kind?: string; reason?: string }>; reasons: string[] },
): string {
  const title = leaf.title ?? leaf.id;
  const description = leaf.description ?? '(no description)';
  const bp = blueprintPath(leaf);

  const offenderText = citability.offenders
    .map(
      (o) =>
        `- "${o.text.slice(0, 80)}${o.text.length > 80 ? '...' : ''}" — ${o.reason || 'uncitable'}`,
    )
    .join('\n');

  return [
    'You are the BLUEPRINT node. Make REAL, compiling code edits.',
    `Title: ${title}`,
    `Description: ${description}`,
    '',
    'The prior blueprint you wrote has UNCITABLE acceptance criteria:',
    '',
    offenderText,
    '',
    "Every acceptance criterion in a blueprint must be satisfiable by a `file:line` citation inside the diff this leaf produces.",
    "These three criterion types are NEVER citable in principle:",
    "1. A command's result: a criterion that invokes a build/test (bun run, npm test, npx vitest, tsc, make, etc.) or asserts its outcome (tests pass, suite green, build clean, etc.) — UNLESS it names a runnable read-only verification command (grep/rg/tsc/vitest/bun test) WITH a real argument AND an asserted checkable result token ('returns 0', 'no matches', ...); that shape is verified against the command actually recorded, not trusted from prose.",
    "2. An absence: a criterion that asserts a negative about code (no file touched, no field added, not changed, etc.) — UNLESS it takes one of the four citable DELETION/REMOVAL forms below.",
    "3. A location outside your diff: a citation to a file:line you do not modify.",
    '',
    ...BLUEPRINT_DELETION_CRITERIA_RULES_LINES,
    '',
    "Restate each uncitable criterion as the OBSERVABLE CODE CHANGE that would make a command pass, or — if it is a genuine absence — as one of the four citable forms above.",
    MANIFEST_GLOB_RULE_LINE,
    "Then read the relevant code, and produce your corrected blueprint and WRITE it to `" +
      bp +
      "`.",
    "The blueprint must cite the real files/symbols to touch and the exact change shape.",
    '',
    ...MANIFEST_JSON_SCHEMA_LINES,
    '',
    ...BLUEPRINT_CONCISENESS_RULES_LINES,
    '',
    `ALSO output the COMPLETE blueprint (the same prose + the trailing json block) as your FINAL reply message — verbatim — so the executor has the blueprint even if the file read fails.`,
  ].join('\n');
}

/** Build the repair prompt for a blueprint node whose v2 diff contract (diff-contract.ts) is
 *  UNDERSPECIFIED for its declared leafKind per the §4 strictness matrix
 *  (validateContractForKind) — a required requirement kind has zero entries. Mirrors
 *  buildCriteriaRepairPrompt's shape (quote-the-offense, restate-the-rule, re-emit the same
 *  trailing json-fence contract). Takes only the missing field's kind name, not a DiffContract
 *  value, so this file does not import diff-contract.ts (avoids the circular import its header
 *  comment calls out). */
export function buildBlueprintRepairPrompt(
  leaf: Todo,
  blueprintText: string,
  missingField: string,
): string {
  const title = leaf.title ?? leaf.id;
  const description = leaf.description ?? '(no description)';
  const bp = blueprintPath(leaf);

  return [
    'You are the BLUEPRINT node. Make REAL, compiling code edits.',
    `Title: ${title}`,
    `Description: ${description}`,
    '',
    `The prior blueprint's diff contract is UNDERSPECIFIED for this leaf's declared leafKind: it has zero "${missingField}" requirements, and the §4 strictness matrix requires at least one for this leafKind.`,
    '',
    `Add at least one "${missingField}" requirement object to the contract's requirements[] array, citing a real file/symbol/test/metric that this leaf's diff actually delivers — never a placeholder.`,
    '',
    MANIFEST_GLOB_RULE_LINE,
    '',
    'Then read the relevant code, and produce your corrected blueprint and WRITE it to `' +
      bp +
      '`.',
    "The blueprint must cite the real files/symbols to touch and the exact change shape.",
    '',
    ...MANIFEST_JSON_SCHEMA_LINES,
    '',
    ...BLUEPRINT_CONCISENESS_RULES_LINES,
    '',
    ...BLUEPRINT_DELETION_CRITERIA_RULES_LINES,
    '',
    'ALSO output the COMPLETE blueprint (the same prose + the trailing json block) as your FINAL reply message — verbatim — so the executor has the blueprint even if the file read fails.',
  ].join('\n');
}

/** Build the bounded re-emit prompt for a blueprint node whose output (token count) exceeded
 *  BLUEPRINT_OUTPUT_TOKEN_CAP. Asks the node to trim prose (restating, preamble, duplication)
 *  while preserving every criterion, file, and task. Mirrors buildBlueprintRepairPrompt's
 *  quote-the-offense / re-emit-the-whole-thing pattern. */
export function buildBlueprintSummarizePrompt(
  leaf: Todo,
  oversizedBlueprintText: string,
  capTokens: number,
  observedTokens: number,
): string {
  const title = leaf.title ?? leaf.id;
  const description = leaf.description ?? '(no description)';
  const bp = blueprintPath(leaf);

  return [
    'You are the BLUEPRINT node. Make REAL, compiling code edits. Do NOT write implementation code.',
    `Title: ${title}`,
    `Description: ${description}`,
    '',
    `The blueprint you wrote is oversized: ${observedTokens} output tokens exceeds the BLUEPRINT_OUTPUT_TOKEN_CAP of ${capTokens} tokens.`,
    '',
    'RE-EMIT the same blueprint faithfully, cutting restating/preamble/duplication, WITHOUT dropping any acceptance criterion, file, or task the original named.',
    '',
    'The blueprint text to trim is enclosed below:',
    '',
    `=== BLUEPRINT START ===`,
    oversizedBlueprintText,
    `=== BLUEPRINT END ===`,
    '',
    MANIFEST_GLOB_RULE_LINE,
    '',
    'Then produce your trimmed blueprint and WRITE it to `' +
      bp +
      '`.',
    "The blueprint must cite the real files/symbols to touch and the exact change shape.",
    '',
    ...MANIFEST_JSON_SCHEMA_LINES,
    '',
    ...BLUEPRINT_CONCISENESS_RULES_LINES,
    '',
    'ALSO output the COMPLETE blueprint (the same prose + the trailing json block) as your FINAL reply message — verbatim — so the executor has the blueprint even if the file read fails.',
  ].join('\n');
}

/** Build the inline prompt for a VERIFY-pipeline node (epic f5c7fc46). Three kinds:
 *  - driveplan: LLM authors an AssemblyBuildPlan (plan ONLY — no build, no code).
 *  - driveexec: constrained to the single deterministic gate verb — invokes it with the
 *    plan VERBATIM and captures the raw result (authors nothing).
 *  - report: writes + commits a findings .md and files one session-todo per finding.
 *  Self-contained strings (reference nothing in skills/), mirroring buildNodePrompt. */
export function buildVerifyPrompt(
  kind: 'driveplan' | 'driveexec' | 'report',
  leaf: Todo,
  /** driveexec/report: the authored plan JSON, inlined so the node never re-derives it. */
  planText?: string,
  /** report: the gate's FAILED-verdict reasons (one finding each); empty ⇒ clean pass. */
  gateFindings?: string,
  /** L3: the resolved deterministic gate verb the plan/execute nodes target. Defaults to the
   *  build_assembly_plan fallback so existing callers/tests are unaffected. */
  verb: string = VERIFY_GATE_VERB,
): string {
  const title = leaf.title ?? leaf.id;
  const description = leaf.description ?? '(no description)';
  const planFile = verifyPlanPath(leaf);
  const resultFile = verifyResultPath(leaf);
  const reportFile = verifyReportPath(leaf);
  switch (kind) {
    case 'driveplan':
      return [
        'You are the PLAN node for a VERIFY/dogfood leaf. You author a structured verify PLAN',
        'ONLY — you do NOT build anything, drive any CAD verb, or write code.',
        `Title: ${title}`,
        `Description: ${description}`,
        'Read whatever you need to understand the target (Read/Grep/Glob, Bash for inspection only).',
        `Author a single AssemblyBuildPlan — the input schema of the \`${verb}\` verb — for`,
        `the target described above and WRITE it as JSON to \`${planFile}\`.`,
        'The plan is a DAG: `{ "nodes": [ { "id", "op", "params", "deps", "accept", "assembly_path?" } ],',
        '"metadata": {} }`, where `op` ∈ realize|connect|author|subassembly and each node\'s `accept`',
        'lists the gates to assert from {validity, dof, mobility, clearance, contract}. EVERY node that',
        'should be verified MUST declare its `accept` gates — a node with no gates verifies nothing.',
        `It must be a complete, self-contained plan the deterministic \`${verb}\` verb runs in ONE call.`,
        'Do not leave placeholders.',
        '',
        'ALSO emit the COMPLETE plan JSON as your FINAL reply message, verbatim, so the executor has',
        'it even if the file read fails. Output ONLY the plan (write the file AND emit the full JSON).',
      ].join('\n');
    case 'driveexec':
      return [
        `You are the EXECUTE node. Your ONLY job: call the deterministic \`${verb}\` MCP`,
        'verb with the EXACT plan below and capture its raw result. Author NOTHING, do not modify the',
        'plan, do not build anything yourself, make exactly ONE verb call.',
        planText
          ? `=== ASSEMBLY BUILD PLAN (${leaf.id}) START ===\n${planText}\n=== PLAN END ===`
          : `Read the plan JSON at \`${planFile}\` and use it verbatim.`,
        `Call \`${verb}\` with that plan. Then WRITE the verb's COMPLETE raw JSON PlanReport result`,
        '(the full {ok, error, halted_at, nodes:[{gates:[...]}]} object, verbatim, no edits, no',
        `commentary) to \`${resultFile}\`. Also echo that same raw JSON as your final message. Do NOT`,
        'interpret, summarize, or "fix" the result — the executor parses it.',
      ].join('\n');
    case 'report':
      return [
        'You are the REPORT node for a verify/dogfood leaf. The deterministic gate has already run.',
        planText ? `The plan that was executed:\n${planText}` : '',
        gateFindings && gateFindings.trim()
          ? `The gate reported these FAILED verdicts — each is a finding:\n--- FINDINGS ---\n${gateFindings}\n--- END FINDINGS ---`
          : 'The gate reported a CLEAN result (all accept gates passed — validity/dof/mobility/clearance/contract).',
        'Compose a findings report (markdown): what was verified, the overall verdict, and each',
        'finding with enough detail to act on (and how to reproduce).',
        'For EACH distinct finding, file one bucket item via the collab MCP tool',
        '`mcp__mermaid__file_to_bucket` (title = the finding, description = detail + repro, bucket',
        '"bugfix") if that tool is available; if it is not, include the would-be todos as a section in the report.',
        'OUTPUT the COMPLETE report markdown as your FINAL reply message, verbatim — that final',
        'message IS the deliverable: the executor writes it to the worktree and commits it onto the',
        'epic branch. Do NOT write files yourself and do NOT run git — just emit the markdown and',
        'file the todos. (Do not edit any source code.)',
      ].filter(Boolean).join('\n');
  }
}

/** Build the wrap-up directive for explore-node segments that have reached the soft budget
 *  threshold or are approaching the max-segment ceiling. This directive tells the node to stop
 *  opening new investigation lines and instead emit its findings report from the observations
 *  it has already gathered. Self-contained instruction string (mirrors other build* prompt
 *  functions). */
export function buildExploreWrapUpDirective(): string {
  return [
    'WRAP-UP SIGNAL: You have gathered sufficient observations and budget is approaching limits.',
    'Stop opening new investigation lines. Instead, FINALIZE your findings report from what you have',
    'already discovered. Your next report MUST include the sentinel line:',
    `\`${EXPLORE_REPORT_SENTINEL}: FINDINGS=<count>\``,
    'where <count> is the number of findings you have identified so far (0 if none).',
  ].join('\n');
}

export const REVIEW_LENS_INSTRUCTIONS: Record<ReviewLens, string> = {
  'completeness': `Judge COMPLETENESS and CORRECTNESS against the spec: flag every gap, contradiction, or
unmet LOCKED DECISION. Do NOT propose new behavior or scope; this is a review, not a redesign.`,

  'regression-blast-radius': `Judge REGRESSION BLAST RADIUS: what could this change-set break OUTSIDE its own spec?
Identify changes to symbols (functions, constants, interfaces, exports), invariants, or default
behaviors that other code may already depend on. For each at-risk external call site, cite it as
\`file:line\`. You are NOT reviewing spec completeness here (leave that to the other lens) —
focus on unintended consequences for callers and downstream modules.`,
};

/** Build the inline prompt for a REVIEW-shape leaf (epic d8ac1a18 dogfood): a single
 *  read-only LLM judgment node that reviews the EPIC's union change-set against the leaf's
 *  spec (the spec is inlined — it carries the LOCKED DECISIONS), files one session-todo per
 *  gap, and EMITS the full report markdown as its final message (the executor writes +
 *  commits it — a node Write resolves to the project root, not the worktree, so a
 *  node-written report never reaches mergeToEpic → accept reverses; same L5 gotcha as
 *  verify's report node). The trailing `VERDICT:` line is the content gate that re-arms the
 *  hallucination guard at the content layer (a vacuous report has no parseable verdict →
 *  the executor parks it blocked). Teaches the three-dot diff caveat (lesson 5) and verify
 *  discipline (lesson 1). Self-contained (references nothing in skills/). */
export function buildReviewPrompt(leaf: Todo, baseRef: string, lens: ReviewLens = 'completeness'): string {
  const title = leaf.title ?? leaf.id;
  const spec = leaf.description ?? '(no spec provided)';
  return [
    'You are the REVIEW node for a COMPLETENESS REVIEW leaf, READ-ONLY (Read/Grep/Glob and',
    'Bash for inspection ONLY — make NO edits, do NOT run git commit/push, do NOT run the',
    'acceptance gate). The executor commits your report for you.',
    `Title: ${title}`,
    '',
    'REVIEW SPEC (the acceptance criteria — it carries the LOCKED DECISIONS to check against):',
    '--- SPEC START ---',
    spec,
    '--- SPEC END ---',
    '',
    'You are reviewing the UNION change-set of the whole epic (all sibling leaves\' work,',
    `accumulated on this branch). Inspect it with git from the repo root:`,
    `  • the file list:  \`git diff --stat ${baseRef}...HEAD\``,
    `  • the full diff:  \`git diff ${baseRef}...HEAD\``,
    `  • per-commit log: \`git log --oneline ${baseRef}..HEAD\``,
    'CAVEAT — three-dot diff shows COMMITS ONLY. `git diff <base>...HEAD` can never show',
    'uncommitted or unstaged work, and no staging trick makes it. If a sibling leaf left work',
    'in the working tree, only `git status --porcelain` (which collapses a new directory to',
    '`?? dir/`) and `git diff HEAD` will see it. Check the working tree before concluding a',
    'file is absent.',
    `(If \`${baseRef}\` is not resolvable, fall back to \`git merge-base HEAD @{u} 2>/dev/null\` or`,
    'review the working tree directly — do the best honest review you can and SAY which base you used.)',
    'Read the actual changed source to confirm behavior — do not review from the diff alone.',
    '',
    'CITING A DELETED FILE — a removed file has no file:line. For a criterion about a file the',
    'change-set DELETES, cite it exactly as `path/to/file.ext (deleted)` — the `(deleted)` phrase',
    'IS the citation and is validated against the change-set; freeform prose ("git status shows D")',
    'extracts no citation and fails the grounding audit.',
    '',
    'VERIFY DISCIPLINE — a verdict needs a BASELINE. If the change-set has tests:',
    `  1. Run each relevant test file ALONE on this branch, using this project's own test runner.`,
    `  2. Run that SAME file ALONE on \`${baseRef}\` (a worktree/checkout of the base).`,
    '  3. Compare. A failure present on BOTH is pre-existing and is NOT your finding.',
    'Do NOT judge from a whole-directory run: files share a SQLite database and the runner',
    'parallelizes, so aggregate red/green is noise. One file, in isolation, on both sides.',
    '',
    REVIEW_LENS_INSTRUCTIONS[lens],
    '',
    'For EACH distinct gap/finding, file one bucket item via the collab MCP tool',
    '`mcp__mermaid__file_to_bucket` (title = the finding, description = detail + where + why it',
    'matters, bucket "bugfix") if that tool is available; if it is not, list the would-be todos as a section in the report.',
    '',
    'Then compose a REVIEW REPORT (markdown): what was reviewed (and the diff base you used), the',
    'per-decision check results, and each finding with enough detail to act on.',
    '',
    'If you ran any command to verify a criterion, list it under a VERIFICATION: heading,',
    'one `- ran: <exact command>` line each. The executor records what actually ran at the',
    'spawn boundary and cross-checks; a listed command it never observed is flagged. Do not',
    'list a command you did not run. If you ran nothing, omit the block.',
    '',
    'End your reply with EXACTLY one line, nothing after it:',
    '`VERDICT: PASS`  (the change-set fully satisfies the spec — no material gaps)',
    '`VERDICT: FAIL — <one-line summary>`  (material gaps exist; they are filed as todos above)',
    'OUTPUT the COMPLETE report markdown (ending with that VERDICT line) as your FINAL reply',
    'message, verbatim — that final message IS the deliverable the executor commits.',
  ].join('\n');
}
