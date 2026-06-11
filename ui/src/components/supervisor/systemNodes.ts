// Pure derivation of System-Map nodes (Phase 6) from the live stores. Kept
// separate from the React panel so it's unit-testable. Today's hierarchy is
// Supervisor → Workers (supervised sessions); Planner/Coordinator role nodes
// slot in here once the coordinator surfaces them. Status precedence: an open
// escalation wins, else the session's live status, else unknown.
//
// Liveness source (epic d5b1ff4e §0/§3, leaf L4): worker liveness/status is read
// from `subscriptionStore` — the WS-native, composite-keyed (`serverId:project:session`)
// multi-server truth — via the SHARED `selectSessionStatus` selector, NOT from
// `supervisorStore.supervised`. `supervised` is consumed here as a pure MEMBERSHIP
// list (which sessions are watched), never as a liveness source; `openEscalations`
// is the open "needs you" set. Both surfaces (left card + this map) therefore read
// a session's liveness from the SAME subscriptionStore entry through the same pure
// selector, so they cannot disagree.
//
// DEVIATION FROM THE DESIGN DOC (decision on L4, option a): the LIVE Bridge fleet
// graph keeps deriving worker liveness from the `/api/fleet` read-model (REAL tmux),
// NOT from subscriptionStore — because the Watching feed deliberately EXCLUDES
// coordinator-spawned `worker-*` sessions (decision caae8574/5d54e01e), so a
// subscriptionStore-only read would make spawned workers vanish. This module (the
// System-Map derivation, not yet wired into the live fleet graph) is the surface
// that adopts the shared selector; the fleet read-model stays authoritative for the
// live graph until that liveness is folded into subscriptionStore (a separate leaf).

import type { SystemNode, SystemNodeStatus } from './systemToMermaid';
import { selectSessionStatus, type SessionStatus } from '@/lib/statusSelectors';

export interface DeriveInput {
  config: { supervisorProject?: string; supervisorSession?: string } | null;
  /** Pure MEMBERSHIP list — which sessions are watched. Never a liveness source. */
  supervised: Array<{ project: string; session: string; serverId?: string }>;
  /** The subscriptionStore map (`serverId:project:session` → status) — the one liveness truth. */
  subscriptions: Record<string, SessionStatus>;
  /** The open "needs you" set (supervisorStore.openEscalations slice). */
  openEscalations: Array<{ project: string; session: string }>;
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
  const { config, supervised, subscriptions, openEscalations, project } = input;
  const inScope = (p: string) => project === undefined || p === project;

  // Liveness via the shared selector over subscriptionStore — serverId-agnostic
  // (selectSessionStatus falls back to a (project, session) scan when the exact
  // composite key misses, tolerating the 'local'-sentinel vs real-id mismatch, D6).
  const subFor = (p: string, s: string): SessionStatus | undefined =>
    selectSessionStatus(subscriptions, '', p, s);
  const hasOpenEscalation = (p: string, s: string) =>
    openEscalations.some((e) => e.project === p && e.session === s);

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
  subscriptions: Record<string, SessionStatus>,
  now: number,
  staleMs = 120_000,
): 'running' | 'crashed' | 'unknown' {
  if (!config?.supervisorProject || !config?.supervisorSession) return 'unknown';
  // Same liveness source as the worker nodes: the subscriptionStore entry, looked
  // up through the shared selector (serverId-agnostic fallback).
  const sub = selectSessionStatus(subscriptions, '', config.supervisorProject, config.supervisorSession);
  if (sub?.lastUpdate && now - sub.lastUpdate <= staleMs) return 'running';
  return 'crashed';
}
