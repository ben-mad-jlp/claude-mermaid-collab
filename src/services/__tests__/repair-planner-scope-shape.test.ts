/**
 * repair-planner-scope-shape.test.ts — scope-guard criterion first-attempt acceptance.
 *
 * Regression cover for the scope-guard criterion rendering: the criterion emitted by
 * scopeGuardCriterion must use a parse-safe separator (`. ` not ` — `) so that
 * parseBlueprintCriteria preserves the git diff command tail and classifyCriterion
 * accepts it on the first validation pass.
 *
 * Pure test: no worktree, no git, no node spawn, no stubs. All modules under test are
 * imported directly and exercised with fixtures.
 */
import { describe, it, expect } from 'bun:test';
import {
  buildNodePrompt,
  scopeGuardCriterion,
} from '../leaf-prompts';
import {
  classifyCriterion,
  validateCriteriaCitability,
} from '../criteria-citability';
import type { Todo } from '../todo-store';

describe('repair-planner-scope-shape', () => {
  const minimalLeaf = {
    id: 'leaf-1',
    title: 'a leaf',
    description: 'do the thing',
  } as unknown as Todo;

  it('expresses an untouched-surface limit as outOfScope or a scope-guard command, never as a prose absence', () => {
    // Build the blueprint prompt
    const prompt = buildNodePrompt('blueprint', minimalLeaf);

    // Assert the prompt contains outOfScope guidance
    expect(prompt).toContain('outOfScope');

    // Assert the prompt contains scopeGuardCriterion verbatim with an example path
    const exampleGuard = scopeGuardCriterion('src/services/foo.ts');
    expect(prompt).toContain(exampleGuard);

    // Assert the prompt contains the git diff command
    expect(prompt).toContain('git diff HEAD --stat');

    // Assert the prompt does NOT contain the old pre-fix imperative "record it as"
    // (the surviving instruction is "NEVER as a prose NON-GOALS note", so check
    // for the specific imperative word that was removed)
    expect(prompt).not.toContain('record it as');
  });

  it('produces a blueprint classifyCriterion accepts on the first attempt for a single-assertion repair', () => {
    // Helper: build a minimal blueprint with a customizable limit criterion
    function makeBlueprint(limitCriterion: string): string {
      return `# Test Blueprint

## Acceptance Criteria

- src/services/__tests__/foo.test.ts defines it('guards the implementation')
- ${limitCriterion}

\`\`\`json
{ "schemaVersion": 2, "leafKind": "fix",
  "estimatedFiles": 1, "estimatedTasks": 1, "nonEnumerableFanout": false,
  "filesToCreate": [], "filesToEdit": ["src/services/__tests__/foo.test.ts"],
  "tasks": [],
  "requirements": [
    { "kind": "named-test", "id": "guard-test", "testFile": "src/services/__tests__/foo.test.ts", "testName": "guards the implementation", "mechanical": true },
    { "kind": "observable", "id": "scope-untouched", "description": "The implementation is untouched" }
  ],
  "outOfScope": ["src/services/foo.ts"]
}
\`\`\`
`;
    }

    // The declared files this blueprint touches
    const declaredFiles = ['src/services/__tests__/foo.test.ts'];

    // ARM 1: The parse-safe form using `. ` separator
    const scopeGuardText = scopeGuardCriterion('src/services/foo.ts');
    const blueprintWithGuard = makeBlueprint(scopeGuardText);

    // Validate on first attempt
    const validation = validateCriteriaCitability(blueprintWithGuard, declaredFiles);
    expect(validation.status).toBe('ok');
    expect(validation.offenders.length).toBe(0);

    // ARM 2 (MUTATION): Replace the scope guard with bare prose "Implementation untouched"
    // to confirm the parser correctly rejects the unparseable form
    const bareProse = 'Implementation untouched';
    const blueprintWithBare = makeBlueprint(bareProse);

    // Validate the mutated form
    const mutationValidation = validateCriteriaCitability(blueprintWithBare, declaredFiles);
    expect(mutationValidation.status).toBe('uncitable');
    expect(mutationValidation.offenders.length).toBe(1);
    expect(mutationValidation.offenders[0]?.kind).toBe('absence');
  });
});
