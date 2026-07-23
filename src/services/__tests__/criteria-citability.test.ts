import { test, expect } from 'bun:test';
import {
  parseBlueprintCriteria,
  classifyCriterion,
  validateCriteriaCitability,
  uncitedCriteriaAreAllCommandResults,
  compliantShapeFor,
} from '../criteria-citability';

// FLOOR-PATH FIX: an uncited command-result criterion defers to the command-evidence gate
// (not review-vacuous); an uncited absence does NOT (reviewer must mark it [N/A]).
const cr = (text: string) => ({ text, outcome: 'met', citations: [] as unknown[] });
const cited = (text: string) => ({ text, outcome: 'met', citations: [{}] });

test('uncitedCriteriaAreAllCommandResults: true when every uncited criterion is a command-result', () => {
  const criteria = [
    cited('landedDiffPaths returns merge diff — src/agent/worktree-manager.ts:625'),
    cr('`npx tsc --noEmit -p tsconfig.json` compiles clean; `bun test` passes'),
  ];
  expect(uncitedCriteriaAreAllCommandResults(criteria, ['src/agent/worktree-manager.ts'])).toBe(true);
});

test('uncitedCriteriaAreAllCommandResults: false when an uncited criterion is an ABSENCE (not a command)', () => {
  // "No regression in auth" is a real check no command verifies — must NOT auto-defer.
  const criteria = [cited('feature added — src/a.ts:1'), cr('No regression in the auth flow')];
  expect(uncitedCriteriaAreAllCommandResults(criteria, ['src/a.ts'])).toBe(false);
});

test('uncitedCriteriaAreAllCommandResults: false when uncited set mixes command-result and absence', () => {
  const criteria = [cr('tests pass'), cr('createTodo left untouched')];
  expect(uncitedCriteriaAreAllCommandResults(criteria, [])).toBe(false);
});

test('uncitedCriteriaAreAllCommandResults: false when there are no uncited criteria', () => {
  const criteria = [cited('typo fixed — src/a.ts:3')];
  expect(uncitedCriteriaAreAllCommandResults(criteria, ['src/a.ts'])).toBe(false);
});

test('parseBlueprintCriteria: reads NUMBERED lists, not only bullets (the real spec format)', () => {
  // Regression: leaf specs write criteria as "1. … 2. …" and blueprints copy that. The
  // parser previously matched only [-*] bullets, so it extracted ZERO criteria from a real
  // blueprint and validateCriteriaCitability abstained — making L4 a no-op. These are the
  // two criterion shapes that discarded L3b (2c3f2c67/5443526b) and B0 (346a9343).
  const md = `
## Acceptance criteria

1. \`src/services/verify-epic.ts\` registers the tool. — cite file:line
2. \`npx tsc --noEmit -p tsconfig.json\` clean — cite file:line
3. \`leaf-gate.ts\` untouched (out of scope) — cite file:line
`;
  const parsed = parseBlueprintCriteria(md);
  expect(parsed.length).toBe(3); // was 0 before the fix

  const result = validateCriteriaCitability(md, ['src/services/verify-epic.ts']);
  expect(result.status).toBe('uncitable'); // was 'abstain' before the fix
  const kinds = result.offenders.map((o) => o.kind).sort();
  expect(kinds).toEqual(['absence', 'command-result']);
});

test('parseBlueprintCriteria: numbered list with ) marker also parses', () => {
  const md = `
## Acceptance criteria

1) A clean criterion — src/services/criteria-citability.ts:50
`;
  expect(parseBlueprintCriteria(md).length).toBe(1);
});

