/**
 * Post-land test sweep: detect newly-failing tests after an epic lands.
 *
 * Compares the baseline of known-failing tests against a fresh suite run,
 * files bugfix todos for any net-new failures, and deduplicates recurring
 * failures via frictionSignature.
 *
 * All deps are injectable; live defaults read the baseline from scripts/backend-test-baseline.json
 * and run the suite via `bun run scripts/test-backend.ts`. Fail-open: all errors resolve to
 * { filed: [], skipped: [], error? } rather than rejecting.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractFailingTests } from './gate-runner.js';
import type { BaselineV2, LegacyBaseline } from '../../scripts/test-backend.js';
import { validateBugfixFiling, type BugfixFilingInput } from './typed-filing-request.js';
import { ensureBucket } from './bucket-registry.js';
import { findOpenTodoBySignature, createTodo, type CreateTodoInput } from './todo-store.js';
import type { BugfixSpec } from './bugfix-spec.js';
import { recordSupervisorAudit } from './supervisor-store.js';

/** Pure diff: return newly-failing test names (not in baseline), order-stable, de-duplicated. */
export function newlyFailingNames(baselineNames: string[], postLandNames: string[]): string[] {
  const baselineSet = new Set(baselineNames);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const name of postLandNames) {
    if (!baselineSet.has(name) && !seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }

  return result;
}

/** Stable signature for deduplicating post-land sweep filings. */
export function postLandSweepSignature(testName: string): string {
  return `post-land-sweep:${testName}`;
}

/** Injectable deps for post-land test sweep. All optional with live defaults. */
export interface PostLandSweepDeps {
  /** Read baseline failing test names. Live default: parse scripts/backend-test-baseline.json */
  readBaselineNames?: () => string[];
  /** Run the test suite and extract failing test names. Live default: spawn bun run scripts/test-backend.ts */
  runSuiteFailingNames?: (targetProject: string) => Promise<string[]>;
  /** Reuse todo-store functions. */
  ensureBucket?: (project: string, bucketType: 'inbox' | 'bugfix') => Promise<string>;
  findOpenTodoBySignature?: (project: string, signature: string) => ReturnType<typeof findOpenTodoBySignature>;
  createTodo?: (project: string, input: CreateTodoInput) => Promise<Awaited<ReturnType<typeof createTodo>>>;
}

/** Live default: read and parse scripts/backend-test-baseline.json */
function readBaselineNamesLive(): string[] {
  try {
    const baselineRoot = join(import.meta.dir, '../../..');
    const baselineFile = join(baselineRoot, 'scripts/backend-test-baseline.json');
    const content = readFileSync(baselineFile, 'utf-8');
    const baseline = JSON.parse(content) as BaselineV2 | LegacyBaseline;

    // V2 schema: discriminate by checking for 'schema' field
    if ('schema' in baseline && baseline.schema === 2) {
      const v2 = baseline as BaselineV2;
      return v2.files.flatMap((f) => f.failingTests);
    }

    // Legacy: no schema field, just { failing: string[] }
    return [];
  } catch {
    return [];
  }
}

/** Live default: run bun run scripts/test-backend.ts and extract failing test names */
async function runSuiteFailingNamesLive(targetProject: string): Promise<string[]> {
  try {
    const { execSync } = await import('node:child_process');
    const output = execSync('bun run scripts/test-backend.ts', {
      cwd: targetProject,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return extractFailingTests(output);
  } catch (e) {
    // Exit code non-zero is normal for a red suite; capture stderr too
    const output = (e as any)?.stderr ?? (e as any)?.stdout ?? '';
    return extractFailingTests(String(output));
  }
}

/**
 * Run the post-land test sweep: compare baseline against a fresh suite run,
 * file bugfix todos for net-new failures, and debounce via signature.
 *
 * Returns { filed: names, skipped: names, error?: string }.
 * Never rejects; all errors are caught and returned as the error field.
 */
export async function runPostLandTestSweep(
  project: string,
  ctx: { epicId: string; landSha: string; targetProject?: string },
  deps: PostLandSweepDeps = {},
): Promise<{ filed: string[]; skipped: string[]; error?: string }> {
  try {
    const readBaselineNames = deps.readBaselineNames ?? readBaselineNamesLive;
    const runSuiteFailingNames = deps.runSuiteFailingNames ?? runSuiteFailingNamesLive;
    const ensureBucketFn = deps.ensureBucket ?? ensureBucket;
    const findOpenFn = deps.findOpenTodoBySignature ?? findOpenTodoBySignature;
    const createTodoFn = deps.createTodo ?? createTodo;

    const baseline = readBaselineNames();
    const post = await runSuiteFailingNames(ctx.targetProject ?? project);
    const fresh = newlyFailingNames(baseline, post);

    // No new failures: skip bucket/todo creation.
    if (fresh.length === 0) {
      return { filed: [], skipped: [] };
    }

    // Ensure the bugfix bucket exists.
    const bucketId = await ensureBucketFn(project, 'bugfix');
    const filed: string[] = [];
    const skipped: string[] = [];

    const stamp = `epicId=${ctx.epicId} landSha=${ctx.landSha}`;

    for (const name of fresh) {
      const sig = postLandSweepSignature(name);

      // Check debounce: existing open todo with this signature.
      const existing = findOpenFn(project, sig);
      if (existing !== null) {
        skipped.push(name);
        continue;
      }

      // Build filing input with stamp embedded in every field.
      const filingInput: BugfixFilingInput = {
        observedFailure: `Test "${name}" is newly FAILING after landing (${stamp})`,
        evidence: `src/services/post-land-test-sweep.ts:1 ${stamp}`,
        fixedMeans: `Fixed means: "${name}" must pass again; the post-land sweep must never re-file it.`,
      };

      // Validate filing.
      const validation = validateBugfixFiling(filingInput);
      if (validation.refusal) {
        console.warn('[post-land-test-sweep] validation failed for', name, ':', validation.refusal);
        skipped.push(name);
        continue;
      }

      // Create the bugfix todo.
      const title = `Post-land test failure: ${name}`;
      const description =
        `Test "${name}" is newly failing after landing epic ${ctx.epicId}.\n\n` +
        `Land SHA: ${ctx.landSha}\n` +
        `${stamp}\n\n` +
        `Failure: ${filingInput.observedFailure}\n\n` +
        `Evidence: ${filingInput.evidence}\n\n` +
        `Fixed means: ${filingInput.fixedMeans}`;

      const bugfixSpec: BugfixSpec = {
        observedFailure: filingInput.observedFailure,
        evidence: filingInput.evidence,
        fixedMeans: filingInput.fixedMeans,
      };

      await createTodoFn(project, {
        ownerSession: '__post_land_test_sweep__',
        parentId: bucketId,
        title,
        description,
        status: 'planned',
        priority: 2,
        frictionSignature: sig,
        bugfixSpec,
      });

      filed.push(name);
    }

    return { filed, skipped };
  } catch (e) {
    // Fail-open: record the error and return it without rejecting.
    try {
      recordSupervisorAudit({
        kind: 'post-land-sweep-error',
        project,
        session: '__post_land_test_sweep__',
        detail: String(e),
      });
    } catch {
      // Ignore a throwing audit record.
    }
    return { filed: [], skipped: [], error: String((e as Error)?.message ?? e) };
  }
}
