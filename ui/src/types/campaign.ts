/**
 * campaign.ts — Client-side mirror of server campaign types.
 *
 * Mirrors the four interfaces from src/services/campaign-snapshot.ts plus the
 * three union aliases from src/services/campaign-store.ts. Ensures type safety
 * between server and client snapshots.
 */

/** Closed union of probe environments ('worktree', 'rig'). */
export type ProbeEnvironment = 'worktree' | 'rig';

/** Closed union of campaign completion verdicts. */
export type CompletionVerdict = 'done' | 'not-done';

/** Round in a two-round lens deliberation: independent for round 1, deliberation for round 2. */
export type CompletionLensRound = 'independent' | 'deliberation';

/** Per-lens completion verdict from a two-round panel deliberation. */
export interface BridgeCampaignLens {
  lens: string;
  verdict: CompletionVerdict;
  reasoning: string | null;
  round: CompletionLensRound;
  changedVerdict: boolean;
}

/** Campaign completion ruling from the judge. */
export interface BridgeCampaignRuling {
  judge: string;
  verdict: CompletionVerdict;
  rationale: string | null;
  ruledAtSha: string;
  ruledAt: number;
  artifactsRead: string[];
  commandsRun: string[];
  citedLenses: string[];
  lenses: BridgeCampaignLens[];
}

/** A probe in a campaign with its last recorded evidence. */
export interface BridgeCampaignProbe {
  id: string;
  campaignId: string;
  kind: string;
  environment: ProbeEnvironment;
  dependsOn: string[];
  declaredPaths: string[];
  verdict: string;
  command: string | null;
  createdAt: number;
  lastEvidenceAt: number | null;
  lastEvidence: string | null;
  lastEvidenceEnvironment: ProbeEnvironment | null;
  lastEvidenceCommitSha: string | null;
}

/** A campaign and its probes with optional ruling. */
export interface BridgeCampaign {
  id: string;
  title: string;
  goal: string | null;
  createdAt: number;
  /** Set when the campaign was dropped. Optional so snapshots from an older server
   *  (no field) still parse; missing means live. */
  droppedAt?: number | null;
  probes: BridgeCampaignProbe[];
  ruling: BridgeCampaignRuling | null;
}
