/**
 * Auto-filer for explore findings.
 *
 * When an explore leaf produces findings, this module converts them to deduplicated
 * bugfix work requests filed into the Inbox bucket. Each finding produces exactly one
 * todo (creating a new one or updating an existing dedup).
 *
 * Modelled on friction-recurrence-filer.ts:
 * - Injected deps for testing; real defaults from todo-store and bucket-registry.
 * - Fail-open: validation refusals are logged, not thrown; the caller's operation succeeds.
 */

import { createHash } from 'node:crypto';
import { validateBugfixFiling, type BugfixFilingInput } from './typed-filing-request.js';
import { type Finding } from './finding-store.js';
import { ensureBucket } from './bucket-registry.js';
import { findOpenTodoBySignature, createTodo, updateTodo, type CreateTodoInput } from './todo-store.js';
import { recordAutoAction, MAX_FINDINGS_PER_REPORT } from './auto-action-audit.js';

export interface ExploreFilingContext {
  leaf: { id: string };
  reportPath: string;
  report: string;
  findings: Finding[];
}

export interface ExploreFindingFilerDeps {
  ensureBucket?: (project: string, type: 'inbox' | 'bugfix') => Promise<string>;
  findOpenTodoBySignature?: (project: string, signature: string) => ReturnType<typeof findOpenTodoBySignature>;
  createTodo?: (project: string, input: CreateTodoInput) => Promise<Awaited<ReturnType<typeof createTodo>>>;
  updateTodo?: (project: string, id: string, patch: Parameters<typeof updateTodo>[2]) => Promise<Awaited<ReturnType<typeof updateTodo>>>;
  recordAutoAction?: (input: Parameters<typeof recordAutoAction>[0]) => void;
}

/**
 * Generate a stable signature for an explore finding.
 *
 * Returns `explore:${core}` where core is:
 * - failureIdentity.trim() if non-null and non-empty
 * - Otherwise, sha256 hash of normalized violatedClaim + sorted implicatedFiles, taking first 16 hex chars
 *
 * The `explore:` prefix keeps these signatures disjoint from bare 16-hex friction signatures.
 */
export function exploreFindingSignature(finding: Finding): string {
  if (finding.failureIdentity && finding.failureIdentity.trim()) {
    return `explore:${finding.failureIdentity.trim()}`;
  }

  // Normalize claim: lowercase, trim, collapse whitespace.
  const normalizedClaim = finding.violatedClaim
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

  // Sort files for stable ordering.
  const sortedFiles = [...finding.implicatedFiles].sort();

  // Hash claim + files.
  const hashInput = normalizedClaim + '\n' + sortedFiles.join('\n');
  const hash = createHash('sha256').update(hashInput).digest('hex');
  return `explore:${hash.slice(0, 16)}`;
}

/**
 * File explore findings as bugfix todos.
 *
 * Takes a context with a leaf, report path, report text, and array of findings.
 * Returns an array of result objects, one per finding, in input order.
 * Each result is { filed: 'created'|'updated'|'skipped', todoId?: string, refusal?: string }.
 *
 * Empty findings array returns [] immediately without any writes.
 * Validation refusals are logged and skipped, not thrown.
 */
