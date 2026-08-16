import { type BugfixSpec, readBugfixSpec } from './bugfix-spec';

/** Synthetic ownerSession marking an auto-forged repair mission. */
export const REPAIR_FORGE_SESSION = '__auto_repair_forge__';

/** Predicate: node is an auto-forged repair mission. */
export function isAutoForgedRepairMission(node: { ownerSession?: string | null }): boolean {
  return node.ownerSession === REPAIR_FORGE_SESSION;
}

/** Batch size constant: minimum requests to trigger a repair batch. */
export const REPAIR_BATCH_K = 5;

/** Age trigger constant in milliseconds: 72 hours. */
export const REPAIR_AGE_MS = 72 * 60 * 60 * 1000;

/** Default mission budget in USD for auto-forged repair missions. */
export const REPAIR_BUDGET_USD = 25;

/** Minimal structural read of an open bugfix-bucket leaf. */
export interface RepairRequest {
  id: string;
  title?: string | null;
  description?: string | null;
  bugfixSpec?: BugfixSpec | null;
  createdAt: string;
}

/** A repair request paired with its resolved spec. */
export interface RepairBatchItem {
  request: RepairRequest;
  spec: BugfixSpec;
}

/** Options for selectRepairBatch. */
export interface SelectRepairBatchOpts {
  k?: number;
  ageMs?: number;
  now?: number;
}

/** Options for buildRepairMissionSpec. */
export interface RepairMissionSpec {
  title: string;
  description: string;
  criteria: string[];
  budgetUsd: number;
  consumesTodoIds: string[];
}

/**
 * Select a batch of open bugfix requests to forge into a repair mission.
 *
 * Returns a batch iff the number of requests with recoverable specs >= k
 * OR any eligible request is older than ageMs. Otherwise returns null.
 *
 * Requests without a recoverable spec (readBugfixSpec returns null) are excluded
 * entirely and do not count toward the batch.
 *
 * Results are sorted by createdAt ascending (with unparseable dates last),
 * ties broken by id ascending. Returns up to k items (not all eligible items).
 */
export function selectRepairBatch(
  requests: RepairRequest[],
  opts?: SelectRepairBatchOpts
): RepairBatchItem[] | null {
  const k = opts?.k ?? REPAIR_BATCH_K;
  const ageMs = opts?.ageMs ?? REPAIR_AGE_MS;
  const now = opts?.now ?? Date.now();

  // Map and filter: only requests with recoverable specs.
  const eligible: RepairBatchItem[] = [];
  for (const request of requests) {
    const spec = readBugfixSpec(request);
    if (spec !== null) {
      eligible.push({ request, spec });
    }
  }

  // Empty set never forges.
  if (eligible.length === 0) return null;

  // Stable sort: by createdAt ascending, then by id ascending.
  // Unparseable dates are treated as Infinity (sort to the end).
  eligible.sort((a, b) => {
    const aTime = Date.parse(a.request.createdAt);
    const bTime = Date.parse(b.request.createdAt);
    const aTimeSafe = isNaN(aTime) ? Infinity : aTime;
    const bTimeSafe = isNaN(bTime) ? Infinity : bTime;

    if (aTimeSafe !== bTimeSafe) {
      return aTimeSafe - bTimeSafe;
    }
    return a.request.id.localeCompare(b.request.id);
  });

  // Trigger: count >= k OR any item older than ageMs.
  const triggered =
    eligible.length >= k ||
    eligible.some((item) => {
      const time = Date.parse(item.request.createdAt);
      if (isNaN(time)) return false;
      return now - time > ageMs;
    });

  if (!triggered) return null;

  // Return up to k items.
  return eligible.slice(0, k);
}

/**
 * Determine which trigger (size or age) caused selectRepairBatch to succeed.
 *
 * Returns 'size' if eligible.length >= k, 'age' if an eligible item is older
 * than ageMs, or null if neither. Size is checked first and wins when both
 * predicates hold. NaN dates never satisfy the age predicate.
 *
 * Reproduces the same eligibility filter and predicate order as selectRepairBatch
 * for the purpose of naming the trigger on approval cards and audit records.
 */