test('classifyCriterion: real uncitable examples', () => {
  // Example 1: absence — "No production file touched"
  const v1 = classifyCriterion('No production file (useAgentStatus.ts) touched', [
    'src/services/leaf-executor.ts',
  ]);
  expect(v1.citable).toBe(false);
  expect(v1.kind).toBe('absence');

  // Example 2: out-of-diff-location — citation outside declared files
  const v2 = classifyCriterion('Hook returns the cached value — useAgentStatus.ts:70', [
    'ui/src/components/Foo.tsx',
  ]);
  expect(v2.citable).toBe(false);
  expect(v2.kind).toBe('out-of-diff-location');

  // Example 3: command-result — bun run with result predicate
  const v3 = classifyCriterion(
    'bun run scripts/test-backend.ts run; failing files match master',
    ['src/services/criteria-citability.ts'],
  );
  expect(v3.citable).toBe(false);
  expect(v3.kind).toBe('command-result');

  // Example 4: command-result — npx vitest run
  const v4 = classifyCriterion(
    'Verify command passes: npx vitest run ui/src/x.test.tsx',
    ['src/services/criteria-citability.ts'],
  );
  expect(v4.citable).toBe(false);
  expect(v4.kind).toBe('command-result');

  // Example 5: absence — "No self-report field added"
  const v5 = classifyCriterion(
    'No self-report field added to NodeSpec/node prompts',
    ['src/services/leaf-executor.ts', 'src/agent/node-invoker.ts'],
  );
  expect(v5.citable).toBe(false);
  expect(v5.kind).toBe('absence');
});

test('classifyCriterion: citable controls', () => {
  // Control 1: plain in-diff criterion with citation
  const c1 = classifyCriterion(
    'The executor classifies each acceptance criterion before the implement node is spawned',
    ['src/services/leaf-executor.ts'],
  );
  expect(c1.citable).toBe(true);

  // Control 2: Rule-0 acquittal — citation resolves into declared files
  const c2 = classifyCriterion(
    'Gate parks the leaf — src/services/leaf-executor.ts:1930',
    ['src/services/leaf-executor.ts'],
  );
  expect(c2.citable).toBe(true);

  // Control 3: Rule-1 guard — absent manifest, so we abstain (no declared files)
  const c3 = classifyCriterion(
    'Hook returns the cached value — useAgentStatus.ts:70',
    [], // empty declaredFiles
  );
  expect(c3.citable).toBe(true);

  // Control 4: word "command" alone is NOT a trigger
  const c4 = classifyCriterion(
    "A criterion that asserts a command's result is classified uncitable",
    ['src/services/criteria-citability.ts'],
  );
  expect(c4.citable).toBe(true);

  // Control 5: word "absence" alone is NOT a trigger
  const c5 = classifyCriterion(
    "A criterion that asserts an absence is classified uncitable",
    ['src/services/criteria-citability.ts'],
  );
  expect(c5.citable).toBe(true);
});

test('parseBlueprintCriteria: extracts list items from acceptance criteria section', () => {
  const md = `
# Title

## Acceptance criteria

- No production file (useAgentStatus.ts) touched
- Gate parks the leaf — src/services/leaf-executor.ts:1930
- A second criterion

## Next section

- This should not be included
`;
  const criteria = parseBlueprintCriteria(md);
  expect(criteria).toEqual([
    'No production file (useAgentStatus.ts) touched',
    'Gate parks the leaf',
    'A second criterion',
  ]);
});

test('parseBlueprintCriteria: ignores list items inside fenced code blocks', () => {
  const md = `
## Acceptance criteria

- Real criterion one
- Real criterion two

\`\`\`json
{ "filesToCreate": ["- ignored item in json"] }
\`\`\`

- Real criterion three
`;
  const criteria = parseBlueprintCriteria(md);
  expect(criteria).toEqual(['Real criterion one', 'Real criterion two', 'Real criterion three']);
});

test('parseBlueprintCriteria: strips checkbox prefix', () => {
  const md = `
## Acceptance criteria

- [x] Checkbox criterion one
- [ ] Checkbox criterion two
- Plain criterion
`;
  const criteria = parseBlueprintCriteria(md);
  expect(criteria).toEqual([
    'Checkbox criterion one',
    'Checkbox criterion two',
    'Plain criterion',
  ]);
});

test('parseBlueprintCriteria: no section returns empty array', () => {
  const md = `
# Title

Some prose without acceptance criteria.
`;
  const criteria = parseBlueprintCriteria(md);
  expect(criteria).toEqual([]);
});

test('validateCriteriaCitability: status "ok" when all criteria are citable', () => {
  const md = `
## Acceptance criteria

- The executor classifies each criterion — src/services/leaf-executor.ts:100
- A second clean criterion — src/services/criteria-citability.ts:50
`;
  const result = validateCriteriaCitability(md, [
    'src/services/leaf-executor.ts',
    'src/services/criteria-citability.ts',
  ]);
  expect(result.status).toBe('ok');
  expect(result.offenders).toEqual([]);
  expect(result.reasons).toEqual([]);
});

