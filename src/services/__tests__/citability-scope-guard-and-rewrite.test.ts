/**
 * citability-scope-guard-and-rewrite.test.ts — scope-guard criterion acceptance and
 * absence-rewrite disposition.
 *
 * Regression cover for scope-guard criteria (git diff --stat <path> is empty / 0 files changed)
 * and for the disposition-routed repair that routes absence-kind offenders to a targeted
 * rewrite node instead of a full blueprint re-author.
 *
 * Pure test: no worktree, no git, no node spawn, no stubs. Both modules under test are
 * imported directly and exercised with fixtures.
 */
import { describe, it, expect } from 'bun:test';
import {
  classifyCriterion,
  validateCriteriaCitability,
  compliantShapeFor,
} from '../criteria-citability';
import {
  planCriteriaDispositions,
  rewriteRequests,
  applyCriteriaRepair,
} from '../blueprint-criteria-splice';

describe('citability-scope-guard-and-rewrite', () => {
  const declaredFiles = ['src/services/foo.ts'];

  it('accepts a criterion whose body cites a scope-guard command asserted empty', () => {
    // Scope-guard criterion text: asserts git diff --stat <path> is empty
    const scopeGuardText =
      'Implementation stays inside scope: `git diff HEAD --stat -- src/services/foo.ts` is empty (0 files changed)';

    // Verify classifyCriterion accepts it as a command-result
    const verdict = classifyCriterion(scopeGuardText, declaredFiles);
    expect(verdict.citable).toBe(true);
    expect(verdict.kind).toBe('command-result');

    // Build a blueprint markdown with this scope-guard criterion
    const blueprintMd = `# My Blueprint

## Acceptance Criteria

- src/services/foo.ts defines function fooGuard returning a boolean
- ${scopeGuardText}

\`\`\`json
{ "schemaVersion": 2 }
\`\`\`
`;

    // Validate the blueprint against declared files
    const validation = validateCriteriaCitability(blueprintMd, declaredFiles);
    expect(validation.status).toBe('ok');
    expect(validation.offenders.length).toBe(0);
  });

  it('emits a gate-accepted replacement from the targeted-rewrite disposition', () => {
    // Blueprint with one citable criterion and one absence criterion
    const blueprintMd = `# My Blueprint

## Acceptance Criteria

- src/services/foo.ts defines function fooGuard returning a boolean
- No regression in the auth flow

\`\`\`json
{ "schemaVersion": 2 }
\`\`\`
`;

    // Validate: should find one offender (the absence)
    const validation = validateCriteriaCitability(blueprintMd, declaredFiles);
    expect(validation.status).toBe('uncitable');
    expect(validation.offenders.length).toBe(1);
    expect(validation.offenders[0]!.kind).toBe('absence');

    // Plan the dispositions
    const plan = planCriteriaDispositions(blueprintMd, validation.offenders);
    expect(plan.rewrites.length).toBe(1);
    expect(plan.deletes.length).toBe(0);
    expect(plan.vacuous).toBe(false);

    // Get the rewrite requests
    const requests = rewriteRequests(plan);
    expect(requests.length).toBe(1);
    expect(requests[0]!.shape).toMatch(/^Compliant shape:/);
    expect(requests[0]!.shape).toContain('git diff HEAD --stat');

    // Simulate the rewrite node's reply
    const replyText =
      '1) The auth flow guard is unchanged in scope: `git diff HEAD --stat -- src/services/auth.ts` is empty (0 files changed)';

    // Apply the criteria repair
    const result = applyCriteriaRepair(blueprintMd, plan, replyText);
    expect(result.rewritten).toBe(1);
    expect(result.deleted).toBe(0);

    // Re-validate the repaired blueprint
    const revalidation = validateCriteriaCitability(result.md, declaredFiles);
    expect(revalidation.status).toBe('ok');
    expect(revalidation.offenders.length).toBe(0);
  });

  it('keeps convicting a bare negation carrying no citation', () => {
    // A bare absence criterion with no command-result or citation
    const bareAbsenceText = 'No regression in the auth flow';

    // Verify classifyCriterion convicts it as absence
    const verdict = classifyCriterion(bareAbsenceText, declaredFiles);
    expect(verdict.citable).toBe(false);
    expect(verdict.kind).toBe('absence');
    expect(verdict.reason).toMatch(/absence/i);
  });
});
