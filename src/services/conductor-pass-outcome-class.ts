import type { ConductorPassReason } from './supervisor-store.js';

export const CONDUCTOR_PASS_OUTCOME_CLASS = {
  'conductor-disabled': 'quiet',
  'daemon-off': 'quiet',
  'no-actionable-mission': 'quiet',
  'target-not-actionable': 'quiet',
  'target-cleared': 'quiet',
  'building-wait': 'quiet',
  'criteria-escalated': 'stuck',
  'debounced': 'quiet',
  'conducted': 'quiet',
  'node-failed': 'stuck',
  'criteria-blocked': 'quiet',
  'pass-ran': 'quiet',
  'pass-error': 'stuck',
  'infra-leaf-reset': 'quiet',
  'redecomposed': 'quiet',
  'over-budget-rebet': 'stuck',
  'verify-paneled': 'quiet',
  'card-triaged': 'quiet',
  'landed': 'quiet',
  'conductor-timeouts-capped': 'stuck',
  'conductor-empty-conducts-capped': 'stuck',
  'awaiting-observation-wait': 'quiet',
  'held': 'stuck',
} satisfies Record<ConductorPassReason, 'quiet' | 'stuck'>;

export function classifyConductorPassOutcome(
  reason: string,
  opts?: { actionableArm?: boolean },
): 'quiet' | 'stuck' {
  if (reason === 'debounced' && opts?.actionableArm === true) {
    return 'stuck';
  }

  if (Object.prototype.hasOwnProperty.call(CONDUCTOR_PASS_OUTCOME_CLASS, reason)) {
    return CONDUCTOR_PASS_OUTCOME_CLASS[reason as ConductorPassReason];
  }

  return 'stuck';
}
