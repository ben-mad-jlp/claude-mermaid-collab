/**
 * Gate for the `stampEpicLandedAt` operation: verify that an epic is reachable on master
 * before marking it as landed, with escalation on failure.
 *
 * The landing flow has two guards: the pre-land mechanical gate (epic-land-gate.ts:runEpicLandGate)
 * ensures the merge succeeds BEFORE land, and this gate ensures the result reachable on the base.
 * A gap between them (epic merges but commit somehow not reachable) marks a landing failure.
 */

import { stampEpicLandedAt } from './todo-store';
import {
  makeGitProbe,
  epicBranchName,
  epicId8,
  effectiveNewCount,
  type GitProbe,
} from './epic-branch-status';
import { createEscalation, recordSupervisorAudit } from './supervisor-store';
import { coordinatorCondition } from './coordinator-condition-keys';

export type GateReason = 'gated-clean' | 'indeterminate' | 'ahead-of-master' | 'stamp-failed';

/**
 * Gate the `stampEpicLandedAt` call on master-reachability.
 *
 * Returns { stamped, reason, newCount? }:
 * - stamped: boolean — whether the epic's landedAt was set
 * - reason: 'gated-clean' | 'indeterminate' | 'ahead-of-master' | 'stamp-failed'
 * - newCount?: number — only present for ahead-of-master
 *
 * Decision table:
 * - indeterminate (probe failed / branch missing): FAIL-SAFE → stamp, audit with landGate:'indeterminate-stamp'
 * - newCount === 0: stamp and audit with landGate:'gated-clean'
 * - newCount > 0: do NOT stamp; raise one 'land-failed' card, audit with landGate:'ahead-of-master'
 */
export async function stampEpicLandedAtGated(
  project: string,
  epicId: string,
  whenIso: string,
  opts?: { probe?: GitProbe; baseRef?: string; session?: string },
): Promise<{ stamped: boolean; reason: GateReason; newCount?: number }> {
  try {
    const probe = opts?.probe ?? makeGitProbe(project);
    const baseRef = opts?.baseRef ?? 'master';
    const session = opts?.session ?? 'coordinator';
    const branch = epicBranchName(epicId);

    // Probe the branch status against the base.
    const p = await probe(branch, baseRef).catch(() => null);

    // INDETERMINATE: branch missing, probe failed, or no counts available.
    if (!p || p.exists === false || (p.newCount == null && p.ahead == null)) {
      const ok = stampEpicLandedAt(project, epicId, whenIso);
      recordSupervisorAudit({
        kind: 'reconcile',
        project,
        session,
        detail: JSON.stringify({
          epicId,
          branch,
          landGate: 'indeterminate-stamp',
        }),
      });
      return { stamped: ok, reason: 'indeterminate' };
    }

    const newCount = effectiveNewCount(p);

    // GATED-CLEAN: no new commits.
    if (newCount === 0) {
      const ok = stampEpicLandedAt(project, epicId, whenIso);
      recordSupervisorAudit({
        kind: 'reconcile',
        project,
        session,
        detail: JSON.stringify({
          epicId,
          branch,
          landGate: 'gated-clean',
          newCount: 0,
        }),
      });
      return { stamped: ok, reason: ok ? 'gated-clean' : 'stamp-failed', newCount: 0 };
    }

    // AHEAD-OF-MASTER: branch has unlanded commits.
    // Do NOT stamp. Raise an escalation card with dedup identity.
    const ahead = p.ahead ?? 0;
    const id8 = epicId8(epicId);
    try {
      createEscalation({
        project,
        session,
        kind: 'land-failed',
        todoId: epicId,
        questionText: `Landing failed: epic branch ${branch} is still ${newCount} commit${newCount === 1 ? '' : 's'} ahead of ${baseRef} (git ahead: ${ahead})`,
        ...coordinatorCondition('land-failed', id8),
      });
    } catch (e) {
      console.warn('[epic-landed-stamp-gate] createEscalation failed for land-failed card', epicId, e);
    }

    recordSupervisorAudit({
      kind: 'reconcile',
      project,
      session,
      detail: JSON.stringify({
        epicId,
        branch,
        landGate: 'ahead-of-master',
        newCount,
        ahead,
      }),
    });

    return { stamped: false, reason: 'ahead-of-master', newCount };
  } catch (e) {
    console.warn('[epic-landed-stamp-gate] stampEpicLandedAtGated failed', epicId, e);
    // In case of error, fail-safe and try to stamp anyway (never block landing).
    try {
      stampEpicLandedAt(project, epicId, whenIso);
    } catch {
      // best effort
    }
    return { stamped: false, reason: 'stamp-failed' };
  }
}
