/**
 * Pure flaky-test classifier and quarantine ledger.
 *
 * Observes base-lane test-run records (pass/fail) from the worker-ledger and
 * classifies them into flaky candidates: tests that flip across runs at a fixed
 * sha, excluding red-on-branch and sha-correlated (deterministic) failures.
 */

import {
  type BaseGateTestRunRow,
  type TestQuarantineRow,
  listObservations,
  listTestObservations,
  listTestQuarantine,
  writeTestQuarantine,
  removeTestQuarantine as removeTestQuarantineDefault,
} from './worker-ledger';
import { listTodos, updateTodo as updateTodoDefault } from './todo-store';

export interface FlakyCandidate {
  test: string;
  quarantinedAtSha: string;
  evidence: { runs: number; passRuns: number; failRuns: number };
  ttlExpiresAt: number;
}

/** Default TTL for a quarantine record: 24 hours. */
export const DEFAULT_TTL_MS = 24 * 60 * 60_000;

/**
 * Classify flaky candidates from test-run observations. Pure: no I/O.
 *
 * Algorithm per distinct test:
 * 1. If ANY observation has scope==='branch', skip (veto for red-on-branch).
 * 2. Keep only scope==='base' observations; skip if NO passing row exists (covers "never passed").
 * 3. Group observations by baseSha. A sha qualifies iff:
 *    - run count >= minRuns (default 3)
 *    - has at least one passing AND one failing row
 * 4. If no sha qualifies, skip (sha-correlated failures fail the "has both" test).
 * 5. Emit the qualifying sha with the latest observedAt.
 */
export function classifyFlakyCandidates(
  observations: BaseGateTestRunRow[],
  now: number,
  opts?: { minRuns?: number; ttlMs?: number },
): FlakyCandidate[] {
  const minRuns = opts?.minRuns ?? 3;
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;

  const byTest = new Map<string, BaseGateTestRunRow[]>();
  for (const obs of observations) {
    if (!byTest.has(obs.test)) byTest.set(obs.test, []);
    byTest.get(obs.test)!.push(obs);
  }

  const candidates: FlakyCandidate[] = [];

  for (const [test, testObs] of byTest) {
    // 1. If ANY observation has scope==='branch', skip entirely.
    if (testObs.some((o) => o.scope === 'branch')) continue;

    // 2. Keep only base scope; if no passing row, skip.
    const baseObs = testObs.filter((o) => o.scope === 'base');
    if (!baseObs.some((o) => !o.failed)) continue;

    // 3. Group by baseSha and find qualifying shas.
    const bySha = new Map<string, BaseGateTestRunRow[]>();
    for (const obs of baseObs) {
      if (!bySha.has(obs.baseSha)) bySha.set(obs.baseSha, []);
      bySha.get(obs.baseSha)!.push(obs);
    }

    let qualifyingSha: string | null = null;
    let qualifyingLatestObservedAt = 0;

    for (const [sha, shaObs] of bySha) {
      const runCount = shaObs.length;
      const hasPass = shaObs.some((o) => !o.failed);
      const hasFail = shaObs.some((o) => o.failed);

      // Qualifies if run count meets threshold AND has both pass and fail.
      if (runCount >= minRuns && hasPass && hasFail) {
        const latestObservedAt = Math.max(...shaObs.map((o) => o.observedAt));
        if (latestObservedAt > qualifyingLatestObservedAt) {
          qualifyingSha = sha;
          qualifyingLatestObservedAt = latestObservedAt;
        }
      }
    }

    // 4-5. Emit the qualifying sha with evidence.
    if (qualifyingSha) {
      const shaObs = bySha.get(qualifyingSha)!;
      candidates.push({
        test,
        quarantinedAtSha: qualifyingSha,
        evidence: {
          runs: shaObs.length,
          passRuns: shaObs.filter((o) => !o.failed).length,
          failRuns: shaObs.filter((o) => o.failed).length,
        },
        ttlExpiresAt: now + ttlMs,
      });
    }
  }

  return candidates;
}

/** Filter quarantine records to only those whose TTL has not expired. Pure. */
export function filterActiveQuarantine(records: TestQuarantineRow[], now: number): TestQuarantineRow[] {
  return records.filter((r) => r.ttlExpiresAt > now);
}

/**
 * Return active (TTL-valid) quarantine records for a project.
 * Thin wrapper: calls listTestQuarantine and filters by expiry.
 */
export function activeQuarantine(project: string, now: number = Date.now()): TestQuarantineRow[] {
  return filterActiveQuarantine(listTestQuarantine(project), now);
}

/** Thin wrapper: write a quarantine record via the ledger. */
export function upsertQuarantine(r: Omit<TestQuarantineRow, 'createdAt'>, now: number = Date.now()): void {
  writeTestQuarantine(r, now);
}

/**
 * Seed manifest-declared baseline failures into the quarantine store as
 * `seededFrom:'manifest'` records. Idempotent AND non-renewing: an entry already
 * present in the store is left untouched, so re-seeding on every gate run can
 * never refresh a live record's TTL (which would defeat expiry entirely).
 */
export function seedManifestBaseline(
  project: string,
  entries: readonly string[],
  now: number = Date.now(),
  ttlMs: number = DEFAULT_TTL_MS,
): void {
  if (entries.length === 0) return;
  const existing = new Set(listTestQuarantine(project).map((r) => r.test));
  for (const entry of entries) {
    if (existing.has(entry)) continue;
    upsertQuarantine(
      {
        project,
        test: entry,
        quarantinedAtSha: 'manifest',
        evidence: { runs: 0, passRuns: 0, failRuns: 0 },
        ttlExpiresAt: now + ttlMs,
        seededFrom: 'manifest',
      },
      now,
    );
    existing.add(entry);
  }
}