test('validateCriteriaCitability: status "uncitable" when at least one criterion is uncitable', () => {
  const md = `
## Acceptance criteria

- No production file touched
- Good criterion — src/services/leaf-executor.ts:100
`;
  const result = validateCriteriaCitability(md, ['src/services/leaf-executor.ts']);
  expect(result.status).toBe('uncitable');
  expect(result.offenders.length).toBe(1);
  expect(result.offenders[0]?.kind).toBe('absence');
});

test('validateCriteriaCitability: reasons include offending criterion text', () => {
  const md = `
## Acceptance criteria

- No production file (useAgentStatus.ts) touched
`;
  const result = validateCriteriaCitability(md, ['src/services/leaf-executor.ts']);
  expect(result.reasons.length).toBeGreaterThan(0);
  expect(result.reasons[0]).toContain(
    'No production file (useAgentStatus.ts) touched',
  );
});

test('validateCriteriaCitability: status "abstain" when no criteria section found', () => {
  const md = `
# Title

Some prose without acceptance criteria.
`;
  const result = validateCriteriaCitability(md, []);
  expect(result.status).toBe('abstain');
  expect(result.verdicts).toEqual([]);
  expect(result.offenders).toEqual([]);
});

test('classifyCriterion: Rule-1 only convicts when declaredFiles is non-empty', () => {
  const text = 'Hook returns cached value — useAgentStatus.ts:70';

  // With empty declaredFiles, should be citable (abstain on ignorance)
  const v1 = classifyCriterion(text, []);
  expect(v1.citable).toBe(true);

  // With a different file declared, should be uncitable (citation outside diff)
  const v2 = classifyCriterion(text, ['src/services/other-file.ts']);
  expect(v2.citable).toBe(false);
  expect(v2.kind).toBe('out-of-diff-location');

  // With the cited file declared, should be citable
  const v3 = classifyCriterion(text, ['useAgentStatus.ts']);
  expect(v3.citable).toBe(true);
});

test('classifyCriterion: invocation token patterns trigger command-result', () => {
  const patterns = [
    'npm run test',
    'npx vitest run src/',
    'bun test --watch',
    'pnpm build',
    'yarn lint',
    'make check',
    'tsc --noEmit',
    'cargo test',
    'go test ./...',
  ];

  for (const pattern of patterns) {
    const v = classifyCriterion(pattern, ['src/some/file.ts']);
    expect(v.citable).toBe(false);
    expect(v.kind).toBe('command-result');
  }
});

test('classifyCriterion: recognizes → 0 arrow notation as absence result (Rule 1.5)', () => {
  const v = classifyCriterion(
    'MECHANICAL zero-match: `grep -c ZenMode ui/src/App.tsx` → 0',
    [],
  );
  expect(v.citable).toBe(true);
  expect(v.kind).toBe('command-result');
});

test('classifyCriterion: recognizes returns 0 phrasing as absence result (Rule 1.5)', () => {
  const v = classifyCriterion(
    'MECHANICAL zero-match: `grep -c ZenMode ui/src/App.tsx` returns 0',
    [],
  );
  expect(v.citable).toBe(true);
  expect(v.kind).toBe('command-result');
});

test('classifyCriterion: recognizes returns no matches phrasing as absence result (Rule 1.5)', () => {
  const v = classifyCriterion(
    'MECHANICAL zero-match: `grep -c ZenMode ui/src/App.tsx` returns no matches',
    [],
  );
  expect(v.citable).toBe(true);
  expect(v.kind).toBe('command-result');
});

test('classifyCriterion: bare-prose absence stays convicted even with read-only verbs', () => {
  const v = classifyCriterion('ZenMode no longer appears in the codebase', []);
  expect(v.citable).toBe(false);
  expect(v.kind).toBe('absence');
});

test('classifyCriterion: result predicate patterns trigger command-result', () => {
  const patterns = [
    'Suite passes',
    'Tests pass',
    'Build succeeds',
    'Gate exits 0',
    'Typecheck clean',
    'Results match master',
  ];

  for (const pattern of patterns) {
    const v = classifyCriterion(pattern, ['src/some/file.ts']);
    expect(v.citable).toBe(false);
    expect(v.kind).toBe('command-result');
  }
});

