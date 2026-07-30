/** Model-pin plan for the criterion verify panel.
 *
 *  Assigns each verification lens to one model from a pool, and validates that
 *  the assignments are distinct and distinct from the maker model. */

import { type VerifyLens } from './criterion-verify-panel.js';
import { normalizeModelId } from './spend-ledger.js';

export const PANEL_LENS_TIMEOUT_MS = 10 * 60_000; // 10 minutes per lens

/** Pin each verification lens to a model from the pool, cycling through the pool
 *  by lens position. The caller is responsible for providing a pool with ≥3 distinct
 *  members that are distinct from `makerModel` — this function does not validate
 *  those constraints. Use `assertDistinctPanel` BEFORE invoking the panel. */
export function planPanelModels(args: {
  makerModel: string;
  lensPool: string[];
  lenses: VerifyLens[];
}): Record<VerifyLens, string> {
  const plan: Record<VerifyLens, string> = {} as any;

  for (let i = 0; i < args.lenses.length; i++) {
    const lens = args.lenses[i];
    const modelIndex = i % args.lensPool.length;
    plan[lens] = args.lensPool[modelIndex];
  }

  return plan;
}

/** Validate that the panel plan is well-formed: every lens is pinned to a distinct
 *  model, and that model is distinct from the maker model. Throws with a descriptive
 *  error message naming the offending lens(es) if any invariant is violated. */
export function assertDistinctPanel(
  plan: Record<VerifyLens, string>,
  makerModel: string,
  lenses: VerifyLens[],
): void {
  const normalizedMaker = normalizeModelId(makerModel);
  const lensToNormal = new Map<VerifyLens, string>();
  const normalToLenses = new Map<string, VerifyLens[]>();

  for (const lens of lenses) {
    const pinModel = plan[lens];
    if (!pinModel || !pinModel.trim()) {
      throw new Error(
        `Panel lens "${lens}" is missing or blank in the plan`,
      );
    }

    const normalized = normalizeModelId(pinModel);
    if (!normalized) {
      throw new Error(
        `Panel lens "${lens}" has unrecognized model "${pinModel}"`,
      );
    }

    lensToNormal.set(lens, normalized);

    if (!normalToLenses.has(normalized)) {
      normalToLenses.set(normalized, []);
    }
    normalToLenses.get(normalized)!.push(lens);
  }

  // Check for duplicates: any model pinned to more than one lens
  for (const [normalized, lenses] of normalToLenses) {
    if (lenses.length > 1) {
      const model = normalized || '(unknown model)';
      throw new Error(
        `Panel model collision: lenses [${lenses.join(', ')}] all pin to the same model "${model}"`,
      );
    }

    // Check for collision with maker model
    const makerNorm = normalizedMaker || '(unknown maker)';
    if (normalized === normalizedMaker && normalized) {
      throw new Error(
        `Panel model collision: lens "${lenses[0]}" pins to maker model "${normalized}"`,
      );
    }
  }
}
