/**
 * SR-3: Split proposal system with bounded wait and safe default.
 *
 * PROPOSE (raise card, no children yet) → WAIT (bounded) → ACT (split or linear)
 * The leaf is never in a silent wedge; pending proposals surface in daemon_status.
 */

import { listEscalations, getEscalationDecision, createEscalation, resolveEscalation } from './supervisor-store';
import { trackingProjectRoot } from './project-registry';

export const SPLIT_PROPOSAL_TAG = '[SPLIT PROPOSAL]';
export const SPLIT_PROPOSAL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
export const SPLIT_PROPOSAL_POLL_MS = 5_000;

/** Oversized-but-linear leaves legitimately spend more revise/reuse cycles than the
 *  FLOOR's ≤6 nodes. Double the runaway ceiling; it is still a ceiling. */
export function raisedNodeBudget(base: number): number {
  return base * 2;
}

export type SplitProposalAnswer = 'split' | 'linear' | 'timeout';

export interface SplitProposal {
  escalationId: string;
  createdAt: number;
  isNew: boolean;
}

/** The ONE dedupe predicate. An open decision escalation for this leaf whose
 *  questionText starts with SPLIT_PROPOSAL_TAG is THE proposal for this leaf. */
export function findOpenSplitProposal(project: string, leafId: string): import('./supervisor-store').Escalation | null {
  const normalized = trackingProjectRoot(project);
  const escalations = listEscalations('open');
  for (const e of escalations) {
    if (e.project === normalized && e.kind === 'decision' && e.todoId === leafId && e.questionText.startsWith(SPLIT_PROPOSAL_TAG)) {
      return e;
    }
  }
  return null;
}

/** Raise (or re-find) the proposal. NEVER creates children. */
export function proposeSplit(input: {
  project: string;
  session: string;
  leaf: { id: string; title?: string | null };
  itemCount: number;
  reason: string;
}): SplitProposal {
  const existing = findOpenSplitProposal(input.project, input.leaf.id);
  if (existing) {
    return { escalationId: existing.id, createdAt: existing.createdAt, isNew: false };
  }

  const questionText =
    `${SPLIT_PROPOSAL_TAG} "${input.leaf.title ?? input.leaf.id}" → ${input.itemCount} children\n\n` +
    `Reason: ${input.reason}\n\n` +
    `**No children have been created yet.** The split is PROPOSED, awaiting your decision.\n\n` +
    `**Option 1: APPROVE THE SPLIT** (select "Split") → children become ready; the parent becomes a container.\n` +
    `**Option 2: RUN LINEAR** (select "Linear", or no answer by timeout) → the leaf runs as one, with raised budget.\n\n` +
    `Timeout: 10 minutes. No answer = Linear (the safe default).`;

  const { escalation, isNew } = createEscalation({
    project: input.project,
    session: input.session,
    kind: 'decision',
    todoId: input.leaf.id,
    questionText,
    options: [
      { id: 'split', label: 'Split', detail: 'Create and approve children as the blueprint proposed' },
      { id: 'linear', label: 'Linear', detail: 'Run the leaf as one, with raised budget' },
    ],
    recommended: 'linear',
    operatorGated: false,
  });

  return { escalationId: escalation.id, createdAt: escalation.createdAt, isNew };
}

/** List all open split proposals in a project (used by ClaimSuppressionReport). */
export function listOpenSplitProposals(project: string): Array<{ escalationId: string; todoId: string | null; createdAt: number }> {
  const normalized = trackingProjectRoot(project);
  const escalations = listEscalations('open');
  const result: Array<{ escalationId: string; todoId: string | null; createdAt: number }> = [];
  for (const e of escalations) {
    if (e.project === normalized && e.kind === 'decision' && e.questionText.startsWith(SPLIT_PROPOSAL_TAG)) {
      result.push({ escalationId: e.id, todoId: e.todoId, createdAt: e.createdAt });
    }
  }
  return result;
}

/** Poll getEscalationDecision until an answer lands or createdAt + timeoutMs passes.
 *  Deadline is anchored to the escalation's createdAt (NOT to now), so a re-claim
 *  inherits the ORIGINAL clock and an already-expired proposal returns 'timeout' immediately. */
export async function awaitSplitDecision(input: {
  escalationId: string;
  createdAt: number;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  readDecision?: (id: string) => { optionId: string | null } | null;
}): Promise<SplitProposalAnswer> {
  const timeoutMs = input.timeoutMs ?? SPLIT_PROPOSAL_TIMEOUT_MS;
  const pollMs = input.pollMs ?? SPLIT_PROPOSAL_POLL_MS;
  const now = input.now ?? (() => Date.now());
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const readDecision = input.readDecision ?? getEscalationDecision;

  const deadline = input.createdAt + timeoutMs;

  while (true) {
    const decision = readDecision(input.escalationId);
    if (decision) {
      // Only the literal string 'split' splits; anything else (including null optionId for note-only answers) → linear (safe default)
      if (decision.optionId === 'split') {
        return 'split';
      }
      return 'linear';
    }

    const currentTime = now();
    if (currentTime >= deadline) {
      return 'timeout';
    }

    // Sleep before the next poll
    const remaining = deadline - currentTime;
    const sleepTime = Math.min(pollMs, remaining);
    if (sleepTime > 0) {
      await sleep(sleepTime);
    }
  }
}