test('classifyCriterion: absence patterns trigger absence verdict', () => {
  const patterns = [
    'No new files added',
    'No other functions added',
    'No additional imports introduced',
    'No extra fields created',
    'File is not touched',
    'Code is not modified',
    'Module is not changing',
    'Field unchanged',
    'Reference untouched',
  ];

  for (const pattern of patterns) {
    const v = classifyCriterion(pattern, ['src/some/file.ts']);
    expect(v.citable).toBe(false);
    expect(v.kind).toBe('absence');
  }
});

test('classifyCriterion: xcode/swift invocations + BUILD SUCCEEDED trigger command-result', () => {
  const patterns = [
    'xcodebuild -scheme App build',
    'swift build --configuration release',
    'xcrun simctl boot',
    'BUILD SUCCEEDED',
    'The build succeeded on CI',
  ];
  for (const pattern of patterns) {
    const v = classifyCriterion(pattern, ['src/some/file.ts']);
    expect(v.citable).toBe(false);
    expect(v.kind).toBe('command-result');
  }
});

test('classifyCriterion: no-longer/references-nothing/nothing-external/self-contained trigger absence', () => {
  const patterns = [
    'The module no longer imports the legacy helper',
    'The criterion references nothing outside the diff',
    'The output references nothing external',
    'The generated file is self-contained',
  ];
  for (const pattern of patterns) {
    const v = classifyCriterion(pattern, ['src/some/file.ts']);
    expect(v.citable).toBe(false);
    expect(v.kind).toBe('absence');
  }
});

test('classifyCriterion: ACQUITS an absence criterion that names grep -c … returns 0', () => {
  const v = classifyCriterion(
    'the modal no longer shows an Autonomy ladder — grep -c OrchestratorLadder ProjectSettingsModal.tsx returns 0',
    [],
  );
  expect(v.citable).toBe(true);
  expect(v.kind).toBe('command-result');
});

test('classifyCriterion: ACQUITS a removal criterion that names grep -c … returns 0', () => {
  const v = classifyCriterion(
    'delete the per-module title lists — grep -c "const BUCKET_TITLES" todo-store.ts returns 0',
    [],
  );
  expect(v.citable).toBe(true);
  expect(v.kind).toBe('command-result');
});

test('validateCriteriaCitability: a blueprint of acquitted verification criteria is NOT uncitable', () => {
  const bp = [
    '## Acceptance Criteria',
    '- the modal no longer shows an Autonomy ladder; grep -c OrchestratorLadder ProjectSettingsModal.tsx returns 0',
    '- delete the per-module title lists; grep -c "const BUCKET_TITLES" todo-store.ts returns 0',
  ].join('\n');
  expect(validateCriteriaCitability(bp, []).status).not.toBe('uncitable');
});

test('uncitedCriteriaAreAllCommandResults: true for the acquitted verification shapes', () => {
  const criteria = [
    cr('the modal no longer shows an Autonomy ladder — grep -c OrchestratorLadder ProjectSettingsModal.tsx returns 0'),
    cr('delete the per-module title lists — grep -c "const BUCKET_TITLES" todo-store.ts returns 0'),
  ];
  expect(uncitedCriteriaAreAllCommandResults(criteria, [])).toBe(true);
});

test('classifyCriterion: ACQUITS the exact wall example — grep -rn pattern+scope, "no matches"', () => {
  // The literal shape observed live on parked removal leaves: name the pattern AND the scope.
  const v = classifyCriterion(
    "the sole import of ptyManager is removed — grep -rn 'ptyManager' src/ returns no matches",
    [],
  );
  expect(v.citable).toBe(true);
  expect(v.kind).toBe('command-result');
});

test('classifyCriterion: a vague removal absence with NO pattern+scope STAYS rejected (fail-closed)', () => {
  // "ZenMode.tsx deleted" / "server.ts no longer defines X" with no runnable check attached.
  const v1 = classifyCriterion('ZenMode.tsx is deleted, no longer referenced anywhere', []);
  expect(v1.citable).toBe(false);
  expect(v1.kind).toBe('absence');

  const v2 = classifyCriterion('session-summary-loop.ts no longer defines runSessionSummaryTick', []);
  expect(v2.citable).toBe(false);
  expect(v2.kind).toBe('absence');
});

