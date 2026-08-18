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

/** Phase of chamber deliberation. */
export type ChamberPhase = 'propose' | 'veto' | 'wargame' | 'decide';

/** Outcome of chamber deliberation. */
export type ChamberOutcome = 'decision' | 'inaction';

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

/** A chamber transcript entry projected for bridge: role, model, and verbatim content. */
export interface BridgeChamberEntry {
  phase: ChamberPhase;
  role: string;
  model: string | null;
  content: string;
  createdAt: number;
}

/** Chamber deliberation outcome and transcript bucketed by phase. */
export interface BridgeChamberDeliberation {
  sessionId: string;
  outcome: ChamberOutcome;
  chosenCandidate: string | null;
  strongestDissent: string | null;
  refiningGuidance: string | null;
  decidedAtSha: string;
  decidedAt: number;
  proposals: BridgeChamberEntry[];
  vetoes: BridgeChamberEntry[];
  wargame: BridgeChamberEntry[];
  decision: BridgeChamberEntry[];
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

/** A campaign and its probes with optional ruling and chamber deliberation. */
export interface BridgeCampaign {
  id: string;
  title: string;
  goal: string | null;
  createdAt: number;
  /** Set when the campaign was dropped. Optional so snapshots from an older server
   *  (no field) still parse; missing means live. */
  droppedAt?: number | null;
  /** Count of missions linked to this campaign. Optional so snapshots from an older server
   *  (no field) still parse; missing means 0. */
  missionCount?: number;
  /** Count of leaves linked to this campaign. Optional so snapshots from an older server
   *  (no field) still parse; missing means 0. */
  leafCount?: number;
  probes: BridgeCampaignProbe[];
  ruling: BridgeCampaignRuling | null;
  /** Chamber deliberation transcript and outcome. Optional so snapshots from an older server
   *  (no field) still parse; missing means no deliberation. */
  chamber?: BridgeChamberDeliberation | null;
}
