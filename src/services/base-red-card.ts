/** Builder and decision helper for base-red escalation cards. */

import { lastLines } from './gate-runner';

export interface BaseRedCardInput {
  epicBranch: string;
  command: string;
  output?: string;
  branchIdenticalToBase: boolean;
}

export interface ResolveBaseRedCardInput {
  epicBranch: string;
  command: string;
  output?: string;
  isBranchDiffEmpty?: () => Promise<boolean>;
  remeasureBase?: () => Promise<{ status: string } | null>;
}

/** Builds the escalation card text for a base-red condition.
 * branchIdenticalToBase: false ⇒ prescribe "commit the fix" (today's path).
 * branchIdenticalToBase: true ⇒ state the branch is identical and base needs upstream repair. */
export function buildBaseRedCard(input: BaseRedCardInput): string {
  const { epicBranch, command, output, branchIdenticalToBase } = input;
  const tail = lastLines(output ?? '', 40);
  const header =
    `Epic base is RED — no leaf on ${epicBranch} can be trusted, so NONE will start.\n` +
    `failing command: ${command}\n` +
    `--- output (tail) ---\n${tail}\n---\n`;

  if (!branchIdenticalToBase) {
    // Today's behaviour: prescribe committing the fix to the epic branch
    return (
      header +
      `Fix the base and commit the fix to ${epicBranch}. The cached verdict is keyed to the ` +
      `base commit it examined, so moving the base invalidates it: the next leaf re-runs the ` +
      `gate automatically. No manual cache-clearing step exists or is needed.`
    );
  }

  // Branch is identical to its base: the base itself needs upstream repair
  return (
    header +
    `The ${epicBranch} branch is identical to its base, so the failure is upstream. ` +
    `Fix the base commit itself and then re-integrate trunk into the epic branch. ` +
    `The cached verdict is keyed to the base commit, so moving it invalidates the cache.`
  );
}

/** Decision helper for fresh base-red escalations.
 * Probes whether the branch is empty-diff; if so, re-measures the gate once.
 * Returns null if the re-measure passes (leaf proceeds); otherwise returns a card with appropriate text. */
export async function resolveFreshBaseRedCard(
  input: ResolveBaseRedCardInput,
): Promise<{ questionText: string } | null> {
  const { isBranchDiffEmpty, remeasureBase } = input;

  // No probe ⇒ assume non-empty diff ⇒ today's behaviour (prescribe the fix)
  if (!isBranchDiffEmpty) {
    return {
      questionText: buildBaseRedCard({
        ...input,
        branchIdenticalToBase: false,
      }),
    };
  }

  // Try the probe; fail-safe defaults to non-empty (today's behaviour)
  let isEmpty = false;
  try {
    isEmpty = await isBranchDiffEmpty();
  } catch {
    isEmpty = false;
  }

  if (!isEmpty) {
    // Non-empty diff ⇒ today's card (prescribe the fix)
    return {
      questionText: buildBaseRedCard({
        ...input,
        branchIdenticalToBase: false,
      }),
    };
  }

  // Empty diff: re-measure the base gate exactly once
  let remeasureResult: { status: string } | null = null;
  if (remeasureBase) {
    try {
      remeasureResult = await remeasureBase();
    } catch {
      remeasureResult = null;
    }
  }

  // Passed ⇒ no card, leaf proceeds
  if (remeasureResult?.status === 'pass') {
    return null;
  }

  // Still failing (or error/null) ⇒ card stating branch is identical to base
  return {
    questionText: buildBaseRedCard({
      ...input,
      branchIdenticalToBase: true,
    }),
  };
}