export async function autoFileExploreFindings(
  project: string,
  ctx: ExploreFilingContext,
  deps: ExploreFindingFilerDeps = {},
): Promise<Array<{ filed: 'created' | 'updated' | 'skipped'; todoId?: string; refusal?: string }>> {
  const ensureBucketFn = deps.ensureBucket ?? ensureBucket;
  const findOpenFn = deps.findOpenTodoBySignature ?? findOpenTodoBySignature;
  const createTodoFn = deps.createTodo ?? createTodo;
  const updateTodoFn = deps.updateTodo ?? updateTodo;
  const recordAutoActionFn = deps.recordAutoAction ?? recordAutoAction;

  // Early exit: empty findings write nothing at all.
  if (!ctx.findings || ctx.findings.length === 0) {
    return [];
  }

  const results: Array<{ filed: 'created' | 'updated' | 'skipped'; todoId?: string; refusal?: string }> = [];
  let bucketId: string | null = null;

  const totalFindings = ctx.findings.length;
  const cappedFindings = ctx.findings.slice(0, MAX_FINDINGS_PER_REPORT);
  const overflowCount = totalFindings - MAX_FINDINGS_PER_REPORT;

  // Handle overflow.
  if (overflowCount > 0) {
    recordAutoActionFn({
      project,
      action: 'finding-filed',
      outcome: 'capped',
      reason: `per-report-cap: ${totalFindings} findings > MAX_FINDINGS_PER_REPORT ${MAX_FINDINGS_PER_REPORT}, filed ${MAX_FINDINGS_PER_REPORT}, dropped ${overflowCount}`,
      detail: { leafId: ctx.leaf.id, reportPath: ctx.reportPath },
    });

    // Push skipped entries for overflow findings.
    for (let i = MAX_FINDINGS_PER_REPORT; i < ctx.findings.length; i++) {
      results.push({ filed: 'skipped', refusal: 'per-report-cap' });
    }
  }

  for (const finding of cappedFindings) {
    const sig = exploreFindingSignature(finding);

    // Extract excerpt: first bullet line containing violatedClaim or reproPath (case-insensitive),
    // or fallback to constructed line.
    const excerptLineRegex = /^\s*[-*]\s+.*/gm;
    const bulletLines = ctx.report.match(excerptLineRegex) || [];
    const lowerClaim = finding.violatedClaim.toLowerCase().trim();
    const lowerReproPath = finding.reproPath.toLowerCase().trim();

    let excerpt: string | undefined;
    for (const line of bulletLines) {
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes(lowerClaim) || lowerLine.includes(lowerReproPath)) {
        excerpt = line.replace(/^\s*[-*]\s+/, '').trim();
        break;
      }
    }

    if (!excerpt) {
      excerpt = `${finding.violatedClaim} (repro: ${finding.reproPath})`;
    }

    // Build the bugfix filing input.
    // The observedFailure MUST contain a word from FAILURE_SHAPE_LEXICON.
    // We ensure this by including "FAILED".
    const observedFailure = `Explore finding: the oracle "${finding.violatedClaim}" FAILED — reproduced at ${finding.reproPath}`;

    // Evidence must contain a named anchor. Report path (in dotted form) satisfies hasNamedAnchor.
    const evidence = `${ctx.reportPath}; excerpt: "${excerpt}"`;

    // fixedMeans must contain a falsifiable predicate. We use "must" and "no longer".
    const fixedMeans = `Fixed means: ${finding.violatedClaim} must hold — ${finding.reproPath} no longer reproduces the violation.`;

    const filingInput: BugfixFilingInput = {
      observedFailure,
      evidence,
      fixedMeans,
    };

    // Validate the filing.
    const validation = validateBugfixFiling(filingInput);
    if (validation.refusal) {
      recordAutoActionFn({
        project,
        action: 'finding-filed',
        outcome: 'refused',
        reason: validation.refusal,
        detail: { leafId: ctx.leaf.id, reportPath: ctx.reportPath, signature: sig },
      });
      results.push({ filed: 'skipped', refusal: validation.refusal });
      continue;
    }

    // Lazy-initialize the bucket (once).
    if (bucketId === null) {
      bucketId = await ensureBucketFn(project, 'bugfix');
    }

    // Check for existing open todo.
    const existing = findOpenFn(project, sig);

    const title = `[bug] Explore finding: ${finding.violatedClaim.split('\n')[0]}`;

    // Description must literally contain the report path, excerpt, and fixed-means line.
    const description =
      `Auto-filed by explore-finding-filer.\n\n` +
      `${ctx.reportPath}\n\n` +
      `${excerpt}\n\n` +
      `${fixedMeans}\n\n` +
      `Filed 'planned' — a human approves it to 'ready' (planner-promotes-ready).`;

    if (existing === null) {
      // Create a new todo.
      const filed = await createTodoFn(project, {
        ownerSession: '__explore_finding_filer__',
        parentId: bucketId,
        title,
        description,
        status: 'planned',
        priority: 2,
        frictionSignature: sig,
      });
      recordAutoActionFn({
        project,
        action: 'finding-filed',
        outcome: 'performed',
        reason: `explore-finding ${sig} from ${ctx.reportPath}`,
        detail: { todoId: filed.id, filed: 'created', signature: sig, sourceLeafId: ctx.leaf.id },
      });
      results.push({ filed: 'created', todoId: filed.id });
    } else {
      // Update the existing todo.
      await updateTodoFn(project, existing.id, {
        title,
        description,
      });
      recordAutoActionFn({
        project,
        action: 'finding-filed',
        outcome: 'performed',
        reason: `explore-finding ${sig} from ${ctx.reportPath}`,
        detail: { todoId: existing.id, filed: 'updated', signature: sig, sourceLeafId: ctx.leaf.id },
      });
      results.push({ filed: 'updated', todoId: existing.id });
    }
  }

  return results;
}
