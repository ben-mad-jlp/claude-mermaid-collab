import type { MissionSummary } from '@/stores/supervisorStore';
import type { SessionTodo } from '@/types/sessionTodo';
import { stripKindPrefix } from '@/lib/todoKind';

export function truncate(s: string, max: number): string {
  if (s.length > max) return s.slice(0, max - 1) + '…';
  return s;
}

export function buildCriterionTagIndex(
  missions: MissionSummary[],
): Map<string, { missionTitle: string; criterionOrder: number; criterionText: string }> {
  const index = new Map<string, { missionTitle: string; criterionOrder: number; criterionText: string }>();

  for (const mission of missions) {
    const missionTitle = stripKindPrefix(mission.node.title);

    for (const criterion of mission.criteria) {
      if (!index.has(criterion.id)) {
        index.set(criterion.id, {
          missionTitle,
          criterionOrder: criterion.order,
          criterionText: criterion.text,
        });
      }
    }
  }

  return index;
}

export function criterionTagFor(
  todo: SessionTodo,
  index: Map<string, { missionTitle: string; criterionOrder: number; criterionText: string }>,
): { mission: string; crit: string } | null {
  if (!todo.servesCriterionIds?.length) return null;

  for (const id of todo.servesCriterionIds) {
    const entry = index.get(id);
    if (entry) {
      return {
        mission: truncate(entry.missionTitle, 24),
        crit: `C${entry.criterionOrder} ${truncate(entry.criterionText, 28)}`,
      };
    }
  }

  return null;
}