test('uncitedCriteriaAreAllCommandResults: defers the exact wall example to command-evidence', () => {
  const criteria = [
    cr("the sole import of ptyManager is removed — grep -rn 'ptyManager' src/ returns no matches"),
  ];
  expect(uncitedCriteriaAreAllCommandResults(criteria, [])).toBe(true);
});

test('classifyCriterion: bare "No regression in the auth flow" STAYS uncitable absence', () => {
  const v = classifyCriterion('No regression in the auth flow', []);
  expect(v.citable).toBe(false);
  expect(v.kind).toBe('absence');
});

test('classifyCriterion: bare "tests pass" STAYS command-result (no invocation+arg)', () => {
  const v = classifyCriterion('tests pass', []);
  expect(v.citable).toBe(false);
  expect(v.kind).toBe('command-result');
});

test('classifyCriterion: artifact-content assertion is CITABLE (measurement/spike shape)', () => {
  // The exact shape that blocked the author-fidelity spike leaves — falsifiable by reading the file.
  const v1 = classifyCriterion('results/report.md contains a ## GATE verdict section with a bold PASS or ESCALATE', []);
  expect(v1.citable).toBe(true);

  const v2 = classifyCriterion('After running the harness, score.json records the declared-vs-actual match rate for each case', []);
  expect(v2.citable).toBe(true);

  const v3 = classifyCriterion('run.json shows 10 emitted contracts with a leafKind field on each entry', []);
  expect(v3.citable).toBe(true);
});

test('classifyCriterion: artifact acquit does NOT rescue vague suite claims or absences', () => {
  // No concrete artifact file → still a command-result (uncitable).
  expect(classifyCriterion('the test suite passes', []).citable).toBe(false);
  expect(classifyCriterion('tsc --noEmit exits 0', []).citable).toBe(false);
  // A file mention that asserts an ABSENCE stays uncitable (not masked by the artifact rule).
  expect(classifyCriterion('config.json is unchanged', []).citable).toBe(false);
  expect(classifyCriterion('no new entries in manifest.json', []).citable).toBe(false);
  // A source-code (.ts) citation is NOT an output artifact → still routed to the code rules.
  const codeCite = classifyCriterion('src/services/foo.ts:42 gains a new branch', ['src/services/bar.ts']);
  expect(codeCite.citable).toBe(false);
});

test('classifyCriterion: test-only citation resolves at base → citable', () => {
  const v = classifyCriterion('Existing helper covered — src/services/foo.ts:12', ['src/services/foo.test.ts'], {
    testOnly: true,
    citationExistsAtBase: () => true,
  });
  expect(v.citable).toBe(true);
});

test('classifyCriterion: test-only citation does NOT resolve at base → uncitable', () => {
  const v = classifyCriterion('Existing helper covered — src/services/foo.ts:12', ['src/services/foo.test.ts'], {
    testOnly: true,
    citationExistsAtBase: () => false,
  });
  expect(v.citable).toBe(false);
  expect(v.kind).toBe('out-of-diff-location');
  expect(v.reason).toContain('src/services/foo.ts:12');
  expect(v.reason).toContain('does not exist at base');
});

test('classifyCriterion: same citation without testOnly still convicts', () => {
  // Test with opts omitted (default)
  const v1 = classifyCriterion('Existing helper covered — src/services/foo.ts:12', ['src/services/foo.test.ts']);
  expect(v1.citable).toBe(false);
  expect(v1.kind).toBe('out-of-diff-location');

  // Test with citationExistsAtBase alone (without testOnly: true)
  const v2 = classifyCriterion('Existing helper covered — src/services/foo.ts:12', ['src/services/foo.test.ts'], {
    citationExistsAtBase: () => true,
  });
  expect(v2.citable).toBe(false);
  expect(v2.kind).toBe('out-of-diff-location');
});

test('classifyCriterion: opts-absent vs empty opts parity', () => {
  const text = 'Hook returns the cached value — useAgentStatus.ts:70';
  const declaredFiles = ['src/services/criteria-citability.ts'];

  // Call with no opts argument
  const v1 = classifyCriterion(text, declaredFiles);

  // Call with empty opts object
  const v2 = classifyCriterion(text, declaredFiles, {});

  // Both should have identical verdicts
  expect(v1.citable).toBe(v2.citable);
  expect(v1.kind).toBe(v2.kind);
  expect(v1.reason).toBe(v2.reason);
});

