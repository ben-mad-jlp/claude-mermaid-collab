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
import { quarantineDedupKey } from './quarantine-dedup';
import { resolveQuarantineTestFile } from './quarantine-test-file';
import { recordFrictionOnce } from './friction-store';

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

/** A quarantine row is renewed if it still classifies as flaky, or announced as expired. */
export interface QuarantineExpiryEvent {
  project: string;
  test: string;
  quarantinedAtSha: string;
  evidence: TestQuarantineRow['evidence'];
  ttlExpiresAt: number;
}

type QuarantineExpiryHook = (e: QuarantineExpiryEvent) => void | Promise<void>;
let expiryHook: QuarantineExpiryHook = () => {};

/** Set a callback to be invoked when a lapsing quarantine record expires without renewal. */
export function setQuarantineExpiryHook(fn: QuarantineExpiryHook): void {
  expiryHook = fn;
}

/** A row is lapsing once its TTL is within this window of `now` (or already past). */
export const QUARANTINE_RENEWAL_WINDOW_MS = 60 * 60_000;

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
export const MIN_GREEN_OBSERVATIONS_TO_CLOSE = 3;

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
    resolveTestFile?: (project: string, test: string) => string | null;
  },
): Promise<void> {
  const listTestQuarantineFn = deps?.listTestQuarantine ?? listTestQuarantine;
  const listObservationsFn = deps?.listObservations ?? listObservations;
  const listTestObservationsFn = deps?.listTestObservations ?? listTestObservations;
  const removeTestQuarantineFn = deps?.removeTestQuarantine ?? removeTestQuarantineDefault;
  const listTodosFn = deps?.listTodos ?? listTodos;
  const updateTodoFn = deps?.updateTodo ?? updateTodoDefault;
  const resolveTestFileFn = deps?.resolveTestFile ?? resolveQuarantineTestFile;

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

      // MIN_GREEN_OBSERVATIONS_TO_CLOSE: one lucky green must never un-quarantine an
      // INTERMITTENT flake — that is the only kind of test quarantine exists for.
      // MEASURED 2026-08-13: file-path rows seeded at 12:11 were closed by the first
      // green gate and the same files redded the next gate at 12:41, so quarantine
      // provided zero protection. Closing now requires a consistent green streak.
      if (testObs.length >= MIN_GREEN_OBSERVATIONS_TO_CLOSE && !testObs.some((o) => o.failed)) {
        removeTestQuarantineFn(project, r.test);

        const resolvedTestFile = resolveTestFileFn(project, r.test);
        const allTodos = listTodosFn(project, { includeCompleted: true });
        const todo = allTodos.find(
          (t) => {
            const candidateResolved = resolveTestFileFn(project, t.title.slice('[BUG] flaky test quarantined: '.length));
            return (
              quarantineDedupKey(t.title.slice('[BUG] flaky test quarantined: '.length), candidateResolved) === quarantineDedupKey(r.test, resolvedTestFile) &&
              t.status !== 'done' &&
              t.status !== 'dropped'
            );
          },
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

export interface DeflakeEvidence {
  runs: number;
  passRuns: number;
  failRuns: number;
  sha: string;
}

/** Deterministic friction detail string for a de-flake retirement, so recordFrictionOnce's
 *  SQL dedup (layer + retryReason + detail) actually dedupes repeated retirements of the
 *  same (test, evidence, sha) rather than writing a fresh note every time. */
export function deflakeFrictionDetail(test: string, e: DeflakeEvidence): string {
  return `quarantine-deflaked: ${test} | runs=${e.runs} pass=${e.passRuns} fail=${e.failRuns} | sha=${e.sha}`;
}

/**
 * Retire a quarantine record because fresh evidence shows it no longer flakes: the ONLY
 * sanctioned deliberate-retirement path (as opposed to a raw DELETE), so a de-flake is
 * observable — it removes the row AND records a deduplicated `quarantine-deflaked`
 * friction note carrying the measured evidence.
 *
 * @returns recordFrictionOnce's boolean: true iff a NEW friction note landed (false if an
 * identical note already exists, i.e. this retirement was already recorded).
 */
export async function retireQuarantineDeflaked(
  project: string,
  test: string,
  evidence: DeflakeEvidence,
  now: number = Date.now(),
  deps?: {
    removeTestQuarantine?: typeof removeTestQuarantineDefault;
    recordFrictionOnce?: typeof recordFrictionOnce;
  },
): Promise<boolean> {
  const removeTestQuarantineFn = deps?.removeTestQuarantine ?? removeTestQuarantineDefault;
  const recordFrictionOnceFn = deps?.recordFrictionOnce ?? recordFrictionOnce;

  removeTestQuarantineFn(project, test);

  return recordFrictionOnceFn(project, {
    layer: 'operational',
    retryReason: 'quarantine-deflaked',
    detail: deflakeFrictionDetail(test, evidence),
  });
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

/**
 * Renew-or-announce sweep over lapsing quarantine rows (TTL within
 * QUARANTINE_RENEWAL_WINDOW_MS of `now`, or already past). A row that still classifies as
 * flaky against fresh observations is renewed with re-measured evidence; a manifest-seeded
 * row is never renewed (its non-renewing contract, seedManifestBaseline); everything else,
 * once genuinely past its TTL, is announced via the expiry hook. The row itself is never
 * deleted — `activeQuarantine` already stops matching it once ttlExpiresAt passes.
 *
 * Best-effort per row: errors are caught and logged, never stopping the loop.
 */
export async function sweepExpiringQuarantine(
  project: string,
  now: number = Date.now(),
  deps?: {
    listTestQuarantine?: typeof listTestQuarantine;
    listTestObservations?: typeof listTestObservations;
    upsertQuarantine?: typeof upsertQuarantine;
    expiryHook?: QuarantineExpiryHook;
    renewalWindowMs?: number;
    ttlMs?: number;
  },
): Promise<void> {
  const listTestQuarantineFn = deps?.listTestQuarantine ?? listTestQuarantine;
  const listTestObservationsFn = deps?.listTestObservations ?? listTestObservations;
  const upsertQuarantineFn = deps?.upsertQuarantine ?? upsertQuarantine;
  const expiryHookFn = deps?.expiryHook ?? expiryHook;
  const renewalWindowMs = deps?.renewalWindowMs ?? QUARANTINE_RENEWAL_WINDOW_MS;
  const ttlMs = deps?.ttlMs ?? DEFAULT_TTL_MS;

  const records = listTestQuarantineFn(project);

  for (const r of records) {
    try {
      if (r.ttlExpiresAt > now + renewalWindowMs) continue; // not lapsing yet

      if (r.seededFrom !== 'manifest') {
        const obs = listTestObservationsFn(project, r.test, r.createdAt);
        const candidates = classifyFlakyCandidates(obs, now, { ttlMs });
        const c = candidates.find((cand) => cand.test === r.test);
        if (c) {
          upsertQuarantineFn(
            {
              project,
              test: r.test,
              quarantinedAtSha: c.quarantinedAtSha,
              evidence: c.evidence,
              ttlExpiresAt: c.ttlExpiresAt,
              seededFrom: r.seededFrom,
            },
            now,
          );
          continue;
        }
      }

      if (r.ttlExpiresAt <= now) {
        await expiryHookFn({
          project,
          test: r.test,
          quarantinedAtSha: r.quarantinedAtSha,
          evidence: r.evidence,
          ttlExpiresAt: r.ttlExpiresAt,
        });
      }
    } catch (err) {
      console.warn(
        `[flaky-quarantine] sweepExpiringQuarantine: ${project}: failed to process test "${r.test}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
