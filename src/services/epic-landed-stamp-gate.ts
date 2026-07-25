/**
 * Gate for the `stampEpicLandedAt` operation: verify that an epic is reachable on master
 * before marking it as landed, with escalation on failure.
 *
 * The landing flow has two guards: the pre-land mechanical gate (epic-land-gate.ts:runEpicLandGate)
 * ensures the merge succeeds BEFORE land, and this gate ensures the result reachable on the base.
 * A gap between them (epic merges but commit somehow not reachable) marks a landing failure.
 */

import { stampEpicLandedAt, listTodos } from './todo-store';
import {
  makeGitProbe,
  epicBranchName,
  epicId8,
  effectiveNewCount,
  type GitProbe,
  type BranchProbe,
} from './epic-branch-status';
import { createEscalation, recordSupervisorAudit } from './supervisor-store';
import { coordinatorCondition } from './coordinator-condition-keys';

export type GateReason = 'gated-clean' | 'indeterminate' | 'ahead-of-master' | 'stamp-failed' | 'gate-error' | 'leaves-pending';

/**
 * Gate the `stampEpicLandedAt` call on master-reachability.
 *
 * Returns { stamped, reason, newCount? }:
 * - stamped: boolean — whether the epic's landedAt was set
 * - reason: 'gated-clean' | 'indeterminate' | 'ahead-of-master' | 'stamp-failed' | 'gate-error'
 * - newCount?: number — only present for ahead-of-master
 *
 * Decision table:
 * - branch absent → FAIL-SAFE stamp, audit with landGate:'indeterminate-stamp', reason 'indeterminate'
 * - branch exists but counts unreadable (exists=true, newCount=null, ahead=null) → do NOT stamp; raise one 'land-failed' card, audit with landGate:'indeterminate-no-stamp', reason 'indeterminate'
 * - newCount === 0 → stamp and audit with landGate:'gated-clean' (or stamp-failed if write fails)
 * - newCount > 0 → do NOT stamp; raise one 'land-failed' card, audit with landGate:'ahead-of-master', reason 'ahead-of-master'
 * - internal error (probe throws or other exception) → do NOT stamp; raise one 'land-failed' card, reason 'gate-error'
 *
 * opts.known: a pre-fetched BranchProbe — when supplied, the gate makes zero git calls.
 */
export async function stampEpicLandedAtGated(
  project: string,
  epicId: string,
  whenIso: string,
  opts?: { probe?: GitProbe; baseRef?: string; session?: string; known?: BranchProbe; listTodos?: typeof listTodos },
): Promise<{ stamped: boolean; reason: GateReason; newCount?: number }> {
  try {
    const probe = opts?.probe ?? makeGitProbe(project);
    const baseRef = opts?.baseRef ?? 'master';
    const session = opts?.session ?? 'coordinator';
    const branch = epicBranchName(epicId);

    // ALL-LEAVES-DONE gate (partial-land churn, bugfix 4ff59283): an epic whose branch
    // reaches master but whose sibling implementation leaves have not all run is only
    // PARTIALLY built. Stamping landedAt now makes the serving criterion read 'landed'
    // and verify a PARTIAL land, then re-serve and churn to the serve cap (3 incidents
    // 2026-07-25: ninth-drain crit3, self-recovery crit2/crit3). Require every non-dropped
    // kind='leaf' child done (status 'done' && not rejected) before ANY stamp path. Land
    // leaves (kind='land') are deliberately excluded — they complete AS PART of landing,
    // so requiring them would be circular. An epic with zero impl leaves is vacuously done.
    const listTodosFn = opts?.listTodos ?? listTodos;
    const implLeaves = listTodosFn(project, { includeCompleted: true }).filter(
      (t) => t.parentId === epicId && t.kind === 'leaf' && t.status !== 'dropped',
    );
    const pendingLeaves = implLeaves.filter(
      (t) => !(t.status === 'done' && t.acceptanceStatus !== 'rejected'),
    );
    if (pendingLeaves.length > 0) {
      recordSupervisorAudit({
        kind: 'reconcile',
        project,
        session,
        detail: JSON.stringify({
          epicId,
          branch,
          landGate: 'leaves-pending',
          pendingLeaves: pendingLeaves.length,
          totalLeaves: implLeaves.length,
        }),
      });
      return { stamped: false, reason: 'leaves-pending' };
    }

    // Probe the branch status against the base — reuse a pre-fetched BranchProbe
    // when supplied (opts.known), so the gate makes zero git calls.
    const p = opts?.known ?? (await probe(branch, baseRef));

    // INDETERMINATE (branch absent): fail-safe stamp.
    if (!p || p.exists === false) {
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

    // INDETERMINATE (branch exists but counts unreadable): do NOT stamp.
    // Raise escalation and retry next tick.
    if (p.newCount == null && p.ahead == null) {
      const id8 = epicId8(epicId);
      try {
        createEscalation({
          project,
          session,
          kind: 'land-failed',
          todoId: epicId,
          questionText: `Landing cannot proceed: branch ${branch} exists but git counts unreadable (probe returned null for both newCount and ahead)`,
          ...coordinatorCondition('land-failed', id8),
        });
      } catch (e) {
        console.warn('[epic-landed-stamp-gate] createEscalation failed for indeterminate-no-stamp card', epicId, e);
      }

      recordSupervisorAudit({
        kind: 'reconcile',
        project,
        session,
        detail: JSON.stringify({
          epicId,
          branch,
          landGate: 'indeterminate-no-stamp',
        }),
      });
      return { stamped: false, reason: 'indeterminate' };
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
    // Fail-closed: gate error means we cannot prove the landing is safe.
    // Do NOT stamp. Raise escalation and let the user retry.
    const errorMsg = e instanceof Error ? e.message : String(e);
    try {
      createEscalation({
        project,
        session: opts?.session ?? 'coordinator',
        kind: 'land-failed',
        todoId: epicId,
        questionText: `Landing failed: internal gate error: ${errorMsg}`,
        ...coordinatorCondition('land-failed', epicId8(epicId)),
      });
    } catch (escErr) {
      console.warn('[epic-landed-stamp-gate] createEscalation failed in catch block', epicId, escErr);
    }
    return { stamped: false, reason: 'gate-error' };
  }
}
