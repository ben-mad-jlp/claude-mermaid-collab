import { isHumanActionable, type StatusScope } from '@/lib/statusSelectors';
import type { Escalation } from '@/stores/supervisorStore';

/**
 * Count of open human-audience escalations inside `scope`. Tolerant of a
 * non-array input (returns 0) so a not-yet-hydrated slice never throws.
 */
export function selectHumanRedCount(open: Escalation[], scope: StatusScope): number {
  if (!Array.isArray(open)) return 0;
  let n = 0;
  for (const e of open) if (isHumanActionable(e, scope)) n++;
  return n;
}

/** True when any open human-audience escalation exists inside `scope`. */
export function isScopeRed(open: Escalation[], scope: StatusScope): boolean {
  return selectHumanRedCount(open, scope) > 0;
}