test('classifyCriterion: citation into a concrete filesToCreate entry is citable', () => {
  const v = classifyCriterion('New handler exported — src/services/new-handler.ts:1', [
    'src/services/new-handler.ts',
  ]);
  expect(v.citable).toBe(true);
});

test('classifyCriterion: citation into a GLOB-declared filesToCreate entry is citable', () => {
  const v = classifyCriterion('Test case passes — results/case-001.json:1', ['results/*.json']);
  expect(v.citable).toBe(true);
});

test('classifyCriterion: citation into unrelated file matching no declared entry convicts', () => {
  const v = classifyCriterion('Test coverage reached — src/services/unrelated-nonexistent.ts:1', [
    'results/*.json',
    'src/services/new-handler.ts',
  ]);
  expect(v.citable).toBe(false);
  expect(v.kind).toBe('out-of-diff-location');
});

// --- compliantShapeFor: per-arm compliant-shape template -------------------------------------

test('compliantShapeFor: command-result carries the marker and a grep example drawn from the input', () => {
  const shape = compliantShapeFor('command-result', 'the `npm test` suite passes');
  expect(shape).toContain('restate as a named zero-match check');
  expect(shape).toContain('grep -rn');
  expect(shape).toContain('npm test');
});

test('compliantShapeFor: absence carries the marker and an outOfScope example drawn from the input', () => {
  const shape = compliantShapeFor('absence', 'no changes to `ZenMode`');
  expect(shape).toContain('move the negation into the size-manifest');
  expect(shape).toContain('outOfScope:');
  expect(shape).toContain('ZenMode');
});

test('compliantShapeFor: out-of-diff-location carries the marker and the offending path', () => {
  const shape = compliantShapeFor('out-of-diff-location', 'criterion cites src/services/foo.ts:42');
  expect(shape).toContain('declare it or re-cite');
  expect(shape).toContain('src/services/foo.ts');
});

test('classifyCriterion: convicted command-result reason contains the compliant-shape marker and an example token', () => {
  const v = classifyCriterion('the `npm test` suite passes', []);
  expect(v.citable).toBe(false);
  expect(v.kind).toBe('command-result');
  expect(v.reason).toContain('restate as a named zero-match check');
  expect(v.reason).toContain('npm test');
});

test('classifyCriterion: convicted absence reason contains the compliant-shape marker and an example token', () => {
  const v = classifyCriterion('no changes to `ZenMode`', []);
  expect(v.citable).toBe(false);
  expect(v.kind).toBe('absence');
  expect(v.reason).toContain('move the negation into the size-manifest');
  expect(v.reason).toContain('ZenMode');
});

test('classifyCriterion: convicted out-of-diff-location reason contains the compliant-shape marker and the offending path', () => {
  const v = classifyCriterion('Handler covered — src/services/unrelated-nonexistent.ts:1', [
    'src/services/new-handler.ts',
  ]);
  expect(v.citable).toBe(false);
  expect(v.kind).toBe('out-of-diff-location');
  expect(v.reason).toContain('declare it or re-cite');
  expect(v.reason).toContain('src/services/unrelated-nonexistent.ts:1');
});

test('round-trip: the embedded command-result compliant shape (mechanical zero-match gate) is citable', () => {
  const blueprintMd = [
    '## Acceptance Criteria',
    "1. `grep -rn 'npm test' src/` returns no matches",
  ].join('\n');
  const result = validateCriteriaCitability(blueprintMd, []);
  expect(result.status).toBe('ok');
});

test('round-trip: the embedded absence compliant shape (surviving-state citation) is citable', () => {
  const blueprintMd = [
    '## Acceptance Criteria',
    '1. The sole remaining reference to ZenMode is src/services/new-handler.ts:1',
  ].join('\n');
  const result = validateCriteriaCitability(blueprintMd, ['src/services/new-handler.ts']);
  expect(result.status).toBe('ok');
});

test('round-trip: the embedded out-of-diff-location compliant shape (re-cited into declared files) is citable', () => {
  const blueprintMd = [
    '## Acceptance Criteria',
    '1. Handler covered — src/services/new-handler.ts:1',
  ].join('\n');
  const result = validateCriteriaCitability(blueprintMd, ['src/services/new-handler.ts']);
  expect(result.status).toBe('ok');
});
