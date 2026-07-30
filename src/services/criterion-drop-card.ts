/**
 * criterion-drop-card — raises exactly one deduped human-audience card when a conductor
 * (or an operator via MCP) drops a `capability` criterion. Epic/leaf drops under an
 * already-dropped parent never raise — they route through the same decision function
 * (`shouldRaiseDropCard`) so the no-op is provable, not merely absent.
 */
import { createEscalation } from './supervisor-store.js';
import { coordinatorCondition } from './coordinator-condition-keys.js';
import type { CriterionType } from './mission-store.js';

export function shouldRaiseDropCard(input: {
  subject: 'criterion' | 'epic' | 'leaf';
  criterionType?: CriterionType;
  parentDropped?: boolean;
}): boolean {
  return input.subject === 'criterion' && input.criterionType === 'capability' && input.parentDropped !== true;
}

export interface RaiseCriterionDropCardDeps {
  createEscalation?: typeof createEscalation;
}

export function raiseCriterionDropCard(
  deps: RaiseCriterionDropCardDeps,
  input: {
    subject?: 'criterion' | 'epic' | 'leaf';
    project: string;
    session: string;
    missionId: string;
    criterion?: { id: string; text: string; type: CriterionType };
    reason: string;
    parentDropped?: boolean;
  },
): { isNew: boolean } | null {
  const subject = input.subject ?? 'criterion';
  if (!shouldRaiseDropCard({ subject, criterionType: input.criterion?.type, parentDropped: input.parentDropped })) return null;
  const createEscalationFn = deps.createEscalation ?? createEscalation;
  const { conditionKey, conditionTuple } = coordinatorCondition('criterion-dropped', input.missionId, input.criterion!.id);
  const { isNew } = createEscalationFn({
    project: input.project,
    session: input.session,
    kind: 'criterion-dropped',
    questionText: `Criterion "${input.criterion!.text}" was dropped (${input.reason}). A VETO re-arms it (un-drop).`,
    audience: 'human',
    operatorGated: true,
    conditionKey,
    conditionTuple,
  });
  return { isNew };
}
