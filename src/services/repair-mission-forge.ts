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
 * Build a repair mission spec from a batch of requests.
 *
 * Throws if batch is empty or null.
 *
 * - criteria[i] is the exact fixedMeans string from batch[i].spec
 * - consumesTodoIds[i] is batch[i].request.id
 * - budgetUsd is always REPAIR_BUDGET_USD
 * - title and description are synthesized prose
 */
export function buildRepairMissionSpec(batch: RepairBatchItem[]): RepairMissionSpec {
  if (!batch || batch.length === 0) {
    throw new Error('buildRepairMissionSpec: batch must not be empty');
  }

  const criteria = batch.map((item) => item.spec.fixedMeans);
  const consumesTodoIds = batch.map((item) => item.request.id);

  // Synthesize title and description.
  const title = `Auto-forge repair mission: ${batch.length} bugfix${batch.length === 1 ? '' : 'es'}`;

  // Description includes provenance: each request's observedFailure and evidence.
  const provenance = batch
    .map((item, idx) => {
      const num = idx + 1;
      return [
        `### Request ${num}: ${item.request.title || '(untitled)'}`,
        `- **Observed failure**: ${item.spec.observedFailure}`,
        `- **Evidence**: ${item.spec.evidence}`,
      ].join('\n');
    })
    .join('\n\n');

  const description = [
    `Auto-forged repair mission from ${batch.length} open bugfix request${batch.length === 1 ? '' : 's'}.`,
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
