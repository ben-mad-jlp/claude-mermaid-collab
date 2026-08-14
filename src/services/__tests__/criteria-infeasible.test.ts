/**
 * @nested-test-runner: inert - fixture STRINGS name test runners ("bun test", "cargo test",
 *   "pytest") because that is what namesDaemonProvableProof recognises; nothing is executed.
 * @serial-test-lane: inert - fixture strings name git commands for the git-fact proof method;
 *   no git process is ever spawned. Every test here is a pure function call.
 */
import { test, expect } from 'bun:test';
import {
  classifyCriterion,
  compliantShapeFor,
  namesDaemonProvableProof,
  type UncitableKind,
} from '../criteria-citability';
// Read-only import: pins the COMPOSITION with the disposition router (fix 1). We never call
// anything that mutates a blueprint here — actionForKind is a pure classifier.
import { actionForKind } from '../blueprint-criteria-splice';

const FILES = ['src/services/foo.ts', 'src/services/__tests__/foo.test.ts', 'ui/src/Panel.tsx'];

// ─────────────────────────────────────────────────────────────────────────────
// CONVICTIONS — proof the daemon cannot run inside its own worktree.
// ─────────────────────────────────────────────────────────────────────────────

const INFEASIBLE_CRITERIA: ReadonlyArray<[label: string, text: string]> = [
  ['rendered UI', 'the settings panel is opened in a browser and the rendered page shows the new tab'],
  ['browser devtools', 'the Chrome devtools console reports the new event on every click'],
  ['screenshot', 'a screenshot of the dashboard matches the approved design'],
  ['live port', 'the sidecar is reachable on port 9002 and answers the health probe'],
  ['starts a service', 'start the dev server and confirm the new route resolves'],
  ['network egress', 'the importer succeeds against the production API'],
  ['curl over http', 'curl http://localhost:3000/api/status returns the new field'],
  ['external hardware', 'the driver is exercised on a physical device and the motor moves'],
  ['usb hardware', 'the USB probe enumerates the attached sensor'],
  ['human eyes', 'a human reviewer confirms the wording reads naturally'],
  ['visual inspection', 'visual inspection confirms the spacing is even across breakpoints'],
  ['manual QA', 'manual QA verifies the upgrade path end to end'],
  ['outside test system', 'the external test harness reports the new scenario as covered'],
];

for (const [label, text] of INFEASIBLE_CRITERIA) {
  test(`classifyCriterion: INFEASIBLE — ${label}`, () => {
    const v = classifyCriterion(text, FILES);
    expect(v.citable).toBe(false);
    expect(v.kind).toBe('infeasible');
    expect(v.reason ?? '').toContain('infeasible');
  });
}

test('an infeasible criterion is convicted with or without a manifest', () => {
  const text = 'a human reviewer confirms the wording reads naturally';
  expect(classifyCriterion(text, []).kind).toBe('infeasible');
  expect(classifyCriterion(text, FILES).kind).toBe('infeasible');
});

// ─────────────────────────────────────────────────────────────────────────────
// PRECISION GUARDS — the five daemon-provable proof methods must NEVER be
// convicted as infeasible. A false positive here refuses legitimate work.
// ─────────────────────────────────────────────────────────────────────────────

const PROVABLE_CRITERIA: ReadonlyArray<[label: string, text: string, files: readonly string[]]> = [
  // 1. test-file invocation (drawn from the existing corpus / friction d08de44a)
  [
    'test invocation, three-part shape',
    "`npx vitest run src/lib/__tests__/ros-store.test.ts` passes, asserting `it('routes SSE device payloads into the store')`",
    ['src/lib/__tests__/ros-store.test.ts'],
  ],
  [
    'bun test invocation',
    "`bun test src/services/__tests__/dist-parity.test.ts` passes, asserting `it('dist matches a fresh build')`",
    ['src/services/__tests__/dist-parity.test.ts'],
  ],
  // 2. typecheck
  ['typecheck', '`npx tsc --noEmit -p tsconfig.json` compiles clean', FILES],
  // 3. file:line / path citation
  ['file:line citation', 'landedDiffPaths returns the merge diff — src/agent/worktree-manager.ts:625', ['src/agent/worktree-manager.ts']],
  ['path citation', 'src/services/foo.ts exports a `resolvePort` helper', FILES],
  // 4. scoped grep
  ['scoped grep', "`grep -rn 'legacyPort' src/` returns no matches", FILES],
  // 5. git fact
  ['git fact', '`git diff HEAD --stat -- src/services/` shows 0 files changed', FILES],
  // Ordinary UI/service/device WORK stated with an in-process proof — the exact shapes the rule
  // must not creep onto.
  [
    'React component test (mentions render)',
    "`bun test ui/src/__tests__/Panel.test.tsx` passes, asserting `it('renders the new tab label')`",
    ['ui/src/__tests__/Panel.test.tsx'],
  ],
  [
    'device payload routing (mentions device)',
    'the store routes SSE device payloads into `deviceSlice` — src/lib/ros-store.ts:88',
    ['src/lib/ros-store.ts'],
  ],
  [
    'server config value (mentions port and localhost)',
    'src/mcp/server.ts defaults the bridge to localhost:9002',
    ['src/mcp/server.ts'],
  ],
  [
    'screenshot-adjacent but file-proved',
    'the screenshot writer path is configurable — src/services/capture.ts:41',
    ['src/services/capture.ts'],
  ],
  [
    'external API client, unit tested',
    "the external API client retries twice on 429, asserted by `it('retries twice on 429')` in src/services/__tests__/client.test.ts",
    ['src/services/__tests__/client.test.ts'],
  ],
];

