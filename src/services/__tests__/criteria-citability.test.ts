import { test, expect } from 'bun:test';
import {
  parseBlueprintCriteria,
  classifyCriterion,
  validateCriteriaCitability,
  uncitedCriteriaAreAllCommandResults,
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