export function repairBatchTrigger(
  requests: RepairRequest[],
  opts: { k: number; ageMs: number; now: number },
): 'size' | 'age' | null {
  const k = opts.k;
  const ageMs = opts.ageMs;
  const now = opts.now;

  // Map and filter: only requests with recoverable specs (mirrors selectRepairBatch :73-78).
  const eligible: RepairBatchItem[] = [];
  for (const request of requests) {
    const spec = readBugfixSpec(request);
    if (spec !== null) {
      eligible.push({ request, spec });
    }
  }

  // Empty set never forges (mirrors :81).
  if (eligible.length === 0) return null;

  // Stable sort: by createdAt ascending, then by id ascending (mirrors :85-95).
  eligible.sort((a, b) => {
    const aTime = Date.parse(a.request.createdAt);
    const bTime = Date.parse(b.request.createdAt);
    const aTimeSafe = isNaN(aTime) ? Infinity : aTime;
    const bTimeSafe = isNaN(bTime) ? Infinity : bTime;

    if (aTimeSafe !== bTimeSafe) {
      return aTimeSafe - bTimeSafe;
    }
    return a.request.id.localeCompare(b.request.id);
  });

  // Size wins when both predicates hold (mirrors :98-106).
  if (eligible.length >= k) {
    return 'size';
  }

  // Age trigger: any item older than ageMs (mirrors :100-104).
  if (
    eligible.some((item) => {
      const time = Date.parse(item.request.createdAt);
      if (isNaN(time)) return false;
      return now - time > ageMs;
    })
  ) {
    return 'age';
  }

  return null;
}

/**
 * Build a repair mission spec from a batch of requests.
 *
 * Throws if batch is empty or null, or if no batch item produces a non-empty criterion.
 *
 * - criteria[i] and consumesTodoIds[i] describe the same item from the paired list
 *   (pairs where item.spec.fixedMeans trims to a non-empty string)
 * - criteria[i] is the trimmed fixedMeans string (byte-identical to what forgeMission will store)
 * - consumesTodoIds[i] is the request.id from the paired item
 * - budgetUsd is always REPAIR_BUDGET_USD
 * - title, description, and provenance are synthesized from the paired list
 */
export function buildRepairMissionSpec(batch: RepairBatchItem[]): RepairMissionSpec {
  if (!batch || batch.length === 0) {
    throw new Error('buildRepairMissionSpec: batch must not be empty');
  }

  // Build a single paired list: keep only items whose fixedMeans trims to non-empty.
  // This predicate matches mission-forge.ts:145 (`trim().filter(Boolean)`).
  const paired: Array<{ item: RepairBatchItem; criterionText: string }> = [];
  for (const item of batch) {
    const criterionText = item.spec.fixedMeans.trim();
    if (criterionText) {
      paired.push({ item, criterionText });
    }
  }

  if (paired.length === 0) {
    throw new Error('buildRepairMissionSpec: no batch item produced a criterion');
  }

  // Derive both arrays from the single paired list.
  const criteria = paired.map((p) => p.criterionText);
  const consumesTodoIds = paired.map((p) => p.item.request.id);

  // Synthesize title and description from the paired list.
  const title = `Auto-forge repair mission: ${criteria.length} bugfix${criteria.length === 1 ? '' : 'es'}`;

  // Description includes provenance: each paired request's observedFailure and evidence.
  const provenance = paired
    .map((p, idx) => {
      const num = idx + 1;
      return [
        `### Request ${num}: ${p.item.request.title || '(untitled)'}`,
        `- **Observed failure**: ${p.item.spec.observedFailure}`,
        `- **Evidence**: ${p.item.spec.evidence}`,
      ].join('\n');
    })
    .join('\n\n');

  const description = [
    `Auto-forged repair mission from ${criteria.length} open bugfix request${criteria.length === 1 ? '' : 's'}.`,
    '',
    '## Provenance',
    '',
    provenance,
  ].join('\n');

  return {
    title,
    description,
    criteria,
    budgetUsd: REPAIR_BUDGET_USD,
    consumesTodoIds,
  };
}
