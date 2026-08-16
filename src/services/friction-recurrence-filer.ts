/**
 * Bounded auto-filer for recurring friction signals.
 *
 * When the same friction signature recurs K times within a window,
 * file exactly ONE deduplicated bugfix work request carrying all occurrence ids.
 *
 * Modelled on friction-triage.ts:
 * - Threshold + config override via getConfig('FRICTION_RECURRENCE_K', ...).
 * - Fail-open: validation refusals are logged, not thrown; the caller's operation succeeds.
 * - Injected deps for testing; real defaults from todo-store and bucket-registry.
 */

import { validateBugfixFiling, type BugfixFilingInput } from './typed-filing-request.js';
import { type FrictionNote } from './friction-store.js';
import { getConfig } from './config-service.js';
import { ensureBucket } from './bucket-registry.js';
import { findOpenTodoBySignature, createTodo, updateTodo, type CreateTodoInput } from './todo-store.js';
import type { BugfixSpec } from './bugfix-spec.js';

export const RECURRENCE_FILE_THRESHOLD = 3;

export interface RecurrenceFilingContext {
  signature: string;
  priorCount: number;
  priorNoteIds: string[];
  note: FrictionNote;
}

export interface RecurrenceFilerDeps {
  threshold?: number;
  ensureBucket?: (project: string, type: 'inbox' | 'bugfix') => Promise<string>;
  findOpenTodoBySignature?: (project: string, signature: string) => ReturnType<typeof findOpenTodoBySignature>;
  createTodo?: (project: string, input: CreateTodoInput) => Promise<Awaited<ReturnType<typeof createTodo>>>;
  updateTodo?: (project: string, id: string, patch: Parameters<typeof updateTodo>[2]) => Promise<Awaited<ReturnType<typeof updateTodo>>>;
}

/**
 * File a recurring friction as a bugfix todo when it reaches the K-gate threshold.
 * Returns the filing result: 'created' (new), 'updated' (existing dedup), or 'skipped' (below K or validation failed).
 * Never throws; validation failures are logged and skipped.
 */
export async function autoFileRecurringFriction(
  project: string,
  ctx: RecurrenceFilingContext,
  deps: RecurrenceFilerDeps = {},
): Promise<{ filed: 'created' | 'updated' | 'skipped'; todoId?: string; refusal?: string }> {
  const threshold = deps.threshold ?? (Number(getConfig('FRICTION_RECURRENCE_K', '') || 0) || RECURRENCE_FILE_THRESHOLD);
  const ensureBucketFn = deps.ensureBucket ?? ensureBucket;
  const findOpenFn = deps.findOpenTodoBySignature ?? findOpenTodoBySignature;
  const createTodoFn = deps.createTodo ?? createTodo;
  const updateTodoFn = deps.updateTodo ?? updateTodo;

  // The occurrence count INCLUDING the note just written.
  const count = ctx.priorCount + 1;

  // Gate: skip if no signature or count < K.
  if (!ctx.signature || count < threshold) {
    return { filed: 'skipped' };
  }

  const allNoteIds = [...ctx.priorNoteIds, ctx.note.id];
  const notesLine = allNoteIds.join(', ');

  // Build and validate the bugfix filing input.
  const title = `[bug] Recurring friction: ${ctx.note.retryReason} (${ctx.note.layer}, ×${count})`;
  const description =
    `Auto-filed by friction-recurrence-filer.\n\n` +
    `Layer: ${ctx.note.layer}\n` +
    `Reason: ${ctx.note.retryReason}\n` +
    `Occurrences: ${count}\n\n` +
    `Notes: ${notesLine}\n\n` +
    `Evidence: this signature recurred ${count} time(s) in the friction store. ` +
    `Run \`list_friction\` for the underlying notes.\n\n` +
    `Filed 'planned' — a human approves it to 'ready' (planner-promotes-ready).`;

  const filingInput: BugfixFilingInput = {
    observedFailure: `Recurring failed attempt: retryReason "${ctx.note.retryReason}" (${ctx.note.layer}) recurred ×${count}`,
    evidence: `Friction note ids: ${notesLine}; src/services/friction-recurrence-filer.ts:1`,
    fixedMeans: `Fixed means: this signature must no longer recur — record_friction with retryReason "${ctx.note.retryReason}" never reaches ×${threshold} again.`,
  };

  const validation = validateBugfixFiling(filingInput);
  if (validation.refusal) {
    console.warn('[friction-recurrence-filer] validation failed:', validation.refusal);
    return { filed: 'skipped', refusal: validation.refusal };
  }

  // Ensure the bugfix bucket exists.
  const epicId = await ensureBucketFn(project, 'bugfix');

  // Check for existing open todo with this signature.
  const existing = findOpenFn(project, ctx.signature);

  if (existing === null) {
    // Create a new todo.
    const priority: 1 | 2 = count >= threshold * 2 ? 1 : 2;
    const bugfixSpec: BugfixSpec = {
      observedFailure: filingInput.observedFailure,
      evidence: filingInput.evidence,
      fixedMeans: filingInput.fixedMeans,
    };
    const filed = await createTodoFn(project, {
      ownerSession: '__friction_recurrence_filer__',
      parentId: epicId,
      title,
      description,
      status: 'planned',
      priority,
      triageTag: ctx.note.layer,
      frictionSignature: ctx.signature,
      bugfixSpec,
    });
    return { filed: 'created', todoId: filed.id };
  } else {
    // Update the existing todo with refreshed count and note ids.
    await updateTodoFn(project, existing.id, {
      title,
      description,
    });
    return { filed: 'updated', todoId: existing.id };
  }
}
