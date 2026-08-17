/**
 * campaign-snapshot.ts — pure read aggregator for campaigns on the bridge snapshot.
 *
 * Exports four types and one function that derives campaign data from the campaign-store
 * readers into a bridge-friendly shape.
 */
import {
  listCampaigns,
  listProbes,
  listProbeVerdicts,
  latestCampaignCompletion,
  listCompletionLenses,
  type CampaignRow,
  type CampaignProbe,
  type ProbeEnvironment,
  type CompletionVerdict,
  type CompletionLensRound,
} from './campaign-store.js';

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
  probes: BridgeCampaignProbe[];
  ruling: BridgeCampaignRuling | null;
}

/**
 * List all campaigns for a project, enriched with probes and their latest evidence,
 * and optional completion ruling.
 *
 * No try/catch here — throwing store reads propagate to the snapshot's own degrade path.
 * Probes are ordered by createdAt, id as from listProbes.
 */
export function listCampaignsForSnapshot(project: string): BridgeCampaign[] {
  const campaigns = listCampaigns(project);

  return campaigns.map((campaign: CampaignRow) => {
    const probes = listProbes(project, campaign.id);

    const enrichedProbes: BridgeCampaignProbe[] = probes.map((probe: CampaignProbe) => {
      const verdicts = listProbeVerdicts(project, probe.id);

      // Find the newest verdict by max recordedAt. Empty array means all lastEvidence* are null.
      let lastEvidenceAt: number | null = null;
      let lastEvidence: string | null = null;
      let lastEvidenceEnvironment: ProbeEnvironment | null = null;
      let lastEvidenceCommitSha: string | null = null;

      if (verdicts.length > 0) {
        const newest = verdicts.reduce((max, curr) => (curr.recordedAt > max.recordedAt ? curr : max));
        lastEvidenceAt = newest.recordedAt;
        lastEvidence = newest.evidence;
        lastEvidenceEnvironment = newest.environment;
        lastEvidenceCommitSha = newest.commitSha;
      }

      return {
        id: probe.id,
        campaignId: probe.campaignId,
        kind: probe.kind,
        environment: probe.environment,
        dependsOn: probe.dependsOn,
        declaredPaths: probe.declaredPaths,
        verdict: probe.verdict,
        command: probe.command,
        createdAt: probe.createdAt,
        lastEvidenceAt,
        lastEvidence,
        lastEvidenceEnvironment,
        lastEvidenceCommitSha,
      };
    });

    // Get the latest completion record for this campaign, or null if unruled.
    const completion = latestCampaignCompletion(project, campaign.id);

    let ruling: BridgeCampaignRuling | null = null;
    if (completion) {
      const lenses = listCompletionLenses(project, completion.id);
      ruling = {
        judge: completion.judge,
        verdict: completion.verdict,
        rationale: completion.rationale,
        ruledAtSha: completion.ruledAtSha,
        ruledAt: completion.ruledAt,
        artifactsRead: completion.artifactsRead,
        commandsRun: completion.commandsRun,
        citedLenses: completion.citedLenses,
        lenses: lenses.map((lens) => ({
          lens: lens.lens,
          verdict: lens.verdict,
          reasoning: lens.reasoning,
          round: lens.round,
          changedVerdict: lens.changedVerdict,
        })),
      };
    }

    return {
      id: campaign.id,
      title: campaign.title,
      goal: campaign.goal,
      createdAt: campaign.createdAt,
      probes: enrichedProbes,
      ruling,
    };
  });
}
