/**
 * campaign-completion.ts — derive campaign completion status.
 *
 * Pure, no I/O — the caller does the reads and passes the inputs.
 *
 * A campaign is "done" only when a judge has issued a recorded completion verdict
 * with verdict='done'. An empty front (all probes passing) is NOT sufficient — the
 * judge's explicit ruling is required.
 */

import type { CampaignProbe, CampaignCompletionRecord } from './campaign-store';

export interface CampaignCompletion {
  done: boolean;
  verdict: CampaignCompletionRecord | null;
}

/**
 * Derive a campaign's completion status from its probes and the latest completion verdict.
 * A campaign is done only when a judge has issued a recorded completion verdict with
 * verdict='done'; an empty front alone is never sufficient.
 */
export function deriveCampaignCompletion(input: {
  probes: CampaignProbe[];
  verdict: CampaignCompletionRecord | null;
}): CampaignCompletion {
  const done = input.verdict !== null && input.verdict.verdict === 'done';
  return { done, verdict: input.verdict };
}
