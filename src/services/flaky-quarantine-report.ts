import { setQuarantinePromotionHook, type FlakyCandidate } from './flaky-quarantine';
import { recordFrictionOnce } from './friction-store';
import { createTodo } from './todo-store';
import { ensureBucket } from './bucket-registry';

interface QuarantineReportDeps {
  recordFrictionOnce?: typeof recordFrictionOnce;
  createTodo?: typeof createTodo;
  ensureBucket?: typeof ensureBucket;
}

/**
 * Best-effort side effects for a newly-promoted flaky-test quarantine candidate: a
 * deduplicated friction note (idempotency key = test@sha) and, only on the FIRST
 * promotion of that (test, sha) pair, a [BUG] todo under the project's bugfix inbox
 * epic so the promotion is never silent.
 */
export async function runQuarantinePromotionReport(
  c: FlakyCandidate & { project: string },
  deps: QuarantineReportDeps = {},
): Promise<void> {
  const recordFrictionOnceFn = deps.recordFrictionOnce ?? recordFrictionOnce;
  const createTodoFn = deps.createTodo ?? createTodo;
  const ensureBucketFn = deps.ensureBucket ?? ensureBucket;

  try {
    const key = `quarantine:${c.test}@${c.quarantinedAtSha}`;
    const inserted = await recordFrictionOnceFn(c.project, {
      layer: 'operational',
      retryReason: 'flaky-test-quarantined',
      detail: JSON.stringify({
        key,
        test: c.test,
        quarantinedAtSha: c.quarantinedAtSha,
        evidence: c.evidence,
        ttlExpiresAt: c.ttlExpiresAt,
      }),
    });

    if (!inserted) return;

    const epicId = await ensureBucketFn(c.project, 'bugfix');
    await createTodoFn(c.project, {
      ownerSession: '__quarantine_report__',
      parentId: epicId,
      title: `[BUG] flaky test quarantined: ${c.test}`,
      description:
        `Auto-filed when a flaky test was promoted to quarantine.\n\n` +
        `Test: ${c.test}\nQuarantined at sha: ${c.quarantinedAtSha}\n` +
        `Evidence: ${c.evidence.runs} runs (${c.evidence.passRuns} pass / ${c.evidence.failRuns} fail)\n` +
        `TTL expires at: ${new Date(c.ttlExpiresAt).toISOString()}\n\n` +
        `The base gate excludes this test from gating until the TTL expires; fix it or it re-enters gating.`,
      status: 'planned',
    });
  } catch (err) {
    console.warn(
      `[flaky-quarantine-report] ${c.project}: failed to report quarantine promotion for "${c.test}":`,
      err instanceof Error ? err.message : err,
    );
  }
}

export function registerQuarantinePromotionReport(deps: QuarantineReportDeps = {}): void {
  setQuarantinePromotionHook((c) => {
    void runQuarantinePromotionReport(c, deps).catch(() => {});
  });
}

registerQuarantinePromotionReport();