type QuarantinePromotionHook = (c: FlakyCandidate & { project: string }) => void;
let promotionHook: QuarantinePromotionHook = () => {};

/** Set a callback to be invoked when a candidate is newly promoted to quarantine. */
export function setQuarantinePromotionHook(fn: QuarantinePromotionHook): void {
  promotionHook = fn;
}

/**
 * Close a quarantine record and mark its todo as done when all recent observations
 * for that test are passing (green-only window). Idempotent per test: if the todo
 * is already done/dropped, it remains unchanged. Best-effort: per-record errors are
 * caught and logged, never stopping the full loop.
 *
 * @param project Project identifier
 * @param now Current timestamp (injectable for testing)
 * @param deps Overrideable dependencies for testing
 */
export async function closeQuarantineOnGreen(
  project: string,
  now: number = Date.now(),
  deps?: {
    listTestQuarantine?: typeof listTestQuarantine;
    listObservations?: typeof listObservations;
    listTestObservations?: typeof listTestObservations;
    removeTestQuarantine?: typeof removeTestQuarantineDefault;
    listTodos?: typeof listTodos;
    updateTodo?: typeof updateTodoDefault;
  },
): Promise<void> {
  const listTestQuarantineFn = deps?.listTestQuarantine ?? listTestQuarantine;
  const listObservationsFn = deps?.listObservations ?? listObservations;
  const listTestObservationsFn = deps?.listTestObservations ?? listTestObservations;
  const removeTestQuarantineFn = deps?.removeTestQuarantine ?? removeTestQuarantineDefault;
  const listTodosFn = deps?.listTodos ?? listTodos;
  const updateTodoFn = deps?.updateTodo ?? updateTodoDefault;

  const records = listTestQuarantineFn(project);

  for (const r of records) {
    try {
      // ONE test's rows via idx_bgtr_project_test — NOT the whole project materialised and
      // filtered in JS. MEASURED 2026-08-11: 330 quarantine records x a ~1.8M-row project-wide
      // read each, after every gate, on the synchronous loop — health probes starved, watchdog
      // kills. The project-wide reader stays for callers that genuinely need every test.
      const testObs = deps?.listObservations
        ? listObservationsFn(project, r.createdAt).filter((o) => o.test === r.test)
        : listTestObservationsFn(project, r.test, r.createdAt);

      if (testObs.length > 0 && !testObs.some((o) => o.failed)) {
        removeTestQuarantineFn(project, r.test);

        const title = `[BUG] flaky test quarantined: ${r.test}`;
        const allTodos = listTodosFn(project, { includeCompleted: true });
        const todo = allTodos.find(
          (t) => t.title === title && t.status !== 'done' && t.status !== 'dropped',
        );

        if (todo) {
          await updateTodoFn(project, todo.id, { status: 'done' });
        }
      }
    } catch (err) {
      console.warn(
        `[flaky-quarantine] closeQuarantineOnGreen: ${project}: failed to process test "${r.test}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/**
 * Promote newly-flaky candidates to quarantine and refresh existing records.
 * Idempotent: calling this multiple times with the same observations produces
 * the same quarantine records. The hook is invoked only for tests that were NOT
 * already quarantined before this call.
 *
 * @param project Project identifier
 * @param now Current timestamp (injectable for testing)
 * @param opts.windowMs Observation window (default 7 days)
 * @returns All candidates (promoted or refreshed)
 */
/** More simultaneous candidates than this is a systemic red, never real flake. */
export const MASS_PROMOTION_CAP = 25;

export function promoteQuarantineCandidates(
  project: string,
  now: number = Date.now(),
  opts?: { windowMs?: number },
): FlakyCandidate[] {
  const windowMs = opts?.windowMs ?? 7 * 24 * 60 * 60_000;
  const sinceMs = now - windowMs;

  // Snapshot pre-promotion quarantine to detect newly-promoted tests.
  const preSnapshot = new Set(listTestQuarantine(project).map((r) => r.test));

  // Classify candidates from recent observations.
  const observations = listObservations(project, sinceMs);
  const candidates = classifyFlakyCandidates(observations, now);

  // A MASS of simultaneous "flaky" tests is not flake — it is one systemic red (a broken base,
  // a schema mismatch, a poisoned worktree) fanned out across the suite. Promoting it buries
  // the real cause under hundreds of quarantine rows and makes every later pass pay for them:
  // MEASURED 2026-08-11, a schema-error storm mass-promoted 330 tests and the quarantine pass
  // pinned the sidecar re-upserting them after every gate. Refuse loudly instead.
  if (candidates.length > MASS_PROMOTION_CAP) {
    console.warn(
      `[flaky-quarantine] REFUSING mass promotion for ${project}: ${candidates.length} simultaneous candidates ` +
      `(cap ${MASS_PROMOTION_CAP}) — this is a systemic red, not flake. Fix the base; no quarantine rows written.`,
    );
    return [];
  }

  // Upsert all candidates (idempotent) and hook only newly-promoted ones.
  for (const c of candidates) {
    upsertQuarantine(
      {
        project,
        test: c.test,
        quarantinedAtSha: c.quarantinedAtSha,
        evidence: c.evidence,
        ttlExpiresAt: c.ttlExpiresAt,
        seededFrom: null,
      },
      now,
    );
    if (!preSnapshot.has(c.test)) {
      promotionHook({ project, ...c });
    }
  }

  return candidates;
}