for (const [label, text, files] of PROVABLE_CRITERIA) {
  test(`PRECISION: not infeasible — ${label}`, () => {
    expect(classifyCriterion(text, files).kind).not.toBe('infeasible');
  });
}

// The guards above are mostly protected by ORDERING (earlier acquittals). These ones reach Rule 4
// with an out-of-reach signal present, so they exercise the SAFETY VALVE itself: a criterion that
// mentions a browser / port / device / QA but names a daemon-provable proof is NOT infeasible.
const VALVE_CRITERIA: ReadonlyArray<[label: string, text: string]> = [
  ['browser word + file:line citation', 'the browser entry point is wired to the new store — src/main.tsx:12'],
  ['manual QA word + path citation', 'the manual QA checklist it replaces is listed in docs/qa-checklist.txt'],
  ['port word + typecheck', 'the "listening on 9002" banner type-checks under the new PortConfig union'],
  ['physical device word + scoped grep', "no caller reaches the physical device shim — `grep -rn 'physicalDevice' src/` is scoped to src/services"],
  ['screenshot word + git fact', '`git ls-files src/services/screenshot-writer.ts` lists the new module'],
  ['human review word + spec file', 'the human review prompt string is asserted in the spec file src/services/__tests__/prompts.spec.ts'],
];

for (const [label, text] of VALVE_CRITERIA) {
  test(`PRECISION (safety valve): not infeasible — ${label}`, () => {
    // No manifest on purpose: nothing acquits earlier, so Rule 4 is genuinely reached.
    expect(classifyCriterion(text, []).kind).not.toBe('infeasible');
    expect(namesDaemonProvableProof(text)).toBe(true);
  });
}

test('namesDaemonProvableProof recognises each of the five proof methods', () => {
  expect(namesDaemonProvableProof('`bun test src/services/__tests__/foo.test.ts` passes')).toBe(true);
  expect(namesDaemonProvableProof('`npx tsc --noEmit` exits 0')).toBe(true);
  expect(namesDaemonProvableProof('cited at src/services/foo.ts:12')).toBe(true);
  expect(namesDaemonProvableProof("`grep -rn 'foo' src/` returns 0 matches")).toBe(true);
  expect(namesDaemonProvableProof('`git ls-files` lists the new module')).toBe(true);
  // and does NOT invent a sixth
  expect(namesDaemonProvableProof('a human reviewer confirms the wording reads naturally')).toBe(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// REMEDIATION — a gate that only says no becomes the next wall.
// ─────────────────────────────────────────────────────────────────────────────

test('compliantShapeFor(infeasible) names daemon-provable alternative shapes', () => {
  const shape = compliantShapeFor(
    'infeasible',
    'a human reviewer confirms the `SettingsPanel` renders correctly in a browser',
  );
  expect(shape).toContain('Compliant shape:');
  expect(shape).toContain('worktree');
  // Names concrete provable methods, not just a refusal.
  expect(shape).toMatch(/bun test|tsc|file:line|grep|git diff/);
  expect(shape).toContain('SettingsPanel');
});

test('the infeasible remediation offers NO human-verified / defer escape hatch', () => {
  const shape = compliantShapeFor('infeasible', 'manual QA verifies the upgrade path');
  expect(/human[-\s]verified|defer to a human|park for|ask a human to verify/i.test(shape)).toBe(false);
});

test('a convicted infeasible criterion carries the remediation on its reason', () => {
  const v = classifyCriterion('manual QA verifies the upgrade path end to end', FILES);
  expect(v.reason ?? '').toContain('Compliant shape:');
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITION WITH FIX 1 — infeasible routes to REWRITE, never delete.
// ─────────────────────────────────────────────────────────────────────────────

test('actionForKind routes infeasible to REWRITE (not delete)', () => {
  expect(actionForKind('infeasible')).toBe('rewrite');
  // pinned alongside the neighbours so a routing change is visible here
  expect(actionForKind('command-result')).toBe('delete');
  expect(actionForKind('absence')).toBe('rewrite');
  expect(actionForKind('out-of-diff-location')).toBe('rewrite');
});

test('an infeasible verdict, fed to the router, is a rewrite', () => {
  const v = classifyCriterion('the rendered page shows the new tab in a browser', FILES);
  expect(v.kind).toBe('infeasible');
  expect(actionForKind(v.kind as UncitableKind)).toBe('rewrite');
});
