// Pure derivation of System-Map nodes (Phase 6) from the live stores. Kept
// separate from the React panel so it's unit-testable. Today's hierarchy is
// Supervisor → Workers (supervised sessions); Planner/Coordinator role nodes
// slot in here once the coordinator surfaces them. Status precedence: an open
// escalation wins, else the session's live status, else unknown.

import type { SystemNode, SystemNodeStatus } from './systemToMermaid';

export interface DeriveInput {
  config: { supervisorProject?: string; supervisorSession?: string } | null;
  supervised: Array<{ project: string; session: string; serverId?: string }>;
  subscriptions: Array<{ project: string; session: string; status?: string; contextPercent?: number; lastUpdate?: number }>;
  escalations: Array<{ project: string; session: string; status: string }>;
  /** Restrict to one project (the active scope). Omit for all. */
  project?: string;
}

/** Map a subscription status string to a SystemNode status. */
export function mapStatus(status?: string): SystemNodeStatus {
  switch (status) {
    case 'active': return 'running';
    case 'waiting': return 'waiting';
    case 'permission': return 'permission';
    default: return 'unknown';
  }
}

export function deriveSystemNodes(input: DeriveInput): SystemNode[] {
  const { config, supervised, subscriptions, escalations, project } = input;
  const inScope = (p: string) => project === undefined || p === project;

  const subFor = (p: string, s: string) =>
    subscriptions.find((x) => x.project === p && x.session === s);
  const hasOpenEscalation = (p: string, s: string) =>
    escalations.some((e) => e.project === p && e.session === s && e.status === 'open');

  const statusOf = (p: string, s: string): SystemNodeStatus =>
    hasOpenEscalation(p, s) ? 'escalation' : mapStatus(subFor(p, s)?.status);

  const nodes: SystemNode[] = [];

  // Supervisor root.
  const supSession = config?.supervisorSession;
  const supProject = config?.supervisorProject;
  if (supSession && supProject) {
    nodes.push({
      id: 'supervisor',
      kind: 'supervisor',
      label: supSession,
      // The supervisor is "running" if it's a live session; else still shown as a root.
      status: subFor(supProject, supSession) ? statusOf(supProject, supSession) : 'running',
      session: supSession,
    });
  }

  // Workers = supervised sessions in scope (excluding the supervisor itself).
  for (const w of supervised) {
    if (!inScope(w.project)) continue;
    if (w.session === supSession && w.project === supProject) continue;
    nodes.push({
      id: `${w.project}::${w.session}`,
      kind: 'worker',
      label: w.session,
      status: statusOf(w.project, w.session),
      parentId: supSession && supProject ? 'supervisor' : undefined,
      session: w.session,
    });
  }

  return nodes;
}

/**
 * Liveness of the supervisor session for the identity-bar dot (todo 2bd9780c).
 * 'running' = a recent status update; 'crashed' = config present but no/stale
 * signal; 'unknown' = no config. staleMs default 120s (matches the UI staleness
 * pattern). `now`/lastUpdate injected for testability.
 */
export function supervisorLiveness(
  config: { supervisorProject?: string; supervisorSession?: string } | null,
  subscriptions: Array<{ project: string; session: string; lastUpdate?: number }>,
  now: number,
  staleMs = 120_000,
): 'running' | 'crashed' | 'unknown' {
  if (!config?.supervisorProject || !config?.supervisorSession) return 'unknown';
  const sub = subscriptions.find((x) => x.project === config.supervisorProject && x.session === config.supervisorSession);
  if (sub?.lastUpdate && now - sub.lastUpdate <= staleMs) return 'running';
  return 'crashed';
}
