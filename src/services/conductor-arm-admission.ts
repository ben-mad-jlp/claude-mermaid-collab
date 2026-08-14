/**
 * conductor-arm-admission — pure key-building for per-arm admission past the debounce,
 * allowing a verify or land arm to run on its own schedule independent of a global signature
 * (e.g. when an unrelated mission advances the trunk, a parked verify arm should still run).
 * No store/db/git imports — runtime-dependency-free, purely pattern-matched over facts inputs.
 */

export interface VerifyAdmissionFacts {
  criteria: readonly {
    id: string;
    verifiedAt: number | null;
    verifiedAtSha: string | null;
    lastReopenSha: string | null;
  }[];
  rechecks: readonly {
    criterionId: string;
    landedSha: string | null;
    enqueuedAt: number;
  }[];
}

/** Build the durable verify arm admission key from criteria whose newest land sha postdates
 *  their verdict. A criterion admits when either its lastReopenSha postdates verifiedAtSha,
 *  or a recheck is enqueued after its verdict was recorded. Returns sorted id:sha pairs
 *  joined by comma; '' when nothing qualifies. */
export function buildVerifyAdmissionKey(facts: VerifyAdmissionFacts): string {
  const admitted: Array<{ id: string; sha: string }> = [];

  for (const c of facts.criteria) {
    // Check if lastReopenSha postdates verifiedAtSha: non-null and different
    if (c.lastReopenSha != null && c.lastReopenSha !== c.verifiedAtSha) {
      admitted.push({ id: c.id, sha: c.lastReopenSha });
      continue;
    }

    // Check if any recheck qualifies: enqueued after verdict or when no verdict exists
    for (const r of facts.rechecks) {
      if (r.criterionId !== c.id) continue;
      if (r.landedSha == null) continue;
      // Recheck qualifies when no prior verdict or verdict is older than the recheck
      if (c.verifiedAt == null || r.enqueuedAt > c.verifiedAt) {
        admitted.push({ id: c.id, sha: r.landedSha });
        break; // Use first qualifying recheck
      }
    }
  }

  if (admitted.length === 0) return '';

  // Sort by id for order-independence, then build the key
  admitted.sort((a, b) => a.id.localeCompare(b.id));
  return admitted.map((a) => `${a.id}:${a.sha}`).join(',');
}

export interface LandAdmissionFacts {
  landCardIds: readonly string[];
  armedCriterionIds: readonly string[];
}

/** Build the durable land arm admission key from open land-ready card ids and
 *  armed (ready to be served) criterion ids. Both are sorted and deduplicated.
 *  Returns ''; when both are empty. */
export function buildLandAdmissionKey(facts: LandAdmissionFacts): string {
  const cards = Array.from(new Set(facts.landCardIds)).sort();
  const armed = Array.from(new Set(facts.armedCriterionIds)).sort();

  if (cards.length === 0 && armed.length === 0) return '';

  const parts: string[] = [];
  if (cards.length > 0) parts.push(`cards:${cards.join(',')}`);
  if (armed.length > 0) parts.push(`armed:${armed.join(',')}`);

  return parts.join('|');
}

/** Predicate: the verify arm should run when the key differs from the stored watermark.
 *  Non-empty key and key !== watermark ⇒ the arm has new work to do. */
export function admitsVerifyArm(key: string, watermark: string | null): boolean {
  return key !== '' && key !== watermark;
}

/** Predicate: the land arm should run when the key differs from the stored watermark.
 *  Non-empty key and key !== watermark ⇒ the arm has new work to do. */
export function admitsLandArm(key: string, watermark: string | null): boolean {
  return key !== '' && key !== watermark;
}
