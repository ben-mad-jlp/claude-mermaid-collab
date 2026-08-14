/**
 * Classify friction notes as defects or success-signals.
 *
 * A 'success-signal' reason indicates a resolved/healthy outcome (e.g. a flake
 * that was deflaked), whereas a 'defect' indicates a problem that needs work.
 * This classification is data-driven and pure — no I/O, no LLM, no store dependencies.
 */

export type FrictionDefectClass = 'defect' | 'success-signal';

/**
 * Reasons that classify as success-signals: resolved/healthy outcomes rather than
 * defects that need work. MUST contain 'quarantine-deflaked'. Small, literal list —
 * no regex heuristics beyond reason normalization.
 */
export const SUCCESS_SIGNAL_REASONS: readonly string[] = [
  'quarantine-deflaked',
  'quarantine-expired',
  'quarantine-lifted',
  'base-repair-succeeded',
  'self-healed',
  'auto-recovered',
];

/**
 * Classify a friction reason as a defect or success-signal.
 *
 * Normalizes `retryReason` the same way computeFrictionSignature does
 * (lowercase, trim, collapse internal whitespace), then looks it up in
 * SUCCESS_SIGNAL_REASONS. Returns 'success-signal' iff the normalized reason
 * is in the set, else 'defect'.
 *
 * @param retryReason The retry reason string to classify.
 * @param detail Optional detail text (accepted for future refinement and
 *   signature-parity with computeFrictionSignature, but must not change
 *   today's result based on its value).
 * @returns 'success-signal' or 'defect'. Fails toward defect: a falsy/empty
 *   reason classifies as 'defect' (never silently reclassify unknown friction
 *   as healthy).
 */
export function classifyFrictionReason(
  retryReason: string,
  detail?: string | null,
): FrictionDefectClass {
  // Normalize the same way computeFrictionSignature does: lowercase, trim, collapse whitespace.
  const normalized = (retryReason || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

  // Empty reason always classifies as defect.
  if (!normalized) return 'defect';

  // Check if the normalized reason is in the success-signal set.
  return SUCCESS_SIGNAL_REASONS.includes(normalized) ? 'success-signal' : 'defect';
}
