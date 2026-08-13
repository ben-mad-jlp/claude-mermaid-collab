import { setQuarantinePromotionHook, setQuarantineExpiryHook, type FlakyCandidate, type QuarantineExpiryEvent } from './flaky-quarantine';
import { recordFrictionOnce } from './friction-store';
import { createTodo, listTodos, updateTodo } from './todo-store';
import { ensureBucket } from './bucket-registry';
import { quarantineDedupKey } from './quarantine-dedup';
import { resolveQuarantineTestFile } from './quarantine-test-file';

interface QuarantineReportDeps {
  recordFrictionOnce?: typeof recordFrictionOnce;
  createTodo?: typeof createTodo;
  listTodos?: typeof listTodos;
  updateTodo?: typeof updateTodo;
  ensureBucket?: typeof ensureBucket;
  resolveTestFile?: (project: string, test: string) => string | null;
}

const QUARANTINE_TITLE_PREFIX = '[BUG] flaky test quarantined: ';

/**
 * Best-effort side effects for a newly-promoted flaky-test quarantine candidate: a
 * deduplicated friction note (idempotency key = test) and, on the first promotion of
 * that test, a [BUG] todo under the project's flaky bucket epic; on re-promotion at a
 * different sha, the existing non-terminal todo is refreshed with new evidence and TTL.
 */
export async function runQuarantinePromotionReport(
  c: FlakyCandidate & { project: string },
  deps: QuarantineReportDeps = {},
): Promise<void> {
  const recordFrictionOnceFn = deps.recordFrictionOnce ?? recordFrictionOnce;
  const createTodoFn = deps.createTodo ?? createTodo;
  const listTodosFn = deps.listTodos ?? listTodos;
  const updateTodoFn = deps.updateTodo ?? updateTodo;
  const ensureBucketFn = deps.ensureBucket ?? ensureBucket;
  const resolveTestFileFn = deps.resolveTestFile ?? resolveQuarantineTestFile;

  try {
    const key = `quarantine:${c.test}`;
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

    const epicId = await ensureBucketFn(c.project, 'flaky');
    const testFile = resolveTestFileFn(c.project, c.test);
    let title = `[BUG] flaky test quarantined: ${c.test}`;
    if (testFile && !c.test.includes('src/') && !c.test.includes('ui/')) {
      title += ` [${testFile}]`;
    }
    let descriptionLines = [
      `Auto-filed when a flaky test was promoted to quarantine.\n`,
      `Test: ${c.test}`,
    ];
    if (testFile) {
      descriptionLines.push(`Test file: ${testFile}`);
    }
    descriptionLines.push(
      `Quarantined at sha: ${c.quarantinedAtSha}`,
      `Evidence: ${c.evidence.runs} runs (${c.evidence.passRuns} pass / ${c.evidence.failRuns} fail)`,
      `TTL expires at: ${new Date(c.ttlExpiresAt).toISOString()}`,
      ``,
      `The base gate excludes this test from gating until the TTL expires; fix it or it re-enters gating.`,
    );
    const description = descriptionLines.join('\n');

    const suffix = c.test;
    const existing = listTodosFn(c.project, { includeCompleted: true }).find(
      (t) =>
        t.parentId === epicId &&
        quarantineDedupKey(t.title.slice(QUARANTINE_TITLE_PREFIX.length), resolveTestFileFn(c.project, t.title.slice(QUARANTINE_TITLE_PREFIX.length))) === quarantineDedupKey(suffix, testFile) &&
        t.status !== 'done' &&
        t.status !== 'dropped',
    );

    if (existing) {
      await updateTodoFn(c.project, existing.id, { description });
    } else {
      await createTodoFn(c.project, {
        ownerSession: '__quarantine_report__',
        parentId: epicId,
        title,
        description,
        status: 'planned',
      });
    }
  } catch (err) {
    console.warn(
      `[flaky-quarantine-report] ${c.project}: failed to report quarantine promotion for "${c.test}":`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Best-effort friction note for a quarantine row that lapsed without renewal: a
 * deduplicated `quarantine-expired:<test>` entry, keyed only on stored row fields so a
 * repeat sweep's identical detail payload is rejected by recordFrictionOnce's dedup.
 * No todo, no bucket — the base gate already stopped excluding the test; this is a note.
 */
export async function runQuarantineExpiryReport(
  e: QuarantineExpiryEvent,
  deps: QuarantineReportDeps = {},
): Promise<void> {
  const recordFrictionOnceFn = deps.recordFrictionOnce ?? recordFrictionOnce;

  try {
    await recordFrictionOnceFn(e.project, {
      layer: 'operational',
      retryReason: 'quarantine-expired',
      detail: JSON.stringify({
        key: `quarantine-expired:${e.test}`,
        test: e.test,
        quarantinedAtSha: e.quarantinedAtSha,
        evidence: e.evidence,
        ttlExpiresAt: e.ttlExpiresAt,
      }),
    });
  } catch (err) {
    console.warn(
      `[flaky-quarantine-report] ${e.project}: failed to report quarantine expiry for "${e.test}":`,
      err instanceof Error ? err.message : err,
    );
  }
}

export function registerQuarantinePromotionReport(deps: QuarantineReportDeps = {}): void {
  setQuarantinePromotionHook((c) => {
    void runQuarantinePromotionReport(c, deps).catch(() => {});
  });
  setQuarantineExpiryHook((e) => {
    void runQuarantineExpiryReport(e, deps).catch(() => {});
  });
}

registerQuarantinePromotionReport();
