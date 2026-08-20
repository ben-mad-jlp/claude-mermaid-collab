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
  listLinkedMissionIds,
  latestCampaignCompletion,
  listCompletionLenses,
  listChamberDecisions,
  listChamberTranscript,
  type CampaignRow,
  type CampaignProbe,
  type ProbeEnvironment,
  type CompletionVerdict,
  type CompletionLensRound,
  type ChamberPhase,
  type ChamberOutcome,
  type ChamberDecisionRecord,
} from './campaign-store.js';
import { CHAMBER_ROSTER, type ChamberRosterEntry } from './chamber-constitution.js';
import { listTodos, type Todo } from './todo-store.js';
import { isLeaf, isEpic } from './todo-kind.js';

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
  /** Set when the campaign was dropped (drop_campaign). The UI must be able to distinguish
   *  a retired campaign from a live one — no pass runs for a dropped campaign. */
  droppedAt: number | null;
  probes: BridgeCampaignProbe[];
  ruling: BridgeCampaignRuling | null;
  chamber: BridgeChamberDeliberation | null;
  /** Every chamber deliberation for this campaign, oldest→newest. `chamber` is its last element. */
  chamberHistory: BridgeChamberDeliberation[];
  /** The missions linked to this campaign via probe claims, with their display nicknames. */
  linkedMissions: Array<{ id: string; nickname: string | null }>;
  /** Number of missions linked to this campaign via probe claims. */
  missionCount: number;
  /** Number of leaf todos whose parent chain reaches a linked mission. */
  leafCount: number;
  /** Roster of chamber members (generals and president) with their agenda descriptions. */
  chamberRoster: ChamberRosterEntry[];
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

  // Read todos once (lazily, if there are campaigns) for parent-chain walking.
  let todoMap: Map<string, Todo> | null = null;
  if (campaigns.length > 0) {
    const todos = listTodos(project, { includeCompleted: true });
    todoMap = new Map(todos.map((t) => [t.id, t]));
  }

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

    // Get all chamber decisions for this campaign and project them oldest→newest.
    const decisions = listChamberDecisions(project, campaign.id);
    const chamberHistory = decisions.map((d) => projectChamberDeliberation(project, campaign.id, d));
    const chamber = chamberHistory.length > 0 ? chamberHistory[chamberHistory.length - 1] : null;

    // Count missions and leaves linked to this campaign.
    const linkedMissionIds = listLinkedMissionIds(project, campaign.id);
    const missionCount = linkedMissionIds.length;

    let leafCount = 0;
    if (linkedMissionIds.length > 0 && todoMap) {
      // Count leaves whose parent chain reaches a linked mission.
      const linkedMissionSet = new Set(linkedMissionIds);
      leafCount = countLeavesByMissionReach(todoMap, linkedMissionSet);
    }

    // Project linkedMissionIds through todoMap to include nicknames, skipping missing todos.
    let linkedMissions: Array<{ id: string; nickname: string | null }> = [];
    if (todoMap !== null) {
      linkedMissions = linkedMissionIds
        .map((id) => {
          const todo = todoMap.get(id);
          if (!todo) return null;
          return { id: todo.id, nickname: todo.nickname ?? null };
        })
        .filter((item) => item !== null) as Array<{ id: string; nickname: string | null }>;
    }

    return {
      id: campaign.id,
      title: campaign.title,
      goal: campaign.goal,
      createdAt: campaign.createdAt,
      droppedAt: campaign.droppedAt ?? null,
      probes: enrichedProbes,
      ruling,
      chamber,
      chamberHistory,
      linkedMissions,
      missionCount,
      leafCount,
      chamberRoster: [...CHAMBER_ROSTER],
    };
  });
}

/**
 * Project a single chamber decision and its session transcript into a BridgeChamberDeliberation.
 * Reads the transcript for this decision's sessionId only, buckets it by phase, and returns
 * the structured deliberation. Called once per decision in the decision list.
 */
function projectChamberDeliberation(
  project: string,
  campaignId: string,
  decision: ChamberDecisionRecord,
): BridgeChamberDeliberation {
  const transcript = listChamberTranscript(project, campaignId, decision.sessionId);

  // Bucket transcript rows by phase, preserving store order within each bucket.
  const proposals: BridgeChamberEntry[] = [];
  const vetoes: BridgeChamberEntry[] = [];
  const wargame: BridgeChamberEntry[] = [];
  const decisionEntries: BridgeChamberEntry[] = [];

  for (const row of transcript) {
    const entry: BridgeChamberEntry = {
      phase: row.phase,
      role: row.role,
      model: row.model,
      content: row.content,
      createdAt: row.createdAt,
    };

    switch (row.phase) {
      case 'propose':
        proposals.push(entry);
        break;
      case 'veto':
        vetoes.push(entry);
        break;
      case 'wargame':
        wargame.push(entry);
        break;
      case 'decide':
        decisionEntries.push(entry);
        break;
    }
  }

  return {
    sessionId: decision.sessionId,
    outcome: decision.outcome,
    chosenCandidate: decision.chosenCandidate,
    strongestDissent: decision.strongestDissent,
    refiningGuidance: decision.refiningGuidance,
    decidedAtSha: decision.decidedAtSha,
    decidedAt: decision.createdAt,
    proposals,
    vetoes,
    wargame,
    decision: decisionEntries,
  };
}

/**
 * Count leaf todos whose parent chain reaches one of the linked mission ids.
 * Walks upward from each leaf with a depth cap to prevent infinite loops.
 */
function countLeavesByMissionReach(todoMap: Map<string, Todo>, linkedMissions: Set<string>): number {
  let count = 0;
  const MAX_DEPTH = 100; // Prevent infinite loops on corrupt parent cycles.

  for (const todo of todoMap.values()) {
    if (isLeaf(todo)) {
      // Walk parent chain from this leaf.
      let current: Todo | undefined = todo;
      let depth = 0;
      const visited = new Set<string>();

      while (current && depth < MAX_DEPTH) {
        // Check if we've reached a linked mission.
        if (linkedMissions.has(current.id)) {
          count++;
          break;
        }

        // Move to parent.
        if (!current.parentId || visited.has(current.parentId)) {
          // No parent or cycle detected, stop.
          break;
        }

        visited.add(current.id);
        current = todoMap.get(current.parentId);
        depth++;
      }
    }
  }

  return count;
}
